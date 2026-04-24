// tts.js — Text-to-speech, robust
// Default: PÅ. Kan skrus av via menyen.
let enabled = JSON.parse(localStorage.getItem('tts-on') ?? 'true');
let presetKey = localStorage.getItem('tts-preset') || 'normal';
let voiceURI = localStorage.getItem('tts-voice') || '';
let cachedVoice = null;
let voicesList = [];
let primed = false;
let lastSpeakState = 'idle'; // idle | speaking | error
const listeners = new Set();

export const PRESETS = {
  normal:      { rate: 1.00, pitch: 1.00, label: '🎙️ Normal',      desc: 'Vanlig' },
  sportsanker: { rate: 1.22, pitch: 1.10, label: '📺 Sportsanker',  desc: 'Rask og dramatisk' },
  drama:       { rate: 0.78, pitch: 0.70, label: '🎭 Drama',        desc: 'Dyp og mystisk' },
  chipmunk:    { rate: 1.15, pitch: 2.00, label: '🐿️ Chipmunk',     desc: 'Høy og hysterisk' },
  overivrig:   { rate: 1.45, pitch: 1.35, label: '🤪 Overivrig',    desc: 'Altfor gira' },
  robot:       { rate: 0.85, pitch: 0.50, label: '🤖 Robot',        desc: 'Monoton og dyp' },
};

const hasSpeech = 'speechSynthesis' in window;

function refreshVoices() {
  if (!hasSpeech) return [];
  voicesList = speechSynthesis.getVoices() || [];
  return voicesList;
}

function pickVoice() {
  const voices = refreshVoices();
  if (!voices.length) return null;
  if (voiceURI) {
    const v = voices.find(vv => vv.voiceURI === voiceURI);
    if (v) return v;
  }
  return voices.find(v => /^nb|^no/i.test(v.lang))
      || voices.find(v => /norwegian|norsk/i.test(v.name))
      || voices.find(v => /^sv|^da/i.test(v.lang))
      || voices.find(v => /^en/i.test(v.lang))
      || voices[0];
}

// Last inn stemmer — noen browsere laster dem async
if (hasSpeech) {
  refreshVoices();
  cachedVoice = pickVoice();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {
      refreshVoices();
      if (!cachedVoice) cachedVoice = pickVoice();
      console.log('[TTS] voices loaded:', voicesList.length, 'picked:', cachedVoice?.name);
    };
  }
  // Poll fallback (noen Safari-versjoner fyrer aldri voiceschanged)
  setTimeout(() => {
    if (voicesList.length === 0) { refreshVoices(); cachedVoice = pickVoice(); }
    console.log('[TTS] init. voices:', voicesList.length, 'primed:', primed, 'enabled:', enabled);
  }, 1000);
}

// Prime synthesis-engine ved første user gesture (kreves av Chrome/Safari autoplay-policy)
// Bruker en virkelig (men stille) utterance — tom streng teller ikke hos alle browsere.
function primeAudio() {
  if (primed || !hasSpeech) return;
  try {
    speechSynthesis.cancel(); // rens køen
    const u = new SpeechSynthesisUtterance('.');
    u.volume = 0;
    u.rate = 10;
    speechSynthesis.speak(u);
    primed = true;
    console.log('[TTS] primed via user gesture');
  } catch (e) { console.warn('[TTS] prime failed:', e); }
}

if (hasSpeech) {
  const primeOnce = () => {
    if (primed) return;
    if (!cachedVoice) cachedVoice = pickVoice();
    primeAudio();
  };
  ['click', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, primeOnce, { capture: true });
  });
}

function notify(state) {
  lastSpeakState = state;
  listeners.forEach(fn => { try { fn(state); } catch {} });
}
export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return lastSpeakState; }

// Chrome-bug workaround: speechSynthesis pauser seg selv etter ~15s.
// Resume-ping hvert 10. sekund holder den i gang.
if (hasSpeech) {
  setInterval(() => {
    if (speechSynthesis.speaking && speechSynthesis.paused) {
      speechSynthesis.resume();
    }
  }, 10000);
}

export function speak(text) {
  if (!enabled || !text) return;
  if (!hasSpeech) { console.warn('[TTS] not supported'); notify('error'); return; }

  // Sikre at stemmer er lastet
  if (voicesList.length === 0) {
    refreshVoices();
    if (!cachedVoice) cachedVoice = pickVoice();
  }

  const u = new SpeechSynthesisUtterance(String(text).slice(0, 500));
  if (cachedVoice) {
    u.voice = cachedVoice;
    u.lang = cachedVoice.lang || 'nb-NO';
  } else {
    u.lang = 'nb-NO';
  }
  const p = PRESETS[presetKey] || PRESETS.normal;
  u.rate = p.rate;
  u.pitch = p.pitch;
  u.volume = 1;
  u.onstart = () => { console.log('[TTS] start:', String(text).slice(0, 40)); notify('speaking'); };
  u.onend = () => { console.log('[TTS] end'); notify('idle'); };
  u.onerror = (e) => {
    const err = e?.error || 'unknown';
    // "canceled" og "interrupted" er normale — oppstår når stopSpeaking kalles
    if (err !== 'canceled' && err !== 'interrupted') console.warn('[TTS] error:', err);
    notify('idle');
  };

  // Hvis engine allerede snakker/har kø, cancel først og vent litt (Chrome-bug fix)
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => {
      try {
        speechSynthesis.speak(u);
        if (speechSynthesis.paused) speechSynthesis.resume();
      } catch (e) { console.warn('[TTS] speak retry failed:', e); }
    }, 150);
  } else {
    try {
      speechSynthesis.speak(u);
      if (speechSynthesis.paused) speechSynthesis.resume();
    } catch (e) {
      console.warn('[TTS] speak failed:', e);
      notify('error');
    }
  }
}

export function stopSpeaking() {
  if (hasSpeech) speechSynthesis.cancel();
  notify('idle');
}
export function isOn() { return enabled; }
export function setOn(v) {
  enabled = !!v;
  localStorage.setItem('tts-on', JSON.stringify(enabled));
  if (enabled) primeAudio();
  else stopSpeaking();
}
export function toggle() { setOn(!enabled); return enabled; }
export function getPreset() { return presetKey; }
export function setPreset(key) { if (!PRESETS[key]) return; presetKey = key; localStorage.setItem('tts-preset', key); }
export function listVoices() { refreshVoices(); return voicesList.map(v => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService })); }
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
  const prev = enabled;
  enabled = true;
  primeAudio();
  const v = getCurrentVoice();
  speak(v ? `Hei, det er ${v.name} som leser for deg.` : 'Klar for en runde?');
  enabled = prev;
}
export function hasSupport() { return hasSpeech; }
