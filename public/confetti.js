// confetti.js — canvas-basert konfetti
const canvas = document.getElementById('confetti');
if (canvas) {
  const ctx = canvas.getContext('2d');
  let particles = [];
  let running = false;

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  resize();
  window.addEventListener('resize', resize);

  const colors = ['#d4af37', '#f5d77a', '#e54b4b', '#3a86ff', '#29c46a', '#ffbe0b', '#a855f7'];

  function spawn(n = 120, originX = window.innerWidth / 2, originY = window.innerHeight / 3) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: originX + (Math.random() - 0.5) * 200,
        y: originY + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 14,
        vy: Math.random() * -14 - 4,
        g: 0.35,
        size: 6 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        life: 180 + Math.random() * 120,
        shape: Math.random() < 0.5 ? 'rect' : 'circle',
      });
    }
    if (!running) { running = true; loop(); }
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life -= 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 60));
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    });
    if (particles.length) requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  window.confetti = { spawn, burst: () => {
    spawn(80, window.innerWidth * 0.25, window.innerHeight * 0.4);
    spawn(80, window.innerWidth * 0.75, window.innerHeight * 0.4);
  }};
}
