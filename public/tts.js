// tts.js — minimal & reliable
// Leser opp spørsmål og trofé-annonseringer.
// Ingen presets, ingen voice-meny. Bruker beste tilgjengelige norske stemme.

const SS = window.speechSynthesis;
let enabled = JSON.parse(localStorage.getItem('tts-on') ?? 'true');
let voice = null;
let primed = false;
const listeners = new Set();

function notify(state) { listeners.forEach(fn => { try { fn(state); } catch {} }); }
export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function hasSupport() { return !!SS; }

function loadVoice() {
  if (!SS) return;
  const voices = SS.getVoices();
  if (!voices.length) return;
  voice = voices.find(v => /^nb|^no/i.test(v.lang))
       || voices.find(v => /norwegian|norsk/i.test(v.name))
       || voices.find(v => /^sv|^da/i.test(v.lang))
       || voices.find(v => /^en/i.test(v.lang))
       || voices[0];
  console.log('[TTS] voice:', voice?.name, voice?.lang);
}

if (SS) {
  loadVoice();
  SS.addEventListener?.('voiceschanged', loadVoice);
  setTimeout(loadVoice, 500);
  setTimeout(loadVoice, 1500);

  // Prime: én stille utterance ved første bruker-gesture (låser opp autoplay i Chrome/Safari)
  function prime() {
    if (primed) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      SS.speak(u);
      primed = true;
      console.log('[TTS] primed');
    } catch {}
  }
  ['pointerdown', 'click', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, prime, { capture: true })
  );

  // Chrome pause-bug: engine stopper seg selv etter ~15s silence
  setInterval(() => { if (SS.paused) SS.resume(); }, 5000);
}

// Kø av tekster som venter på å bli lest
const queue = [];
let processing = false;

function processQueue() {
  if (processing) return;
  const text = queue.shift();
  if (!text) return;
  if (!SS || !enabled) return;
  if (!voice) loadVoice();

  processing = true;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  else u.lang = 'nb-NO';
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1;
  u.onstart = () => { console.log('[TTS]', text.slice(0, 40)); notify('speaking'); };
  u.onend = () => { processing = false; notify('idle'); processQueue(); };
  u.onerror = (e) => {
    processing = false;
    notify('idle');
    const err = e?.error;
    if (err && err !== 'canceled' && err !== 'interrupted') {
      console.warn('[TTS] error:', err);
    }
    processQueue();
  };

  try {
    SS.speak(u);
    if (SS.paused) SS.resume();
  } catch (e) {
    console.warn('[TTS] speak failed:', e);
    processing = false;
    processQueue();
  }
}

export function speak(text) {
  if (!enabled || !text) return;
  if (!SS) return;
  queue.push(String(text).slice(0, 300));
  processQueue();
}

export function stop() {
  queue.length = 0;
  processing = false;
  if (SS) SS.cancel();
  notify('idle');
}

export function isOn() { return enabled; }
export function setOn(v) {
  enabled = !!v;
  localStorage.setItem('tts-on', JSON.stringify(enabled));
  if (!enabled) stop();
}
export function toggle() { setOn(!enabled); return enabled; }
export function test() {
  const prev = enabled; enabled = true;
  speak(voice ? `Hei, jeg heter ${voice.name}.` : 'Hei, klar for en runde?');
  enabled = prev;
}
