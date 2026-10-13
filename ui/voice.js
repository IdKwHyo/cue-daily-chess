let speaking = false, cancelled = false, generation = 0;
const languageCode = language => ({ Thai: 'th-TH', 'Chinese (Traditional)': 'zh-TW', 'Chinese (Simplified)': 'zh-CN' }[language] || 'en-US');
export const isSpeaking = () => speaking;
export async function stopSpeaking() {
  cancelled = true;
  generation++;
  if (window.desktop?.platform === 'darwin') await window.desktop.stopSpeaking();
  else window.speechSynthesis?.cancel();
  speaking = false;
}
export async function readAloud(text, language, onState) {
  await stopSpeaking(); cancelled = false; speaking = true; onState(true);
  const run = ++generation;
  try {
    if (window.desktop?.platform === 'darwin') { await window.desktop.speak(text); return; }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error('No text-to-speech engine is available here. Use Cue on your Mac.');
    // Speak short chunks so longer answers work across browser speech engines.
    const chunks = text.match(/[^.!?\n]{1,220}(?:[.!?\n]+|$)|.{1,220}/g) || [text];
    const lang = languageCode(language);
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => v.localService && v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    for (const chunk of chunks) {
      if (cancelled || run !== generation) break;
      await new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(chunk); utterance.lang = lang; utterance.rate = 1;
        if (voice) utterance.voice = voice;
        utterance.onend = resolve;
        utterance.onerror = event => ['interrupted', 'canceled'].includes(event.error) ? resolve() : reject(new Error(`Voice playback failed (${event.error}). Check installed system voices.`));
        speechSynthesis.speak(utterance);
      });
    }
  } finally { if (run === generation) { speaking = false; onState(false); } }
}
