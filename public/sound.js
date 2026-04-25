// public/sound.js — Web Audio-sfx
let ctx = null;
let muted = false;

export function setMuted(v){ muted = !!v; }
export function isMuted(){ return muted; }

function ensure(){
  if (muted) return null;
  if (!ctx){
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
  return ctx;
}

function tone(freq, dur, type='sine', gain=0.15){
  const c = ensure(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur + 0.02);
}

function noise(dur, gain=0.2, filterFreq=800){
  const c = ensure(); if (!c) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate*dur), c.sampleRate);
  const arr = buf.getChannelData(0);
  for (let i=0;i<arr.length;i++) arr[i] = (Math.random()*2 - 1);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=filterFreq;
  const g = c.createGain(); g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start();
}

export const sfx = {
  tick(){ tone(1200, 0.04, 'square', 0.06); },
  countdown(){ tone(880, 0.08, 'triangle', 0.2); },
  go(){ tone(1400, 0.25, 'sawtooth', 0.22); },
  correct(){ tone(880, 0.1, 'triangle', 0.2); setTimeout(()=>tone(1320,0.18,'triangle',0.2), 90); },
  wrong(){ tone(220, 0.2, 'sawtooth', 0.18); },
  join(){ tone(660,0.08,'sine',0.15); setTimeout(()=>tone(990,0.12,'sine',0.15),70); },
  pop(){ tone(540,0.06,'triangle',0.14); },
  whoosh(){ noise(0.25, 0.22, 1400); },
  bomb(){ noise(0.5, 0.4, 350); },
  boom(){
    noise(0.7, 0.5, 200);
    tone(80, 0.6, 'sawtooth', 0.28);
    setTimeout(()=>tone(55,0.4,'sawtooth',0.22),50);
  },
  reveal(){ tone(520,0.1,'sine',0.2); setTimeout(()=>tone(660,0.1,'sine',0.2),90); setTimeout(()=>tone(880,0.2,'sine',0.2),180); },
  bigWin(){
    [660, 880, 990, 1320].forEach((f,i)=>setTimeout(()=>tone(f,0.18,'triangle',0.2), i*90));
  },
  buttonDown(){ tone(380,0.04,'square',0.06); },
  shield(){ tone(1100,0.15,'sine',0.18); },
  pickup(){ tone(1200,0.06,'sine',0.12); setTimeout(()=>tone(1600,0.08,'triangle',0.12),40); }
};

// Unlock audio on first user interaction
export function unlock(){
  if (!muted) ensure();
}
document.addEventListener('pointerdown', unlock, { once: true, passive: true });
document.addEventListener('keydown', unlock, { once: true });
