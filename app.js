// === AVDELINGSSHOW — APP LOGIC ===
'use strict';

// -------- UTIL --------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// -------- NAVIGASJON --------
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('.game-card').forEach(btn => {
  btn.addEventListener('click', () => {
    const game = btn.dataset.game;
    curtainTransition(() => {
      showScreen('game-' + game);
      if (game === 'wheel') renderWheel();
      if (game === 'emoji') startEmoji();
      if (game === 'blikjent') startBlikjent();
    });
  });
  // hover-spotlight posisjon
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    btn.style.setProperty('--mx', x + '%');
    btn.style.setProperty('--my', y + '%');
  });
  btn.addEventListener('mouseenter', () => Sound.hover());
});
$$('.back-btn').forEach(btn => btn.addEventListener('click', () => {
  curtainTransition(() => showScreen('hub'));
}));

// -------- INTRO-SPLASH --------
const introEl = $('#intro-splash');
function dismissIntro() {
  Sound.init();
  Sound.whoosh();
  introEl.classList.add('hide');
  setTimeout(() => introEl.remove(), 800);
  setTimeout(() => Confetti.burst({ x: innerWidth / 2, y: innerHeight / 2, count: 80, spread: Math.PI * 2, power: 12 }), 200);
}
introEl.addEventListener('click', dismissIntro);
document.addEventListener('keydown', (e) => {
  if (introEl.isConnected && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    dismissIntro();
  }
}, { once: false });

// -------- TOP-KONTROLLER --------
const muteBtn = $('#mute-btn');
function refreshMuteBtn() { muteBtn.textContent = Sound.isMuted() ? '🔇' : '🔊'; }
refreshMuteBtn();
muteBtn.onclick = () => { Sound.toggleMute(); refreshMuteBtn(); };
$('#fs-btn').onclick = () => Fullscreen.toggle();

// -------- TASTATURSNARVEIER --------
document.addEventListener('keydown', (e) => {
  if (introEl.isConnected) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;

  if (e.key === 'f' || e.key === 'F') { Fullscreen.toggle(); return; }
  if (e.key === 'm' || e.key === 'M') { Sound.toggleMute(); refreshMuteBtn(); return; }
  if (e.key === 'Escape') {
    if (!$('#hub').classList.contains('active')) {
      curtainTransition(() => showScreen('hub'));
    }
    return;
  }

  // Quiz-spesifikt
  if ($('#game-quiz').classList.contains('active') && $('#quiz-play').style.display !== 'none') {
    if (['1', '2', '3', '4'].includes(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const btns = $$('#q-answers .q-answer');
      if (btns[idx] && !btns[idx].classList.contains('disabled')) btns[idx].click();
    }
    if (e.key === 'Enter' && $('#q-reveal').style.display !== 'none') $('#next-q-btn').click();
  }

  // Hjul: space = spinn
  if ($('#game-wheel').classList.contains('active') && e.key === ' ') {
    e.preventDefault();
    $('#spin-btn').click();
  }

  // Emoji
  if ($('#game-emoji').classList.contains('active')) {
    if (e.key === ' ') { e.preventDefault(); $('#emoji-reveal-btn').click(); }
    if (e.key === 'ArrowRight' || e.key === 'Enter') $('#emoji-next-btn').click();
  }

  // Bli-kjent
  if ($('#game-blikjent').classList.contains('active') && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    $('#blikjent-draw-btn').click();
  }
});

// -------- BAKGRUNN: PARTIKLER --------
(function initBg() {
  const c = $('#bg-canvas');
  const ctx = c.getContext('2d');
  let W, H, particles = [];
  function resize() {
    W = c.width = innerWidth;
    H = c.height = innerHeight;
    particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.8 + 0.3,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      alpha: Math.random() * 0.5 + 0.2
    }));
  }
  resize();
  addEventListener('resize', resize);
  function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(212, 175, 55, ' + p.alpha + ')';
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ============================================================
// QUIZ
// ============================================================
let quizTeams = [];
let quizQuestions = [];
let quizIdx = 0;
let quizTimer = null;
let quizTimeLeft = 20;
let quizAnswered = false;

function renderTeams() {
  const list = $('#team-list');
  list.innerHTML = '';
  quizTeams.forEach((t, i) => {
    const chip = document.createElement('div');
    chip.className = 'team-chip';
    chip.innerHTML = '<span>' + t.name + '</span><span class="remove">✕</span>';
    chip.querySelector('.remove').onclick = () => {
      quizTeams.splice(i, 1);
      renderTeams();
    };
    list.appendChild(chip);
  });
  $('#start-quiz-btn').disabled = quizTeams.length < 1;
}

$('#add-team-btn').onclick = () => {
  const input = $('#team-name-input');
  const name = input.value.trim();
  if (!name) return;
  quizTeams.push({ name, score: 0 });
  input.value = '';
  input.focus();
  renderTeams();
};
$('#team-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#add-team-btn').click();
});

$('#start-quiz-btn').onclick = () => {
  quizQuestions = shuffle(QUIZ_QUESTIONS).slice(0, 15);
  quizIdx = 0;
  quizTeams.forEach(t => { t.score = 0; t.streak = 0; });
  $('#quiz-setup').style.display = 'none';
  $('#quiz-end').style.display = 'none';
  $('#quiz-play').style.display = 'block';
  runCountdown(() => renderQuestion());
};

function runCountdown(cb) {
  const overlay = $('#countdown-overlay');
  const num = $('#countdown-num');
  overlay.classList.add('show');
  let n = 3;
  function step() {
    num.textContent = n;
    num.className = 'countdown-number';
    // trigger animation
    num.offsetHeight;
    num.style.animation = 'none';
    num.offsetHeight;
    num.style.animation = '';
    Sound.countdown();
    n--;
    if (n < 0) {
      num.textContent = 'GO!';
      num.classList.add('go');
      Sound.go();
      setTimeout(() => { overlay.classList.remove('show'); cb && cb(); }, 900);
    } else {
      setTimeout(step, 900);
    }
  }
  step();
}

function renderQuestion() {
  quizAnswered = false;
  const q = quizQuestions[quizIdx];
  $('#q-progress').textContent = (quizIdx + 1) + ' / ' + quizQuestions.length;
  $('#q-question').textContent = q.q;
  $('#q-reveal').style.display = 'none';

  const wrap = $('#q-answers');
  wrap.innerHTML = '';
  q.a.forEach((ans, i) => {
    const btn = document.createElement('button');
    btn.className = 'q-answer';
    btn.innerHTML = '<span class="letter">' + 'ABCD'[i] + '</span><span>' + ans + '</span>';
    btn.onclick = () => handleAnswer(i, btn);
    wrap.appendChild(btn);
  });

  // timer
  quizTimeLeft = 20;
  updateTimer();
  clearInterval(quizTimer);
  quizTimer = setInterval(() => {
    quizTimeLeft--;
    updateTimer();
    if (quizTimeLeft <= 0) {
      clearInterval(quizTimer);
      if (!quizAnswered) revealAnswer(null);
    }
  }, 1000);
}

function updateTimer() {
  const el = $('#q-timer');
  el.textContent = quizTimeLeft;
  el.classList.toggle('warn', quizTimeLeft <= 5);
  if (quizTimeLeft <= 5 && quizTimeLeft > 0) Sound.tick();
}

function handleAnswer(idx, btn) {
  if (quizAnswered) return;
  quizAnswered = true;
  clearInterval(quizTimer);
  const q = quizQuestions[quizIdx];
  if (idx === q.correct) {
    Sound.correct();
    flashOverlay('RIKTIG!', 'correct');
    Confetti.burst({ x: innerWidth / 2, y: innerHeight * 0.5, count: 60, spread: Math.PI, power: 14 });
  } else {
    Sound.wrong();
    flashOverlay('FEIL!', 'wrong');
    screenShake(350);
  }
  setTimeout(() => revealAnswer(idx, btn), 400);
}

function revealAnswer(chosenIdx, btn) {
  const q = quizQuestions[quizIdx];
  $$('#q-answers .q-answer').forEach((b, i) => {
    b.classList.add('disabled');
    if (i === q.correct) b.classList.add('correct');
    else if (i === chosenIdx) b.classList.add('wrong');
  });

  if (chosenIdx === null) {
    Sound.buzzer();
    flashOverlay('TIDEN UT!', 'wrong');
  }

  $('#reveal-text').textContent = chosenIdx === q.correct
    ? '✓ Riktig! Hvilket lag svarte først?'
    : chosenIdx === null
      ? '⏰ Tiden gikk ut. Riktig svar: ' + q.a[q.correct]
      : 'Riktig svar: ' + q.a[q.correct];

  // score table: trykk på lag = +1 poeng (med streak-bonus)
  const table = $('#score-table');
  table.innerHTML = '';
  quizTeams.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const bonus = t.streak >= 2 ? ' 🔥' : '';
    row.innerHTML = '<span class="team">' + t.name + bonus + '</span>' +
                    '<span class="pts"><span class="pts-val">' + t.score + '</span> poeng · +</span>';
    row.onclick = () => {
      if (row.classList.contains('scored')) return;
      row.classList.add('scored');
      t.streak = (t.streak || 0) + 1;
      const points = 1 + (t.streak >= 3 ? 1 : 0); // +1 bonus fra 3 på rad
      const before = t.score;
      t.score += points;
      // nullstill streak for andre lag? Nei — kun laget som IKKE får poeng mister streak
      quizTeams.forEach(ot => { if (ot !== t) ot.streak = 0; });
      animateCounter(row.querySelector('.pts-val'), before, t.score);
      row.querySelector('.pts').innerHTML = '<span class="pts-val">' + t.score + '</span> poeng ' +
        (points > 1 ? '<strong style="color:var(--gold)">+' + points + ' 🔥</strong>' : '✓');
      Sound.correct();
      if (t.streak >= 3) {
        Sound.streak();
        Confetti.burst({ x: innerWidth / 2, y: innerHeight / 2, count: 40, power: 12 });
      }
    };
    table.appendChild(row);
  });

  $('#q-reveal').style.display = 'block';

  // streak-indikator i header
  const leader = quizTeams.slice().sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];
  const streakEl = $('#q-streak');
  if (leader && leader.streak >= 2) {
    streakEl.textContent = '🔥 ' + leader.name + ' · ' + leader.streak + ' på rad';
    streakEl.classList.add('show');
  } else {
    streakEl.classList.remove('show');
  }
}

$('#next-q-btn').onclick = () => {
  quizIdx++;
  if (quizIdx >= quizQuestions.length) {
    endQuiz();
  } else {
    renderQuestion();
  }
};

function endQuiz() {
  $('#quiz-play').style.display = 'none';
  $('#quiz-end').style.display = 'block';
  const sorted = quizTeams.slice().sort((a, b) => b.score - a.score);

  // Podium — topp 3
  const podium = $('#podium');
  podium.innerHTML = '';
  const top3 = sorted.slice(0, 3);
  const maxScore = Math.max(1, ...top3.map(t => t.score));
  // Rekkefølge: 2 - 1 - 3 (klassisk podium)
  const order = top3.length === 3 ? [1, 0, 2] : top3.length === 2 ? [1, 0] : [0];
  order.forEach((origIdx) => {
    const t = top3[origIdx];
    const col = document.createElement('div');
    col.className = 'podium-col rank-' + (origIdx + 1);
    const medal = ['🥇', '🥈', '🥉'][origIdx];
    const heightPct = Math.max(20, (t.score / maxScore) * 100);
    col.innerHTML =
      '<div class="podium-medal">' + medal + '</div>' +
      '<div class="podium-name">' + t.name + '</div>' +
      '<div class="podium-score">0 poeng</div>' +
      '<div class="podium-bar" data-h="' + heightPct + '"><div class="rank-num">' + (origIdx + 1) + '</div></div>';
    podium.appendChild(col);
  });

  // Animer søyler etter kort forsinkelse
  setTimeout(() => {
    podium.querySelectorAll('.podium-bar').forEach(bar => {
      bar.style.height = bar.dataset.h + '%';
    });
    // Animer poengtellere
    podium.querySelectorAll('.podium-col').forEach((col, i) => {
      const origIdx = order[i];
      const t = top3[origIdx];
      const scoreEl = col.querySelector('.podium-score');
      setTimeout(() => {
        animateCounter({ set textContent(v) { scoreEl.textContent = v + ' poeng'; } }, 0, t.score, 1200);
      }, 400);
    });
  }, 200);

  // Fanfare og konfetti-kanoner
  setTimeout(() => {
    Sound.fanfare();
    Confetti.cannons();
  }, 800);

  const table = $('#final-table');
  table.innerHTML = '';
  sorted.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'final-row' + (i === 0 ? ' first' : '');
    const medal = ['🥇', '🥈', '🥉'][i] || '';
    row.innerHTML = '<span class="rank">#' + (i + 1) + '</span>' +
                    '<span>' + medal + ' ' + t.name + '</span>' +
                    '<span class="pts">' + t.score + ' poeng</span>';
    table.appendChild(row);
  });
}

$('#quiz-again-btn').onclick = () => {
  $('#quiz-end').style.display = 'none';
  $('#quiz-setup').style.display = 'block';
};

// ============================================================
// LYKKEHJUL
// ============================================================
let wheelNames = [];
let wheelRotation = 0;
let wheelSpinning = false;

function renderWheel() {
  const canvas = $('#wheel-canvas');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cx = size / 2, cy = size / 2, r = size / 2 - 10;
  ctx.clearRect(0, 0, size, size);

  if (wheelNames.length === 0) {
    ctx.fillStyle = 'rgba(20, 26, 46, 0.7)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#a8a299';
    ctx.font = '600 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Legg til navn under', cx, cy);
    return;
  }

  const n = wheelNames.length;
  const seg = (Math.PI * 2) / n;
  const palette = ['#d4af37', '#e94560', '#4ecdc4', '#9b59ff', '#f39c12', '#2ecc71', '#3498db', '#e67e22'];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(wheelRotation);
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(10, 14, 26, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // tekst
    ctx.save();
    ctx.rotate(i * seg + seg / 2 - Math.PI / 2);
    ctx.translate(r * 0.62, 0);
    ctx.fillStyle = '#0a0e1a';
    ctx.font = '700 ' + Math.max(14, Math.min(22, 240 / n)) + 'px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = wheelNames[i];
    const maxLen = n > 10 ? 10 : 14;
    ctx.fillText(name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // ytre ring
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  // sentral knapp
  ctx.fillStyle = '#141a2e';
  ctx.beginPath(); ctx.arc(cx, cy, 56, 0, Math.PI * 2); ctx.fill();

  renderWheelList();
}

function renderWheelList() {
  const list = $('#wheel-list');
  list.innerHTML = '';
  wheelNames.forEach((name, i) => {
    const chip = document.createElement('div');
    chip.className = 'wheel-name-chip';
    chip.innerHTML = '<span>' + name + '</span><span class="rm">✕</span>';
    chip.querySelector('.rm').onclick = () => {
      wheelNames.splice(i, 1);
      renderWheel();
    };
    list.appendChild(chip);
  });
}

$('#wheel-add-btn').onclick = () => {
  const input = $('#wheel-name-input');
  const name = input.value.trim();
  if (!name) return;
  wheelNames.push(name);
  input.value = '';
  input.focus();
  renderWheel();
};
$('#wheel-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#wheel-add-btn').click();
});
$('#wheel-clear-btn').onclick = () => {
  wheelNames = [];
  $('#wheel-result').innerHTML = '';
  renderWheel();
};

$('#spin-btn').onclick = () => {
  if (wheelSpinning || wheelNames.length < 2) return;
  wheelSpinning = true;
  $('#wheel-result').innerHTML = '';
  Sound.whoosh();

  const n = wheelNames.length;
  const seg = (Math.PI * 2) / n;
  const targetIdx = Math.floor(Math.random() * n);
  const targetAngle = (Math.PI * 2) - (targetIdx * seg + seg / 2);
  const spins = 5 + Math.random() * 3;
  const finalRotation = wheelRotation + spins * Math.PI * 2 + (targetAngle - (wheelRotation % (Math.PI * 2)));

  const startRot = wheelRotation;
  const delta = finalRotation - startRot;
  const duration = 4500;
  const startTime = performance.now();
  let lastTickSeg = -1;

  function frame(now) {
    const t = Math.min((now - startTime) / duration, 1);
    // ease out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    wheelRotation = startRot + delta * eased;
    renderWheel();

    // Tick-lyd når pointer krysser en segment-grense
    const pointerAngle = ((Math.PI * 1.5 - wheelRotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const currentSeg = Math.floor(pointerAngle / seg);
    if (currentSeg !== lastTickSeg) {
      lastTickSeg = currentSeg;
      // Mindre volum mot slutten
      if (t < 0.95) Sound.wheelTick();
    }

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      wheelSpinning = false;
      Sound.wheelLand();
      const winner = wheelNames[targetIdx];
      const result = $('#wheel-result');
      let html = '🎉 <strong>' + winner + '</strong> 🎉';
      if ($('#wheel-challenge').checked) {
        html += '<div class="challenge">' + pick(WHEEL_CHALLENGES) + '</div>';
      }
      result.innerHTML = html;
      Confetti.burst({ x: innerWidth / 2, y: innerHeight * 0.4, count: 100, spread: Math.PI * 1.2, power: 16 });
      setTimeout(() => Sound.fanfare(), 150);
    }
  }
  requestAnimationFrame(frame);
};

// ============================================================
// EMOJI-GÅTER
// ============================================================
let emojiDeck = [];
let emojiIdx = 0;

function startEmoji() {
  emojiDeck = shuffle(EMOJI_PUZZLES);
  emojiIdx = 0;
  renderEmoji();
}
function renderEmoji() {
  const p = emojiDeck[emojiIdx];
  $('#emoji-big').textContent = p.emoji;
  $('#emoji-category').textContent = p.cat;
  const ans = $('#emoji-answer');
  ans.textContent = p.answer;
  ans.style.display = 'none';
  $('#emoji-progress').textContent = (emojiIdx + 1) + ' / ' + emojiDeck.length;
}
$('#emoji-reveal-btn').onclick = () => {
  const ans = $('#emoji-answer');
  if (ans.style.display === 'block') return;
  Sound.correct();
  ans.style.display = 'block';
  Confetti.burst({ x: innerWidth / 2, y: innerHeight / 2, count: 30, power: 10 });
};
$('#emoji-next-btn').onclick = () => {
  Sound.whoosh();
  emojiIdx = (emojiIdx + 1) % emojiDeck.length;
  renderEmoji();
};

// ============================================================
// KATEGORI-KAMP
// ============================================================
let katTimer = null;
let katTime = 60;

$('#kategori-start-btn').onclick = () => {
  $('#kategori-intro').style.display = 'none';
  $('#kategori-play').style.display = 'block';
  newKategoriRound();
};
$('#kategori-next-btn').onclick = () => newKategoriRound();
$('#kategori-stop-btn').onclick = () => {
  clearInterval(katTimer);
  const t = $('#kategori-timer');
  t.classList.remove('warn');
  t.classList.add('done');
  t.textContent = 'STOPP!';
};

function newKategoriRound() {
  const letter = pick(KATEGORI_LETTERS);
  const cats = pick(KATEGORI_SETS);
  $('#letter-big').textContent = letter;
  const list = $('#kategori-list');
  list.innerHTML = '';
  cats.forEach(c => {
    const div = document.createElement('div');
    div.className = 'kategori-item';
    div.textContent = c;
    list.appendChild(div);
  });

  katTime = 60;
  const t = $('#kategori-timer');
  t.classList.remove('warn', 'done');
  t.textContent = katTime;
  Sound.go();
  clearInterval(katTimer);
  katTimer = setInterval(() => {
    katTime--;
    t.textContent = katTime;
    if (katTime <= 10) { t.classList.add('warn'); Sound.tick(); }
    if (katTime <= 0) {
      clearInterval(katTimer);
      t.classList.remove('warn');
      t.classList.add('done');
      t.textContent = 'TIDEN UT!';
      Sound.buzzer();
      screenShake(300);
    }
  }, 1000);
}

// ============================================================
// BLI-KJENT
// ============================================================
let blikjentDeck = [];
let blikjentDrawn = 0;

function startBlikjent() {
  blikjentDeck = shuffle(BLIKJENT_CARDS);
  blikjentDrawn = 0;
  $('#blikjent-card').classList.remove('flipped');
  $('#blikjent-front').textContent = '';
  $('#blikjent-count').textContent = 'Stokken har ' + blikjentDeck.length + ' kort';
}
$('#blikjent-draw-btn').onclick = () => {
  if (blikjentDrawn >= blikjentDeck.length) {
    startBlikjent();
    return;
  }
  const card = $('#blikjent-card');
  // snu tilbake først om den er flipped
  if (card.classList.contains('flipped')) {
    card.classList.remove('flipped');
    setTimeout(drawOne, 350);
  } else {
    drawOne();
  }
  function drawOne() {
    $('#blikjent-front').textContent = blikjentDeck[blikjentDrawn];
    blikjentDrawn++;
    $('#blikjent-count').textContent = 'Kort ' + blikjentDrawn + ' av ' + blikjentDeck.length;
    Sound.flip();
    requestAnimationFrame(() => card.classList.add('flipped'));
  }
};
$('#blikjent-reset-btn').onclick = startBlikjent;
$('#blikjent-card').addEventListener('click', () => $('#blikjent-draw-btn').click());

// ============================================================
// SANNHETER OG LØGN
// ============================================================
let sannLieIdx = -1;

$$('.sann-pick .pill-btn').forEach(btn => {
  btn.onclick = () => {
    $$('.sann-pick .pill-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    sannLieIdx = parseInt(btn.dataset.lie, 10);
    checkSannReady();
  };
});
['sann1', 'sann2', 'sann3'].forEach(id => {
  $('#' + id).addEventListener('input', checkSannReady);
});
function checkSannReady() {
  const filled = [1, 2, 3].every(n => $('#sann' + n).value.trim().length > 3);
  $('#sann-show-btn').disabled = !(filled && sannLieIdx >= 0);
}
$('#sann-show-btn').onclick = () => {
  const statements = [1, 2, 3].map(n => $('#sann' + n).value.trim());
  const cards = $('#sann-cards');
  cards.innerHTML = '';
  cards.dataset.lie = sannLieIdx;
  cards.dataset.statements = JSON.stringify(statements);
  statements.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'sann-card';
    card.innerHTML = '<strong>' + (i + 1) + '.</strong> ' + s;
    cards.appendChild(card);
  });
  $('#sann-step-1').style.display = 'none';
  $('#sann-step-2').style.display = 'block';
  $('#sann-new-btn').style.display = 'none';
  $('#sann-reveal-btn').style.display = 'inline-block';
};
$('#sann-reveal-btn').onclick = () => {
  const cards = $('#sann-cards');
  const lie = parseInt(cards.dataset.lie, 10);
  Sound.correct();
  $$('#sann-cards .sann-card').forEach((el, i) => {
    setTimeout(() => {
      if (i === lie) {
        el.classList.add('lie');
        el.innerHTML += '<div class="verdict">← Løgnen 🎭</div>';
        Sound.wrong();
      } else {
        el.classList.add('truth');
        el.innerHTML += '<div class="verdict">Sant ✓</div>';
      }
    }, i * 500);
  });
  setTimeout(() => Confetti.burst({ count: 60, power: 14 }), 1600);
  $('#sann-reveal-btn').style.display = 'none';
  $('#sann-new-btn').style.display = 'inline-block';
};
$('#sann-new-btn').onclick = () => {
  [1, 2, 3].forEach(n => $('#sann' + n).value = '');
  sannLieIdx = -1;
  $$('.sann-pick .pill-btn').forEach(b => b.classList.remove('selected'));
  $('#sann-show-btn').disabled = true;
  $('#sann-step-2').style.display = 'none';
  $('#sann-step-1').style.display = 'block';
};

// Init wheel og konfetti på oppstart
renderWheel();
Confetti.init();
