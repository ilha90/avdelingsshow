// tts.js — Text-to-speech for spørsmål (morsomme stemme-presets)
let enabled = JSON.parse(localStorage.getItem('tts-on') ?? 'false');
let presetKey = localStorage.getItem('tts-preset') || 'normal';
let cachedVoice = null;
let voicesReady = null;

export const PRESETS = {
  normal:      { rate: 1.00, pitch: 1.00, label: '🎙️ Normal',      desc: 'Vanlig opplesning' },
  sportsanker: { rate: 1.22, pitch: 1.10, label: '📺 Sportsanker',  desc: 'Rask og dramatisk' },
  drama:       { rate: 0.78, pitch: 0.70, label: '🎭 Drama',        desc: 'Dyp og mystisk' },
  chipmunk:    { rate: 1.15, pitch: 2.00, label: '🐿️ Chipmunk',     desc: 'Høy og hysterisk' },
  overivrig:   { rate: 1.45, pitch: 1.35, label: '🤪 Overivrig',    desc: 'Altfor gira' },
  robot:       { rate: 0.85, pitch: 0.50, label: '🤖 Robot',        desc: 'Monoton og dyp' },
};

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Prioritet: norsk → skandinavisk → engelsk → første
  const nb = voices.find(v => /^nb|^no/i.test(v.lang))
          || voices.find(v => /norwegian|norsk/i.test(v.name));
  if (nb) return nb;
  const scandi = voices.find(v => /^sv|^da/i.test(v.lang));
  if (scandi) return scandi;
  const en = voices.find(v => /^en/i.test(v.lang));
  if (en) return en;
  return voices[0];
}

function ensureVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const v = speechSynthesis.getVoices();
    if (v.length) { cachedVoice = pickVoice(); resolve(); return; }
    const onChange = () => { cachedVoice = pickVoice(); speechSynthesis.removeEventListener('voiceschanged', onChange); resolve(); };
    speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(() => { if (!cachedVoice) cachedVoice = pickVoice(); resolve(); }, 1500);
  });
  return voicesReady;
}

// Warm up voices + utlå audio-permission ved første klikk
if ('speechSynthesis' in window) {
  ensureVoices();
  document.addEventListener('click', () => {
    // Trigger et tomt utterance for å låse opp audio hvis trengs
    if (!cachedVoice) ensureVoices();
  }, { once: true });
}

export async function speak(text) {
  if (!enabled || !text) return;
  if (!('speechSynthesis' in window)) return;
  try {
    await ensureVoices();
    // Noen browsers trenger at speaking avbrytes først
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      await new Promise(r => setTimeout(r, 80));
    }
    const u = new SpeechSynthesisUtterance(String(text));
    if (cachedVoice) u.voice = cachedVoice;
    u.lang = cachedVoice?.lang || 'nb-NO';
    const p = PRESETS[presetKey] || PRESETS.normal;
    u.rate = p.rate;
    u.pitch = p.pitch;
    u.volume = 1;
    u.onerror = (e) => console.warn('[TTS] error:', e?.error);
    speechSynthesis.speak(u);
  } catch (e) {
    console.warn('[TTS] speak() failed:', e);
  }
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
export function isOn() { return enabled; }
export function setOn(v) { enabled = !!v; localStorage.setItem('tts-on', JSON.stringify(enabled)); }
export function toggle() { setOn(!enabled); return enabled; }
export function getPreset() { return presetKey; }
export function setPreset(key) { if (!PRESETS[key]) return; presetKey = key; localStorage.setItem('tts-preset', key); }
export function testVoice() {
  const prev = enabled; enabled = true;
  speak('Klar for en runde? Første spørsmål kommer nå.');
  enabled = prev;
}
export function listVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices();
}
