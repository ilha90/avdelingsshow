// tts.js — Text-to-speech for spørsmål (morsomme stemme-presets)
let enabled = JSON.parse(localStorage.getItem('tts-on') ?? 'false');
let presetKey = localStorage.getItem('tts-preset') || 'normal';
let cachedVoice = null;

export const PRESETS = {
  normal:      { rate: 1.00, pitch: 1.00, label: '🎙️ Normal',      desc: 'Vanlig opplesning' },
  sportsanker: { rate: 1.22, pitch: 1.10, label: '📺 Sportsanker',  desc: 'Rask og dramatisk' },
  drama:       { rate: 0.78, pitch: 0.70, label: '🎭 Drama',        desc: 'Dyp og mystisk' },
  chipmunk:    { rate: 1.15, pitch: 2.00, label: '🐿️ Chipmunk',     desc: 'Høy og hysterisk' },
  overivrig:   { rate: 1.45, pitch: 1.35, label: '🤪 Overivrig',    desc: 'Altfor gira' },
  robot:       { rate: 0.85, pitch: 0.50, label: '🤖 Robot',        desc: 'Monoton og dyp' },
};

function loadVoices() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Foretrekk norske stemmer
  const nb = voices.find(v => /^nb|^no/i.test(v.lang))
          || voices.find(v => /norwegian|norsk/i.test(v.name));
  if (nb) return nb;
  // Fallback til skandinaviske
  const scandi = voices.find(v => /^sv|^da/i.test(v.lang));
  if (scandi) return scandi;
  // Ellers første beste
  return voices[0];
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { cachedVoice = loadVoices(); };
  cachedVoice = loadVoices();
}

export function speak(text) {
  if (!enabled || !text) return;
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    if (!cachedVoice) cachedVoice = loadVoices();
    if (cachedVoice) u.voice = cachedVoice;
    u.lang = cachedVoice?.lang || 'nb-NO';
    const p = PRESETS[presetKey] || PRESETS.normal;
    u.rate = p.rate;
    u.pitch = p.pitch;
    u.volume = 1;
    speechSynthesis.speak(u);
  } catch {}
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function isOn() { return enabled; }
export function setOn(v) { enabled = !!v; localStorage.setItem('tts-on', JSON.stringify(enabled)); }
export function toggle() { setOn(!enabled); return enabled; }

export function getPreset() { return presetKey; }
export function setPreset(key) {
  if (!PRESETS[key]) return;
  presetKey = key;
  localStorage.setItem('tts-preset', key);
}

export function testVoice() {
  const sample = 'Klar for en runde? Første spørsmål kommer nå.';
  const prev = enabled;
  enabled = true;
  speak(sample);
  enabled = prev;
}
