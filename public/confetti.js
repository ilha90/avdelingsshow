// public/confetti.js — canvas-basert konfetti
let canvas = null;
let ctx = null;
let particles = [];
let rafId = null;

function ensureCanvas(){
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'confetti-canvas';
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '9999'
  });
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize(){
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

const COLORS = ['#ff5a6b','#ffcf4a','#2fbf71','#5cc7ff','#b074ff','#ff9d4a','#5de0ae'];

export function burst({ x = window.innerWidth/2, y = window.innerHeight/2, count = 90 } = {}){
  ensureCanvas();
  for (let i=0;i<count;i++){
    const a = Math.random() * Math.PI * 2;
    const s = 3 + Math.random() * 8;
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 3,
      size: 4 + Math.random() * 6,
      color: COLORS[(Math.random()*COLORS.length)|0],
      rot: Math.random() * Math.PI,
      vr: (Math.random()-0.5) * 0.3,
      life: 100 + Math.random()*60
    });
  }
  if (!rafId) loop();
}

export function shower(count = 140){
  ensureCanvas();
  for (let i=0;i<count;i++){
    particles.push({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * 200,
      vx: (Math.random()-0.5) * 3,
      vy: 2 + Math.random() * 4,
      size: 5 + Math.random() * 7,
      color: COLORS[(Math.random()*COLORS.length)|0],
      rot: Math.random() * Math.PI,
      vr: (Math.random()-0.5) * 0.3,
      life: 200 + Math.random()*100
    });
  }
  if (!rafId) loop();
}

function loop(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.14;
    p.vx *= 0.995;
    p.rot += p.vr;
    p.life -= 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life/60));
    ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
    ctx.restore();
  });
  particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 50);
  if (particles.length){
    rafId = requestAnimationFrame(loop);
  } else {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    rafId = null;
  }
}
