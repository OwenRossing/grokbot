const PROFESSIONAL_COPY = {
  llm_default_unknown_answer: 'I do not have enough information to answer that.',
  llm_fallback_error: 'I could not process that request right now due to an upstream API error.',
  llm_vision_unsupported: 'Image input requires a vision-capable model. Set GROK_VISION_MODEL or use a multimodal GROK_MODEL.',
  refusal_hate_speech: 'I cannot help with hateful or abusive content.',
};

const CASUAL_COPY = {
  llm_default_unknown_answer: 'idk tbh',
  llm_fallback_error: 'cant answer rn bro too busy gooning (grok api error)',
  llm_vision_unsupported: 'image input needs a vision-capable model. set GROK_VISION_MODEL or use a multimodal GROK_MODEL.',
  refusal_hate_speech: 'nah, not touching that.',
};

function isCasualTone() {
  return String(process.env.BOT_TONE || 'professional').trim().toLowerCase() === 'casual';
}

export function getCopy(key) {
  const source = isCasualTone() ? CASUAL_COPY : PROFESSIONAL_COPY;
  return source[key] || PROFESSIONAL_COPY[key] || '';
}
