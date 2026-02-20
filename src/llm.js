import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { getCopy } from './copy.js';
import { sanitizeUserTextForLlm } from './utils/sanitizeForLlm.js';

const DEFAULT_MODEL = process.env.GROK_MODEL || 'grok-4-1-fast-reasoning-latest';
const DEFAULT_VISION_MODEL = process.env.GROK_VISION_MODEL || 'grok-4-1-fast-reasoning-latest';

// Configurable LLM parameters for enhanced intelligence
// Helper to parse and validate numeric parameters
function parseEnvFloat(envVar, defaultValue, min = -Infinity, max = Infinity) {
  if (envVar === undefined) return defaultValue;
  const parsed = parseFloat(envVar);
  if (isNaN(parsed)) {
    console.warn(`Invalid numeric value for parameter: "${envVar}". Using default: ${defaultValue}`);
    return defaultValue;
  }
  if (parsed < min || parsed > max) {
    console.warn(`Value ${parsed} out of range [${min}, ${max}]. Using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvInt(envVar, defaultValue, min = -Infinity, max = Infinity) {
  if (envVar === undefined) return defaultValue;
  const parsed = parseInt(envVar, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid integer value for parameter: "${envVar}". Using default: ${defaultValue}`);
    return defaultValue;
  }
  if (parsed < min || parsed > max) {
    console.warn(`Value ${parsed} out of range [${min}, ${max}]. Using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

const LLM_TEMPERATURE = parseEnvFloat(process.env.LLM_TEMPERATURE, 0.3, 0.0, 2.0);
const LLM_TOP_P = parseEnvFloat(process.env.LLM_TOP_P, 0.9, 0.0, 1.0);
const LLM_PRESENCE_PENALTY = parseEnvFloat(process.env.LLM_PRESENCE_PENALTY, 0.1, -2.0, 2.0);
const LLM_FREQUENCY_PENALTY = parseEnvFloat(process.env.LLM_FREQUENCY_PENALTY, 0.2, -2.0, 2.0);
const LLM_MAX_TOKENS = parseEnvInt(process.env.LLM_MAX_TOKENS, 4096, 1, 131072);

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  let url = baseUrl.replace(/\/+$/, '');
  while (url.endsWith('/v1')) {
    url = url.slice(0, -3);
  }
  return url;
}

// Load the system prompt from env text or file; fall back to a baked-in default.
const systemPrompt = (() => {
  if (process.env.SYSTEM_PROMPT) return process.env.SYSTEM_PROMPT;

  const promptPath = process.env.SYSTEM_PROMPT_FILE || './prompts/system_prompt.txt';
  const resolved = path.resolve(process.cwd(), promptPath);

  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    return raw;
  } catch (err) {
    console.warn(`Falling back to default system prompt; failed to load ${resolved}: ${err.message}`);
    return (
      'You are {BOT_NAME}, an advanced AI assistant integrated into a Discord server. ' +
      'Provide helpful, concise, and friendly responses to user queries. ' +
      'When appropriate, use markdown formatting for code snippets and lists. ' +
      `If you do not know the answer, respond with "${getCopy('llm_default_unknown_answer')}".`
    );
  }
})();

const fallbackErrorLine = getCopy('llm_fallback_error');
const PREFIX_COMMAND_PATTERN = /(^|\s)!\w{2,}\b/i;
const OTHER_BOT_PATTERN = /\bpok[eé]two\b/i;

function applyHallucinationGuard(text) {
  const output = String(text || '').trim();
  if (!output) return getCopy('llm_default_unknown_answer');
  if (PREFIX_COMMAND_PATTERN.test(output) || OTHER_BOT_PATTERN.test(output)) {
    return 'I only support slash commands and in-message buttons here. Use `/packs` for pack actions or `/ask` for general questions.';
  }
  return output;
}

function buildMessages({
  botName,
  profileSummary,
  recentTurns,
  userContent,
  replyContext,
  imageInputs,
  recentUserMessages,
  recentChannelMessages,
  channelSummary,
  guildSummary,
  knownUsers,
  serverContext,
  userContext,
  contextStack,
  retrievedContextBlocks,
  webSearchResults,
}) {
  const sanitizedUserText = sanitizeUserTextForLlm(userContent || '');
  const safeUserContent = sanitizedUserText.sanitized || String(userContent || '');
  const messages = [
    {
      role: 'system',
      content: systemPrompt.replace('{BOT_NAME}', botName),
    },
  ];

  const contextBlocks = [];
  if (contextStack) {
    const lines = [];
    if (contextStack.channelType) lines.push(`- Channel: ${contextStack.channelType}`);
    if (typeof contextStack.memoryEnabled === 'boolean') lines.push(`- Memory enabled: ${contextStack.memoryEnabled ? 'yes' : 'no'}`);
    if (typeof contextStack.memoryAllowed === 'boolean') lines.push(`- Memory allowed here: ${contextStack.memoryAllowed ? 'yes' : 'no'}`);
    if (typeof contextStack.replyContext === 'boolean') lines.push(`- Replying to message: ${contextStack.replyContext ? 'yes' : 'no'}`);
    if (typeof contextStack.imageCount === 'number') lines.push(`- Images attached: ${contextStack.imageCount}`);
    if (typeof contextStack.videoCount === 'number') lines.push(`- Videos attached: ${contextStack.videoCount}`);
    if (contextStack.preferredName) lines.push(`- Preferred name: ${contextStack.preferredName}`);
    if (contextStack.displayName) lines.push(`- Display name: ${contextStack.displayName}`);
    if (contextStack.pronouns) lines.push(`- Pronouns: ${contextStack.pronouns}`);
    if (lines.length) {
      messages.push({
        role: 'system',
        content: `Context stack:\n${lines.join('\n')}`,
      });
    }
  }

  if (serverContext) contextBlocks.push(`Server info:\n${serverContext}`);
  if (userContext) contextBlocks.push(`User info:\n${userContext}`);
  if (replyContext) contextBlocks.push(replyContext);
  if (profileSummary) contextBlocks.push(`User profile summary: ${profileSummary}`);
  if (recentUserMessages?.length) {
    const formatted = recentUserMessages.map((msg) => `- ${msg}`).join('\n');
    contextBlocks.push(`Recent user messages:\n${formatted}`);
  }
  if (channelSummary) contextBlocks.push(`Channel summary: ${channelSummary}`);
  if (guildSummary) contextBlocks.push(`Server summary: ${guildSummary}`);
  if (knownUsers?.length) contextBlocks.push(`Known users in this server: ${knownUsers.join(', ')}`);
  if (recentChannelMessages?.length) {
    const formatted = recentChannelMessages.map((msg) => `- ${msg}`).join('\n');
    contextBlocks.push(`Recent channel messages:\n${formatted}`);
  }
  if (retrievedContextBlocks?.length) {
    contextBlocks.push(...retrievedContextBlocks);
  }
  if (webSearchResults?.length) {
    const webBlock = webSearchResults
      .map((row) => `- ${row.title}: ${row.snippet} (${row.url})`)
      .join('\n');
    contextBlocks.push(`Web search snippets:\n${webBlock}`);
  }
  if (contextBlocks.length) {
    messages.push({
      role: 'system',
      content: contextBlocks.join('\n\n'),
    });
  }

  for (const turn of recentTurns) {
    messages.push({ role: turn.role, content: turn.content });
  }

  if (imageInputs?.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: safeUserContent },
        ...imageInputs.map((url) => ({
          type: 'image_url',
          image_url: { url, detail: 'high' },
        })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: safeUserContent });
  }
  return messages;
}

async function callOnce({
  botName,
  profileSummary,
  recentTurns,
  userContent,
  replyContext,
  imageInputs,
  recentUserMessages,
  recentChannelMessages,
  channelSummary,
  guildSummary,
  knownUsers,
  serverContext,
  userContext,
  contextStack,
  retrievedContextBlocks,
  webSearchResults,
}) {
  const model = imageInputs?.length ? DEFAULT_VISION_MODEL || DEFAULT_MODEL : DEFAULT_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.GROK_BASE_URL);
  const payload = {
    model,
    // Enhanced parameters for more intelligent responses
    temperature: LLM_TEMPERATURE,
    top_p: LLM_TOP_P,
    max_tokens: LLM_MAX_TOKENS,
    messages: buildMessages({
      botName,
      profileSummary,
      recentTurns,
      userContent,
      replyContext,
      imageInputs,
      recentUserMessages,
      recentChannelMessages,
      channelSummary,
      guildSummary,
      knownUsers,
      serverContext,
      userContext,
      contextStack,
      retrievedContextBlocks,
      webSearchResults,
    }),
  };

  // Some Grok models reject presence/frequency penalties.
  if (!/grok-4-1-fast-reasoning/i.test(model)) {
    payload.presence_penalty = LLM_PRESENCE_PENALTY;
    payload.frequency_penalty = LLM_FREQUENCY_PENALTY;
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    if (
      imageInputs?.length &&
      /image|vision|multimodal|unsupported|not\s+enabled/i.test(bodyText)
    ) {
      const err = new Error('VISION_UNSUPPORTED');
      err.code = 'VISION_UNSUPPORTED';
      throw err;
    }
    throw new Error(`LLM error: ${res.status} ${bodyText}`);
  }

  const data = await res.json();
  return applyHallucinationGuard(data?.choices?.[0]?.message?.content?.trim());
}

export async function getLLMResponse({
  botName,
  profileSummary,
  recentTurns,
  userContent,
  replyContext,
  imageInputs,
  recentUserMessages,
  recentChannelMessages,
  channelSummary,
  guildSummary,
  knownUsers,
  serverContext,
  userContext,
  contextStack,
  retrievedContextBlocks,
  webSearchResults,
}) {
  try {
    return await callOnce({
      botName,
      profileSummary,
      recentTurns,
      userContent,
      replyContext,
      imageInputs,
      recentUserMessages,
      recentChannelMessages,
      channelSummary,
      guildSummary,
      knownUsers,
      serverContext,
      userContext,
      contextStack,
      retrievedContextBlocks,
      webSearchResults,
    });
  } catch (err) {
    if (err?.code === 'VISION_UNSUPPORTED') {
      return getCopy('llm_vision_unsupported');
    }
    console.error('LLM request failed (first attempt):', err);
    await delay(300);
    try {
      return await callOnce({
        botName,
        profileSummary,
        recentTurns,
        userContent,
        replyContext,
        imageInputs,
        recentUserMessages,
        recentChannelMessages,
        channelSummary,
        guildSummary,
        knownUsers,
        serverContext,
        userContext,
        contextStack,
        retrievedContextBlocks,
        webSearchResults,
      });
    } catch (retryErr) {
      if (retryErr?.code === 'VISION_UNSUPPORTED') {
        return getCopy('llm_vision_unsupported');
      }
      console.error('LLM request failed (retry):', retryErr);
      return fallbackErrorLine;
    }
  }
}
