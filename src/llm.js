import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_MODEL = process.env.GROK_MODEL || 'grok-beta';

const systemPrompt = `You are a Discord assistant named {BOT_NAME}.
Guidelines:
- Keep replies short (1-3 sentences).
- Use modern slang naturally, not constantly.
- Deadpan jokes are occasional (10-20%), single-line only.
- Match the user's tone.
- Escalate into flirty/sexual only if the user initiates.
- If unsure, admit uncertainty briefly.
- Avoid essays and heavy formatting.
- If you risk exceeding the limit, shorten the response instead of cutting off.
- No slurs, hate speech, or harassment of protected groups.`;

const fallbackErrorLine =
  'cant answer rn bro too busy gooning (grok servers left like my dad)';

function buildMessages({ botName, profileSummary, recentTurns, userContent }) {
  const messages = [
    {
      role: 'system',
      content: systemPrompt.replace('{BOT_NAME}', botName),
    },
  ];

  if (profileSummary) {
    messages.push({
      role: 'system',
      content: `User profile summary: ${profileSummary}`,
    });
  }

  for (const turn of recentTurns) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}

async function callOnce({ botName, profileSummary, recentTurns, userContent }) {
  const res = await fetch(`${process.env.GROK_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.8,
      max_tokens: 250,
      messages: buildMessages({ botName, profileSummary, recentTurns, userContent }),
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM error: ${res.status}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || 'idk tbh';
}

export async function getLLMResponse({
  botName,
  profileSummary,
  recentTurns,
  userContent,
}) {
  try {
    return await callOnce({ botName, profileSummary, recentTurns, userContent });
  } catch (err) {
    await delay(300);
    try {
      return await callOnce({ botName, profileSummary, recentTurns, userContent });
    } catch (retryErr) {
      return fallbackErrorLine;
    }
  }
}
