import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

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
      'If you do not know the answer, respond with "idk tbh".'
    );
  }
})();

const fallbackErrorLine =
  'cant answer rn bro too busy gooning (grok api error)';
const failureWindowMs = 60_000;
const failureTimestamps = [];
let warnedVisionUnsupported = false;

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
}) {
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
    if (typeof contextStack.memoryEnabled === 'boolean') {
      lines.push(`- Memory enabled: ${contextStack.memoryEnabled ? 'yes' : 'no'}`);
    }
    if (typeof contextStack.memoryAllowed === 'boolean') {
      lines.push(`- Memory allowed here: ${contextStack.memoryAllowed ? 'yes' : 'no'}`);
    }
    if (typeof contextStack.replyContext === 'boolean') {
      lines.push(`- Replying to a message: ${contextStack.replyContext ? 'yes' : 'no'}`);
    }
    if (typeof contextStack.imageCount === 'number') {
      lines.push(`- Images attached: ${contextStack.imageCount}`);
    }
    if (typeof contextStack.videoCount === 'number') {
      lines.push(`- Videos attached: ${contextStack.videoCount}`);
    }
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

  if (serverContext) {
    contextBlocks.push(`Server info:\n${serverContext}`);
  }

  if (userContext) {
    contextBlocks.push(`User info:\n${userContext}`);
  }

  if (replyContext) {
    contextBlocks.push(replyContext);
  }

  if (profileSummary) {
    contextBlocks.push(`User profile summary: ${profileSummary}`);
  }

  if (recentUserMessages?.length) {
    const formatted = recentUserMessages.map((msg) => `- ${msg}`).join('\n');
    contextBlocks.push(`Recent user messages:\n${formatted}`);
  }

  if (channelSummary) {
    contextBlocks.push(`Channel summary: ${channelSummary}`);
  }

  if (guildSummary) {
    contextBlocks.push(`Server summary: ${guildSummary}`);
  }

  if (knownUsers?.length) {
    contextBlocks.push(`Known users in this server: ${knownUsers.join(', ')}`);
  }

  if (recentChannelMessages?.length) {
    const formatted = recentChannelMessages.map((msg) => `- ${msg}`).join('\n');
    contextBlocks.push(`Recent channel messages:\n${formatted}`);
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
        { type: 'text', text: userContent },
        ...imageInputs.map((url) => ({
          type: 'image_url',
          image_url: { url, detail: 'high' },
        })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: userContent });
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
  forceVision,
  recentUserMessages,
  recentChannelMessages,
  channelSummary,
  guildSummary,
  knownUsers,
  serverContext,
  userContext,
  contextStack,
}) {
  const model = (imageInputs?.length || forceVision) ? DEFAULT_VISION_MODEL || DEFAULT_MODEL : DEFAULT_MODEL;
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
  return data?.choices?.[0]?.message?.content?.trim() || 'idk tbh';
}

export async function getLLMResponse({
  botName,
  profileSummary,
  recentTurns,
  userContent,
  replyContext,
  imageInputs,
  forceVision,
  recentUserMessages,
  recentChannelMessages,
  channelSummary,
  guildSummary,
  knownUsers,
  serverContext,
  userContext,
  contextStack,
}) {
  try {
    return await callOnce({
      botName,
      profileSummary,
      recentTurns,
      userContent,
      replyContext,
      imageInputs,
      forceVision,
      recentUserMessages,
      recentChannelMessages,
      channelSummary,
      guildSummary,
      knownUsers,
      serverContext,
      userContext,
      contextStack,
    });
  } catch (err) {
    const now = Date.now();
    failureTimestamps.push(now);
    while (failureTimestamps.length && now - failureTimestamps[0] > failureWindowMs) {
      failureTimestamps.shift();
    }
    if (err?.code === 'VISION_UNSUPPORTED') {
      if (!warnedVisionUnsupported) {
        console.warn('Vision-capable model not available; returning guidance to configure GROK_VISION_MODEL.');
        warnedVisionUnsupported = true;
      }
      return 'image input needs a vision-capable model. set GROK_VISION_MODEL or use a multimodal GROK_MODEL.';
    }
    console.error('LLM request failed (first attempt):', err);
    if (failureTimestamps.length >= 6) {
      return fallbackErrorLine;
    }
    const retryDelay = failureTimestamps.length >= 3 ? 1200 : 300;
    await delay(retryDelay);
    try {
      return await callOnce({
        botName,
        profileSummary,
        recentTurns,
        userContent,
        replyContext,
        imageInputs,
        forceVision,
        recentUserMessages,
        recentChannelMessages,
        channelSummary,
        guildSummary,
        knownUsers,
        serverContext,
        userContext,
        contextStack,
      });
    } catch (retryErr) {
      const retryNow = Date.now();
      failureTimestamps.push(retryNow);
      while (failureTimestamps.length && retryNow - failureTimestamps[0] > failureWindowMs) {
        failureTimestamps.shift();
      }
      if (retryErr?.code === 'VISION_UNSUPPORTED') {
        if (!warnedVisionUnsupported) {
          console.warn('Vision-capable model not available; returning guidance to configure GROK_VISION_MODEL.');
          warnedVisionUnsupported = true;
        }
        return 'image input needs a vision-capable model. set GROK_VISION_MODEL or use a multimodal GROK_MODEL.';
      }
      console.error('LLM request failed (retry):', retryErr);
      return fallbackErrorLine;
    }
  }
}
