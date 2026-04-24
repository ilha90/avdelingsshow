// tts.js — Text-to-speech med voice-picker
let enabled = JSON.parse(localStorage.getItem('tts-on') ?? 'false');
let presetKey = localStorage.getItem('tts-preset') || 'normal';
let voiceURI = localStorage.getItem('tts-voice') || '';
let cachedVoice = null;
let voicesReady = null;
let voicesList = [];

export const PRESETS = {
  normal:      { rate: 1.00, pitch: 1.00, label: '🎙️ Normal',      desc: 'Vanlig' },
  sportsanker: { rate: 1.22, pitch: 1.10, label: '📺 Sportsanker',  desc: 'Rask og dramatisk' },
  drama:       { rate: 0.78, pitch: 0.70, label: '🎭 Drama',        desc: 'Dyp og mystisk' },
  chipmunk:    { rate: 1.15, pitch: 2.00, label: '🐿️ Chipmunk',     desc: 'Høy og hysterisk' },
  overivrig:   { rate: 1.45, pitch: 1.35, label: '🤪 Overivrig',    desc: 'Altfor gira' },
  robot:       { rate: 0.85, pitch: 0.50, label: '🤖 Robot',        desc: 'Monoton og dyp' },
};

function refreshVoices() {
  if (!('speechSynthesis' in window)) return [];
  voicesList = speechSynthesis.getVoices() || [];
  return voicesList;
}

function pickVoice() {
  const voices = refreshVoices();
  if (!voices.length) return null;
  // Brukerens valg først
  if (voiceURI) {
    const v = voices.find(vv => vv.voiceURI === voiceURI);
    if (v) return v;
  }
  // Så norsk
  return voices.find(v => /^nb|^no/i.test(v.lang))
      || voices.find(v => /norwegian|norsk/i.test(v.name))
      || voices.find(v => /^sv|^da/i.test(v.lang))
      || voices.find(v => /^en/i.test(v.lang))
      || voices.find(v => v.default)
      || voices[0];
}

function ensureVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const v = speechSynthesis.getVoices();
    if (v.length) { voicesList = v; cachedVoice = pickVoice(); resolve(); return; }
    const onChange = () => { voicesList = speechSynthesis.getVoices() || []; cachedVoice = pickVoice(); speechSynthesis.removeEventListener('voiceschanged', onChange); resolve(); };
    speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(() => { voicesList = speechSynthesis.getVoices() || []; if (!cachedVoice) cachedVoice = pickVoice(); resolve(); }, 2000);
  });
  return voicesReady;
}

if ('speechSynthesis' in window) {
  ensureVoices();
  // Låse opp ved første bruker-gesture
  document.addEventListener('click', () => {
    if (!cachedVoice) cachedVoice = pickVoice();
  }, { once: true });
}

export async function speak(text) {
  if (!enabled || !text) return;
  if (!('speechSynthesis' in window)) { console.warn('[TTS] speechSynthesis ikke støttet'); return; }
  try {
    await ensureVoices();
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      await new Promise(r => setTimeout(r, 80));
    }
    const u = new SpeechSynthesisUtterance(String(text));
    if (!cachedVoice) cachedVoice = pickVoice();
    if (cachedVoice) u.voice = cachedVoice;
    u.lang = cachedVoice?.lang || 'nb-NO';
    const p = PRESETS[presetKey] || PRESETS.normal;
    u.rate = p.rate;
    u.pitch = p.pitch;
    u.volume = 1;
    u.onerror = (e) => console.warn('[TTS] error:', e?.error || e);
    u.onend = () => { /* no-op */ };
    speechSynthesis.speak(u);
  } catch (e) {
    console.warn('[TTS] speak() failed:', e);
  }
}

export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
export function isOn() { return enabled; }
export function setOn(v) { enabled = !!v; localStorage.setItem('tts-on', JSON.stringify(enabled)); }
export function toggle() { setOn(!enabled); return enabled; }
export function getPreset() { return presetKey; }
export function setPreset(key) { if (!PRESETS[key]) return; presetKey = key; localStorage.setItem('tts-preset', key); }

export function listVoices() {
  refreshVoices();
  return voicesList.map(v => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
}
export function getVoiceURI() { return voiceURI; }
export function setVoice(uri) {
  voiceURI = uri || '';
  localStorage.setItem('tts-voice', voiceURI);
  cachedVoice = pickVoice();
}
export function getCurrentVoice() {
  if (!cachedVoice) cachedVoice = pickVoice();
  return cachedVoice ? { name: cachedVoice.name, lang: cachedVoice.lang } : null;
}
export function testVoice() {
  const prev = enabled; enabled = true;
  const v = getCurrentVoice();
  speak(v ? `Hei, det er ${v.name} som leser for deg.` : 'Klar for en runde? Første spørsmål kommer nå.');
  enabled = prev;
}
export function hasSupport() { return 'speechSynthesis' in window; }
