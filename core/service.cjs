const { generate } = require('./assistant.cjs');
const { transcribe } = require('./speech.cjs');
const { recognizeBoard } = require('./chess-vision.cjs');
function createService({ initial = {}, save = async () => {}, canRemember = false, fetchImpl } = {}) {
  let settings = { key: initial.key || process.env.GEMINI_API_KEY || '', model: initial.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    groqKey: initial.groqKey || process.env.GROQ_API_KEY || '', voiceProvider: initial.voiceProvider || 'groq',
    transcriptionModel: initial.transcriptionModel || 'whisper-large-v3-turbo', vocabulary: initial.vocabulary || '' };
  let active;
  const status = () => ({ hasKey: Boolean(settings.key), model: settings.model, canRemember,
    hasGroqKey: Boolean(settings.groqKey), voiceProvider: settings.voiceProvider, transcriptionModel: settings.transcriptionModel, vocabulary: settings.vocabulary });
  return {
    async recognizeBoard(image, options = {}) {
      if (active) throw new Error('Wait for the current request or cancel it.');
      const controller = new AbortController(); active = controller;
      try { return await recognizeBoard(image, settings, { ...options, fetchImpl, signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal }); }
      finally { if (active === controller) active = null; }
    },
    async call(action, payload) {
      if (action === 'settings') return status();
      if (action === 'configure') {
        if (!payload || typeof payload.model !== 'string' || !/^[\w.-]{1,100}$/.test(payload.model)) throw new Error('Enter a valid model ID.');
        if (payload.key !== undefined && (typeof payload.key !== 'string' || payload.key.length > 500)) throw new Error('Invalid API key.');
        if (payload.groqKey !== undefined && (typeof payload.groqKey !== 'string' || payload.groqKey.length > 500)) throw new Error('Invalid Groq API key.');
        if (payload.voiceProvider && !['groq', 'gemini'].includes(payload.voiceProvider)) throw new Error('Unknown voice provider.');
        if (payload.transcriptionModel && !['whisper-large-v3', 'whisper-large-v3-turbo'].includes(payload.transcriptionModel)) throw new Error('Unknown transcription model.');
        const next = { ...settings, model: payload.model, key: payload.clearKey ? '' : (payload.key?.trim() || settings.key),
          groqKey: payload.clearKey ? '' : (payload.groqKey?.trim() || settings.groqKey),
          voiceProvider: payload.voiceProvider || settings.voiceProvider, transcriptionModel: payload.transcriptionModel || settings.transcriptionModel,
          vocabulary: typeof payload.vocabulary === 'string' ? payload.vocabulary.slice(0, 800) : settings.vocabulary };
        await save({ ...next, key: payload.remember && canRemember ? next.key : '', groqKey: payload.remember && canRemember ? next.groqKey : '' });
        settings = next;
        return status();
      }
      if (action === 'cancel') { active?.abort(); return { cancelled: true }; }
      if (action !== 'generate') throw new Error('Unknown action.');
      if (active) throw new Error('Wait for the current request or cancel it.');
      const controller = new AbortController(); active = controller;
      try { return await (payload?.action === 'transcribe' && settings.voiceProvider === 'groq' ? transcribe : generate)(payload, settings, { signal: controller.signal, fetchImpl }); }
      finally { if (active === controller) active = null; }
    }
  };
}
module.exports = { createService };
