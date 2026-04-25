// public/host.js — host UI + rendering + socket handlers
import { QUIZ_CATEGORIES } from './data.js';
import { avatarFor, colorFor } from './avatars.js';
import { sfx, setMuted, isMuted, unlock as unlockAudio, startAmbient, stopAmbient } from './sound.js';
import * as confetti from './confetti.js';
import * as ai from './ai.js';
import * as stageBg from './stage-bg.js';
import * as fx from './effects.js';

// ====== Score-tracking for animasjoner ======
const lastScores = new Map(); // pid -> score ved forrige render (for tickUpScore)

// Start stage-bakgrunn så snart vi er lastet
stageBg.start();

// ====== State ======
const socket = io({ transports: ['websocket', 'polling'] });
let state = null;
let phasePrev = null;
let snakeRenderer = null;
let bombRenderer = null;
let bombInit = null;

// ====== Password gate ======
const pwGate = document.getElementById('pw-gate');
const pwInput = document.getElementById('pw-input');
const pwSubmit = document.getElementById('pw-submit');
const pwError = document.getElementById('pw-error');
const hostMain = document.getElementById('host-main');

function tryLogin(pw){
  pwError.textContent = '';
  socket.emit('host:hello', { password: pw });
}

pwSubmit.addEventListener('click', () => tryLogin(pwInput.value));
pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(pwInput.value); });

// Auto-try saved
const saved = sessionStorage.getItem('host:pw');
if (saved){ setTimeout(() => tryLogin(saved), 100); }

socket.on('host:ok', () => {
  sessionStorage.setItem('host:pw', pwInput.value || saved || '');
  pwGate.classList.add('hidden');
  hostMain.classList.remove('hidden');
  initHostUI();
});
socket.on('host:denied', () => {
  pwError.textContent = 'Feil passord';
  sessionStorage.removeItem('host:pw');
});
socket.on('host:evicted', () => {
  // En annen host har logget inn og overtatt — vis banner og send tilbake til gate
  sessionStorage.removeItem('host:pw');
  pwGate.classList.remove('hidden');
  hostMain.classList.add('hidden');
  pwError.textContent = 'En annen host har tatt over';
});

// ====== Topbar ======
document.getElementById('btn-help').addEventListener('click', () => {
  toast('Skann QR-koden med telefonen. Deltakere skriver navn og blir med. Velg spill når alle er inne.');
});
document.getElementById('btn-fs').addEventListener('click', () => {
  if (!document.fullscreenElement){ document.documentElement.requestFullscreen?.(); }
  else { document.exitFullscreen?.(); }
});
const btnMute = document.getElementById('btn-mute');
btnMute.addEventListener('click', () => {
  const m = !isMuted();
  setMuted(m);
  btnMute.textContent = m ? '🔇' : '🔊';
});

// ====== Host UI init ======
function initHostUI(){
  // Config controls
  const bindCfg = (id, key, numeric = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const val = numeric ? parseInt(el.value, 10) : el.value;
      socket.emit('host:config', { [key]: val });
    });
  };
  bindCfg('cfg-teams', 'teams');
  const btnShuffle = document.getElementById('btn-shuffle-teams');
  btnShuffle.addEventListener('click', () => socket.emit('host:reshuffle-teams'));
  bindCfg('cfg-qcount', 'qcount');
  bindCfg('cfg-qtime', 'qtime');
  bindCfg('cfg-lbevery', 'lbevery');
  bindCfg('cfg-lighttime', 'lighttime');
  bindCfg('cfg-scattertime', 'scattertime');
  bindCfg('cfg-lietime', 'lietime');
  bindCfg('cfg-snaketime', 'snaketime');
  bindCfg('cfg-bombtime', 'bombtime');

  document.getElementById('btn-menu').addEventListener('click', openMenu);
  document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Tilbake til lobby og nullstille alle poeng?')) socket.emit('host:reset');
  });

  // AI
  const aiKey = document.getElementById('ai-key');
  aiKey.value = ai.getKey();
  aiKey.addEventListener('change', () => ai.setKey(aiKey.value));
  document.getElementById('ai-gen').addEventListener('click', aiGenerate);

  // Custom 'mest sannsynlig'-prompts
  document.getElementById('mlp-add').addEventListener('click', () => {
    const ta = document.getElementById('mlp-input');
    const raw = ta.value.split('\n').map(l => l.trim()).filter(l => l.length >= 4);
    if (!raw.length){
      document.getElementById('mlp-status').textContent = 'Skriv minst én linje (>= 4 tegn)';
      return;
    }
    socket.emit('host:add-voting-prompts', raw);
    ta.value = '';
    document.getElementById('mlp-status').textContent = 'La til ' + raw.length + ' spørsmål ✓';
    sfx.correct();
    setTimeout(() => { document.getElementById('mlp-status').textContent = ''; }, 4000);
  });

  // Connect URL
  fetch('/connect-url').then(r => r.json()).then(j => {
    document.getElementById('url-chip').textContent = j.url;
  });

  // Mascot wander
  setInterval(wanderMascot, 7000);

  // Keep-alive mot /health for å hindre Render-coldstart under show
  setInterval(() => { fetch('/health').catch(() => {}); }, 4 * 60 * 1000);
}

async function aiGenerate(){
  const status = document.getElementById('ai-status');
  const topic = document.getElementById('ai-topic').value.trim();
  const count = parseInt(document.getElementById('ai-count').value, 10);
  if (!topic){ status.textContent = 'Angi et tema først'; return; }
  if (!ai.getKey()){ status.textContent = 'Sett en API-key først'; return; }
  status.textContent = 'Genererer...';
  try {
    const qs = await ai.generateQuestions({ topic, count });
    if (!qs.length){ status.textContent = 'Fikk ingen spørsmål'; return; }
    socket.emit('host:ai-questions', qs);
    status.textContent = `La til ${qs.length} spørsmål! Start en quiz med kategori "Egne".`;
    sfx.correct();
  } catch(e){
    status.textContent = 'Feil: ' + e.message;
  }
}

// ====== Socket state ======
socket.on('state', s => {
  const prevPhase = phasePrev;
  phasePrev = state?.phase;
  state = s;
  render(s, prevPhase);
});
socket.on('quiz:reveal', ({ correctIdx, results, allCorrect }) => {
  // --- Reveal-koreografi ---
  // 1) trommevirvel 0.7s
  // 2) feil svar blekner, riktig svar får spotlight-zoom
  // 3) score-deltas flyter opp fra midten til hver spillers kort + score-tick

  sfx.drumroll(650);
  fx.brandPulse('mint');

  setTimeout(() => {
    // 💯 Alle riktig — kraftig feiring
    if (allCorrect){
      fx.phaseBanner('💯 ALLE RIKTIG!', 'Hele gjengen traff!');
      fx.toast('Alle svarte riktig — +50 til alle', { icon: '💯', kind: 'first' });
      stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'gold', 1.5);
      setTimeout(() => stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'mint', 1.0), 300);
      confetti.burst({ count: 160 });
      mascotCelebrate(5000);
      sfx.bigWin();
      fx.brandPulse('gold');
    }
    // Score-deltas + halo + toasts
    for (const r of results){
      if (r.delta > 0){
        fx.scoreDeltaOnPlayer(r.pid, r.delta, { gold: r.trophies && r.trophies.some(t => t.kind === 'first' || t.kind === 'all-correct') });
        // Anime score-tick fra (nåværende - delta) opp til nåværende
        const curScore = (state.players.find(p => p.id === r.pid) || {}).score || 0;
        fx.tickUpScore(r.pid, curScore - r.delta, curScore, 900);
      }
      if (r.trophies && r.trophies.length){
        for (const t of r.trophies){
          if (t.kind === 'first'){
            fx.firstAnswerToast(r.name);
            fx.halo(r.pid, 'gold');
            stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'gold', 0.7);
            mascotSpeak('⚡ ' + r.name + ' først ute!');
            setTimeout(() => sfx.zoom(), 0);
          } else if (t.kind === 'streak'){
            fx.streakToast(r.name, t.n);
            fx.halo(r.pid, 'mint');
            sfx.streak(t.n);
            if (t.n >= 5){
              mascotCelebrate();
              mascotSpeak('🔥 ' + r.name + ' ' + t.n + ' på rad!');
              fx.brandPulse('gold');
            }
          } else if (t.kind === 'all-correct'){
            fx.halo(r.pid, 'gold');
          }
        }
      }
    }
    // Clear answered flags
    setTimeout(() => fx.clearAnswered(), 3500);
  }, 700);
});
socket.on('reaction', ({ emoji }) => {
  floatReaction(emoji);
});
socket.on('bomb:init', data => {
  bombInit = data;
});
socket.on('bomb:explosion', ({ cells }) => {
  if (bombRenderer) bombRenderer.explosion(cells);
  sfx.boom();
});
socket.on('bomb:kill', ({ victim, x, y, name }) => {
  if (bombRenderer){
    bombRenderer.killCamAt(x, y, 2500);
    bombRenderer.deathAnim(victim, x, y);
  }
  showKillBanner(name);
  fx.ko(name);
  fx.emojiBurst('💥', window.innerWidth/2, window.innerHeight/2 + 40, 8);
  // Puls på stage-bg
  stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'mint', 0.8);
});
let _bombChampionShown = false;
socket.on('bomb:tick', data => {
  if (bombRenderer){
    bombRenderer.setPlayers(data.players);
    bombRenderer.setBombs(data.bombs);
    bombRenderer.setPowerups(data.powerups);
    bombRenderer.updateSoft(data.soft);
  }
  renderGameHud(data, 'bomb');
  // Champion-cinematic: akkurat én overlevende + flere hadde startet (>=2)
  const alive = data.players.filter(p => p.alive);
  if (!_bombChampionShown && data.players.length >= 2 && alive.length === 1){
    _bombChampionShown = true;
    const winner = alive[0];
    const playerInfo = state?.players.find(p => p.id === winner.id);
    fx.championBanner(winner.name, playerInfo?.emoji);
    sfx.fanfare();
    stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'gold', 2);
    setTimeout(() => confetti.shower(200), 400);
    fx.brandPulse('gold');
    mascotCelebrate(6000);
  }
});
socket.on('snake:tick', data => {
  if (snakeRenderer){
    snakeRenderer.setState(data);
  }
  renderGameHud(data, 'snake');
});

// ====== Phase dispatch ======
function render(s, prevPhase){
  updatePhaseTag(s.phase);
  if (prevPhase !== s.phase){
    mascotForPhase(s.phase);
    if (s.phase !== 'question') stopTimePressureWatcher();
    // Ticker: synlig under snake/bomb
    if (s.phase === 'snake' || s.phase === 'bomb'){
      const ticker = s.players.slice().sort((a,b) => b.score - a.score).slice(0, 10)
        .map(p => ({ emoji: p.emoji, name: p.name, score: p.score }));
      fx.tickerShow(ticker);
    } else {
      fx.tickerHide();
    }
    // Ambient bed under ro-faser (quiz, voting, icebreaker), av ellers
    const ambientPhases = new Set(['question', 'reveal', 'voting', 'vote-result', 'icebreaker', 'scatter-play', 'lie-play', 'leaderboard']);
    if (ambientPhases.has(s.phase)) startAmbient();
    else stopAmbient();
  }
  renderPlayers(s);
  updateLobbyConfig(s);

  const center = document.getElementById('center-msg');
  if (center){
    const labels = {
      lobby: 'Venter på spillere. Åpne menyen for å starte et spill.',
      tutorial: 'Viser tutorial...',
      countdown: 'Starter om...',
      question: 'Spørsmål pågår.',
      reveal: 'Viser svar...',
      leaderboard: 'Viser tavle...',
      voting: 'Stemmer...',
      'vote-result': 'Resultat!',
      'scatter-play': 'Kategori-kamp pågår.',
      'scatter-review': 'Gjennomgang.',
      icebreaker: 'Bli-kjent-kort.',
      wheel: 'Lykkehjulet.',
      snake: 'Slange-kamp pågår.',
      'snake-end': 'Slange-kamp slutt.',
      bomb: 'Bomberman pågår.',
      'bomb-end': 'Bomberman slutt.',
      'lie-collect': 'Spillere sender inn påstander...',
      'lie-play': 'Gjetter løgnen.',
      'lie-reveal': 'Avsløring!',
      end: 'Sluttskjerm.'
    };
    center.textContent = labels[s.phase] || s.phase;
  }

  // Kontrollknapper i center
  renderCenterControls(s);

  // Overlay clearing based on phase
  const overlays = document.getElementById('overlays');
  if (prevPhase !== s.phase){
    // Specific cleanup
    if (s.phase !== 'snake' && snakeRenderer){ snakeRenderer.dispose(); snakeRenderer = null; overlays.innerHTML=''; }
    if (s.phase !== 'bomb' && bombRenderer){ bombRenderer.dispose(); bombRenderer = null; overlays.innerHTML=''; _bombChampionShown = false; }
    overlays.innerHTML = '';
  }

  // Render overlay per phase
  switch(s.phase){
    case 'tutorial': renderTutorial(s); break;
    case 'countdown': renderCountdown(s); break;
    case 'question': renderQuestion(s); break;
    case 'reveal': renderReveal(s); break;
    case 'leaderboard': renderLeaderboard(s); break;
    case 'voting': renderVoting(s); break;
    case 'vote-result': renderVoteResult(s); break;
    case 'scatter-play': renderScatterPlay(s); break;
    case 'scatter-review': renderScatterReview(s); break;
    case 'icebreaker': renderIcebreaker(s); break;
    case 'wheel': renderWheel(s); break;
    case 'snake': renderSnakeGame(s); break;
    case 'bomb': renderBombGame(s); break;
    case 'lie-collect': renderLieCollect(s); break;
    case 'lie-play': renderLiePlay(s); break;
    case 'lie-reveal': renderLieReveal(s); break;
    case 'end': renderEnd(s); break;
  }
}

function updatePhaseTag(phase){
  const el = document.getElementById('phase-tag');
  if (el.textContent !== phase){
    el.textContent = phase;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}
function renderPlayers(s){
  document.getElementById('p-count').textContent = s.players.length;
  const list = document.getElementById('players');
  const sorted = s.players.slice().sort((a,b) => b.score - a.score);
  const leaderId = sorted[0]?.id || null;
  const wantIds = new Set(sorted.map(p => p.id));

  // Fjern gamle kort
  [...list.children].forEach(el => { if (!wantIds.has(el.dataset.pid)) el.remove(); });

  // Oppdater eller lag nye — oppdater IN-PLACE for å ikke ødelegge animasjoner
  sorted.forEach((p, i) => {
    let el = list.querySelector(`[data-pid="${p.id}"]`);
    const isNew = !el;
    if (isNew){
      el = document.createElement('div');
      el.className = 'player-card';
      el.dataset.pid = p.id;
      el.style.animationDelay = (i * 35) + 'ms';
      el.innerHTML = `
        <button class="kick-btn" title="Kick" data-kick-btn>×</button>
        <span class="status-dot"></span>
        <span class="crown">👑</span>
        <span class="emoji"></span>
        <span class="name"></span>
        <span class="score"></span>
        <span class="team-badge" hidden></span>
        <span class="streak">🔥 0</span>
      `;
      list.appendChild(el);
      fx.joinToast(p.name, p.emoji);
      sfx.join();
      fx.emojiBurst(p.emoji, list.getBoundingClientRect().right - 80, list.getBoundingClientRect().top + 40, 4);
      // Hook kick-btn
      el.querySelector('[data-kick-btn]').addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm('Kick ' + p.name + '?')){
          socket.emit('host:kick', { pid: p.id });
        }
      });
    }

    // Oppdater kun endrede felter (ikke rebuild innerHTML)
    const emojiEl = el.querySelector('.emoji');
    if (emojiEl && emojiEl.textContent !== p.emoji) emojiEl.textContent = p.emoji;

    const nameEl = el.querySelector('.name');
    if (nameEl && nameEl.textContent !== p.name) nameEl.textContent = p.name;
    if (nameEl && p.color) nameEl.style.color = p.color;

    // Score — skip hvis animasjon pågår (data-animating)
    const scoreEl = el.querySelector('.score');
    if (scoreEl && !el.dataset.animating){
      if (scoreEl.textContent !== String(p.score)) scoreEl.textContent = p.score;
    }

    // Streak
    const streak = (p.streak || 0);
    const prevStreak = parseInt(el.dataset.streak || '0', 10);
    el.dataset.streak = String(streak);
    const streakEl = el.querySelector('.streak');
    if (streakEl) streakEl.textContent = '🔥 ' + streak;

    // Team badge
    const teamEl = el.querySelector('.team-badge');
    if (teamEl){
      if (p.team){
        teamEl.hidden = false;
        teamEl.style.color = p.team.color;
        teamEl.style.background = p.team.color + '22';
        teamEl.textContent = p.team.emoji + ' ' + p.team.name;
      } else {
        teamEl.hidden = true;
      }
    }

    // Crown / leader
    el.classList.toggle('is-leader', p.id === leaderId && p.score > 0);

    // Answered state
    if (p.hasAnswered) el.classList.add('answered');
    else el.classList.remove('answered');

    // Kick-btn title
    const kb = el.querySelector('[data-kick-btn]');
    if (kb) kb.title = 'Kick ' + p.name;
  });

  // Oppdater leder-tracker
  fx.updateLeader(leaderId);

  // Detekter rank-change → spotlight
  const rankChanges = fx.detectRankChanges(s.players);
  for (const c of rankChanges){
    if (c.to === 1){
      // Ble leder!
      fx.spotlightPlayer(c.pid);
      sfx.spotlight();
      fx.toast(`${c.name} tar ledelsen!`, { icon: '👑', kind: 'first' });
      mascotCelebrate(2500);
      fx.brandPulse('gold');
    }
  }

  // Re-sortér DOM-rekkefølge så ledere er først
  sorted.forEach((p, i) => {
    const el = list.querySelector(`[data-pid="${p.id}"]`);
    if (el && list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });

  // Oppdater last-scores snapshot (brukes for animasjoner)
  for (const p of s.players){
    lastScores.set(p.id, p.score);
  }
}

function updateLobbyConfig(s){
  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = String(v); };
  setVal('cfg-teams', s.config.teams ? '1' : '0');
  setVal('cfg-qcount', s.config.qcount);
  setVal('cfg-qtime', s.config.qtime);
  setVal('cfg-lbevery', s.config.lbevery);
  setVal('cfg-lighttime', s.config.lighttime);
  setVal('cfg-scattertime', s.config.scattertime);
  setVal('cfg-lietime', s.config.lietime);
  setVal('cfg-snaketime', s.config.snaketime);
  setVal('cfg-bombtime', s.config.bombtime);
  // Toggle shuffle-lag-knapp basert på lagmodus + phase==lobby
  const shuffle = document.getElementById('btn-shuffle-teams');
  if (shuffle) shuffle.style.display = (s.config.teams && s.phase === 'lobby') ? '' : 'none';
}

function renderCenterControls(s){
  const center = document.getElementById('center');
  // Remove old contextual buttons
  [...center.querySelectorAll('.ctx-btn')].forEach(e => e.remove());

  const add = (label, handler, cls='btn') => {
    const b = document.createElement('button');
    b.className = cls + ' ctx-btn';
    b.textContent = label;
    b.addEventListener('click', handler);
    center.appendChild(b);
    return b;
  };
  switch(s.phase){
    case 'tutorial':
      add('Hopp over →', () => socket.emit('host:skip-tutorial'));
      break;
    case 'voting':
    case 'vote-result':
      add('Neste runde', () => socket.emit('host:next-vote'), 'btn gold');
      add('Avslutt', () => socket.emit('host:reset'), 'btn danger');
      break;
    case 'scatter-play':
      add('Avslutt runde nå', () => socket.emit('host:scatter-end'));
      break;
    case 'scatter-review':
      add('Avslutt', () => socket.emit('host:reset'), 'btn danger');
      break;
    case 'icebreaker':
      add('Neste kort', () => socket.emit('host:next-icebreaker'), 'btn gold');
      add('Avslutt', () => socket.emit('host:reset'), 'btn danger');
      break;
    case 'wheel':
      add('Snurr hjulet', () => socket.emit('host:spin-wheel'), 'btn-primary');
      add('Avslutt', () => socket.emit('host:reset'), 'btn danger');
      break;
    case 'snake':
      add('Avslutt runde', () => socket.emit('host:end-snake'), 'btn danger');
      break;
    case 'bomb':
      add('Avslutt runde', () => socket.emit('host:end-bomb'), 'btn danger');
      break;
    case 'lie-collect':
      add('Start runde (hopp inn)', () => socket.emit('host:lie-next'), 'btn gold');
      break;
    case 'lie-play':
      add('Avslør nå', () => socket.emit('host:lie-next'), 'btn gold');
      break;
    case 'lie-reveal':
      add('Neste spiller', () => socket.emit('host:lie-next'), 'btn gold');
      break;
  }
}

// ====== Menu modal ======
const menuState = { tickIdx: { quiz: 0, lightning: 0, scatter: 0, lie: 0, snake: 0, bomb: 0 } };
const TIME_OPTIONS = {
  quiz: [10, 15, 20, 30],
  lightning: [3, 5, 8, 12, 15],
  scatter: [30, 60, 90, 120, 180],
  lie: [15, 30, 60, 90],
  snake: [30, 60, 90, 120, 180, 240, 0],
  bomb: [30, 60, 90, 120, 180, 240, 300, 0]
};

function openMenu(){
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h2>🎮 Velg spill</h2>
      <div class="section-title">Quiz</div>
      <div class="game-grid" id="grid-quiz"></div>
      <div class="section-title">Lyn-runde</div>
      <div class="game-grid" id="grid-lightning"></div>
      <div class="section-title">Sosiale spill</div>
      <div class="game-grid" id="grid-social"></div>
      <div style="text-align:center; margin-top: 20px;">
        <button class="btn" id="menu-close">Lukk</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('#menu-close').addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });

  const gQ = wrap.querySelector('#grid-quiz');
  const gL = wrap.querySelector('#grid-lightning');
  const gS = wrap.querySelector('#grid-social');

  const mkCard = (icon, title, desc, onClick, chipText, onChip) => {
    const c = document.createElement('div');
    c.className = 'game-card';
    c.innerHTML = `<span class="icon">${icon}</span><h4>${title}</h4><p>${desc}</p>`;
    c.addEventListener('click', onClick);
    if (chipText){
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = chipText;
      chip.addEventListener('click', e => { e.stopPropagation(); onChip(chip); });
      c.appendChild(chip);
    }
    return c;
  };

  // Quiz categories
  const cats = Object.entries(QUIZ_CATEGORIES);
  let i = 0;
  for (const [key, cat] of cats){
    const card = mkCard(cat.emoji, cat.label, `${cat.questions.length} spørsmål`,
      () => { wrap.remove(); socket.emit('host:start-quiz', { category: key }); },
      state.config.qtime + 's',
      (chip) => {
        const opts = TIME_OPTIONS.quiz;
        menuState.tickIdx.quiz = (menuState.tickIdx.quiz + 1) % opts.length;
        const v = opts[menuState.tickIdx.quiz];
        chip.textContent = v + 's';
        socket.emit('host:config', { qtime: v });
      }
    );
    card.style.animationDelay = (i*40) + 'ms'; i++;
    gQ.appendChild(card);
  }
  // Random
  gQ.appendChild(mkCard('🎲', 'Tilfeldig miks', 'Alle kategorier blandet', () => {
    wrap.remove(); socket.emit('host:start-quiz', { category: null });
  }));
  if (state.customQuestionsCount > 0){
    gQ.appendChild(mkCard('✨', 'Egne (AI)', state.customQuestionsCount + ' spørsmål', () => {
      wrap.remove(); socket.emit('host:start-quiz', { category: 'custom' });
    }));
  }

  // Lightning
  i = 0;
  for (const [key, cat] of cats){
    const card = mkCard(cat.emoji, cat.label, `${state.config.lighttime}s, dobbel poeng`,
      () => { wrap.remove(); socket.emit('host:start-lightning', { category: key }); },
      state.config.lighttime + 's',
      (chip) => {
        const opts = TIME_OPTIONS.lightning;
        menuState.tickIdx.lightning = (menuState.tickIdx.lightning + 1) % opts.length;
        const v = opts[menuState.tickIdx.lightning];
        chip.textContent = v + 's';
        socket.emit('host:config', { lighttime: v });
      }
    );
    card.style.animationDelay = (i*40) + 'ms'; i++;
    gL.appendChild(card);
  }

  // Social
  const social = [
    ['🗳️', 'Hvem er mest sannsynlig', 'Anonym avstemning', () => socket.emit('host:start-voting'), null, null],
    ['📝', 'Kategori-kamp', '5 kategorier, unike ord = fler poeng', () => socket.emit('host:start-scatter'), state.config.scattertime+'s', (chip) => { const opts=TIME_OPTIONS.scatter; menuState.tickIdx.scatter=(menuState.tickIdx.scatter+1)%opts.length; const v=opts[menuState.tickIdx.scatter]; chip.textContent=v+'s'; socket.emit('host:config',{scattertime:v}); }],
    ['🤥', '2 sannheter, 1 løgn', 'Spillere lurer hverandre', () => socket.emit('host:start-lie'), state.config.lietime+'s', (chip) => { const opts=TIME_OPTIONS.lie; menuState.tickIdx.lie=(menuState.tickIdx.lie+1)%opts.length; const v=opts[menuState.tickIdx.lie]; chip.textContent=v+'s'; socket.emit('host:config',{lietime:v}); }],
    ['💬', 'Bli-kjent-kort', 'Samtalestartere', () => socket.emit('host:start-icebreaker'), null, null],
    ['🎡', 'Lykkehjulet', 'Tilfeldig spiller', () => socket.emit('host:start-wheel'), null, null],
    ['🐍', 'Slange-kamp', '3D Snake multiplayer', () => socket.emit('host:start-snake'), (state.config.snaketime===0?'∞':state.config.snaketime+'s'), (chip) => { const opts=TIME_OPTIONS.snake; menuState.tickIdx.snake=(menuState.tickIdx.snake+1)%opts.length; const v=opts[menuState.tickIdx.snake]; chip.textContent=(v===0?'∞':v+'s'); socket.emit('host:config',{snaketime:v}); }],
    ['💣', 'Bomberman', '3D bombe-kamp', () => socket.emit('host:start-bomb'), (state.config.bombtime===0?'∞':state.config.bombtime+'s'), (chip) => { const opts=TIME_OPTIONS.bomb; menuState.tickIdx.bomb=(menuState.tickIdx.bomb+1)%opts.length; const v=opts[menuState.tickIdx.bomb]; chip.textContent=(v===0?'∞':v+'s'); socket.emit('host:config',{bombtime:v}); }],
  ];
  i = 0;
  for (const [ic, ti, de, fn, chipText, onChip] of social){
    const card = mkCard(ic, ti, de, () => { wrap.remove(); fn(); }, chipText, onChip);
    card.style.animationDelay = (i*40) + 'ms'; i++;
    gS.appendChild(card);
  }
}

function openLeaderboard(){
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h2>🏆 Topplisten</h2>
      <div>
        <select id="lb-game">
          <option value="all">Alle spill</option>
          <option value="quiz">Quiz</option>
          <option value="lightning">Lyn-runde</option>
          <option value="scatter">Kategori-kamp</option>
          <option value="lie">2 sannheter 1 løgn</option>
          <option value="snake">Slange-kamp</option>
          <option value="bomb">Bomberman</option>
        </select>
      </div>
      <div id="lb-list" class="lb-list" style="margin-top: 18px;"></div>
      <div style="text-align:center; margin-top: 18px;"><button class="btn" id="lb-close">Lukk</button></div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('#lb-close').addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  const sel = wrap.querySelector('#lb-game');
  const list = wrap.querySelector('#lb-list');
  const load = () => {
    fetch('/scores?game=' + sel.value).then(r => r.json()).then(arr => {
      list.innerHTML = '';
      arr.slice(0, 50).forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'lb-row'; el.style.animationDelay = (i*30)+'ms';
        el.innerHTML = `<div class="rank">#${i+1}</div><div>${escapeHtml(r.name)}</div><div>${r.score}</div>`;
        list.appendChild(el);
      });
      if (!arr.length) list.innerHTML = '<div style="color:var(--muted); padding: 20px; text-align:center;">Ingen scores ennå</div>';
    });
  };
  sel.addEventListener('change', load);
  load();
}

// ====== Rendering per phase ======
function renderTutorial(s){
  const o = document.getElementById('overlays');
  if (!o.querySelector('.tutorial-screen')){
    o.innerHTML = `
      <div class="tutorial-screen">
        <div class="tutorial-icon">${tutorialIconFor(s.tutorialGame)}</div>
        <div class="tutorial-text">${escapeHtml(s.tutorialText)}</div>
        <div class="tutorial-progress"><div></div></div>
      </div>
    `;
    const bar = o.querySelector('.tutorial-progress > div');
    bar.style.transition = 'width 5.3s linear';
    setTimeout(() => { bar.style.width = '100%'; }, 50);
    mascotSpeak(s.tutorialText, 5500);
    // Skip on Enter/Space
    const onKey = e => {
      if (e.key === 'Enter' || e.key === ' '){
        socket.emit('host:skip-tutorial');
        window.removeEventListener('keydown', onKey);
      }
    };
    window.addEventListener('keydown', onKey);
  }
}

function tutorialIconFor(g){
  return { quiz:'🧠', lightning:'⚡', voting:'🗳️', scatter:'📝', lie:'🤥', icebreaker:'💬', wheel:'🎡', snake:'🐍', bomb:'💣' }[g] || '🎉';
}

function renderCountdown(s){
  const o = document.getElementById('overlays');
  if (!o.querySelector('.countdown-screen')){
    o.innerHTML = `<div class="countdown-screen"><div class="countdown-num">3</div></div>`;
    const n = o.querySelector('.countdown-num');
    sfx.countdown();
    let v = 3;
    const tick = () => {
      v--;
      if (v <= 0){ n.textContent = 'GO!'; sfx.go(); return; }
      n.textContent = String(v);
      sfx.countdown();
      n.style.animation = 'none'; void n.offsetWidth; n.style.animation = '';
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }
}

function renderQuestion(s){
  if (!s.quiz || !s.quiz.question) return;
  const o = document.getElementById('overlays');
  const q = s.quiz.question;
  const progressLeft = Math.max(0, (s.quiz.deadline - Date.now())/1000);
  const total = s.quiz.isLightning ? s.config.lighttime : s.config.qtime;
  const catKey = (q.category || '').toLowerCase();

  // Første gang dette spørsmålet vises: intro-card først
  if (!o.querySelector('.quiz-wrap')){
    // Lightning round? Spesial-flash ved aller første spørsmål
    const isFirstQ = (s.quiz.index === 0);
    if (s.quiz.isLightning && isFirstQ){
      fx.lightningFlash();
      sfx.lightning();
      fx.brandPulse('danger');
    }

    // Intro-card fade-in, DELTE utbygging av DOM til etter intro
    const catEmoji = (QUIZ_CATEGORIES[catKey] && QUIZ_CATEGORIES[catKey].emoji) || '🧠';
    const catLabel = (QUIZ_CATEGORIES[catKey] && QUIZ_CATEGORIES[catKey].label) || (q.category || 'Quiz');
    sfx.zoom();
    fx.questionIntro({ index: s.quiz.index + 1, total: s.quiz.total, categoryLabel: catLabel, categoryEmoji: catEmoji, durationMs: 1300 });

    setTimeout(() => {
      // Build quiz wrap
      o.innerHTML = `
        <div class="quiz-wrap" data-category="${catKey}">
          <div class="quiz-progress">Spørsmål ${s.quiz.index+1} / ${s.quiz.total} ${s.quiz.isLightning ? '⚡' : ''}</div>
          ${q.isEmoji ? `<div class="quiz-emoji">${escapeHtml(q.q)}</div>` : `<div class="quiz-question">${escapeHtml(q.q)}</div>`}
          <div class="quiz-answers">
            ${q.a.map((ans, i) => `
              <div class="quiz-answer ${['a','b','c','d'][i]}" data-idx="${i}" style="animation-delay: ${i*70}ms">
                <span class="letter">${['A','B','C','D'][i]}</span>
                <span>${escapeHtml(ans)}</span>
              </div>
            `).join('')}
          </div>
          <div class="timer-bar"><div style="width: 100%"></div></div>
          <div class="answer-count"><b id="aq-count">0</b> / ${s.players.length} har svart</div>
        </div>
      `;
      const bar = o.querySelector('.timer-bar > div');
      // Beregn gjenværende tid på nytt (intro tok ~1.3s)
      const leftAfterIntro = Math.max(0, (s.quiz.deadline - Date.now())/1000);
      bar.style.transition = `width ${leftAfterIntro}s linear`;
      setTimeout(() => { bar.style.width = '0%'; }, 50);
      sfx.tick();

      // Sett opp time-pressure-watcher: aktiver siste 5 sek
      startTimePressureWatcher(s.quiz.deadline);
    }, 1350);
  }
  const c = o.querySelector('#aq-count');
  if (c) c.textContent = s.quiz.answersCount;
  // Flag has-answered players
  for (const p of s.players){
    if (p.hasAnswered){ fx.flashAnswered(p.id); }
  }
}

// Time-pressure-watcher — aktiveres siste 5 sek før deadline
let _tpWatcher = null;
function startTimePressureWatcher(deadlineMs){
  if (_tpWatcher) clearInterval(_tpWatcher);
  let pressureActive = false;
  _tpWatcher = setInterval(() => {
    const remaining = (deadlineMs - Date.now()) / 1000;
    if (remaining <= 5 && remaining > 0 && !pressureActive){
      pressureActive = true;
      fx.timePressureStart(() => {
        sfx.heartbeat();
        stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'mint', 0.3);
      });
    }
    if (remaining <= 0){
      clearInterval(_tpWatcher); _tpWatcher = null;
      if (pressureActive){ fx.timePressureStop(); }
    }
  }, 200);
}
function stopTimePressureWatcher(){
  if (_tpWatcher){ clearInterval(_tpWatcher); _tpWatcher = null; }
  fx.timePressureStop();
}

function renderReveal(s){
  if (!s.quiz) return;
  const o = document.getElementById('overlays');
  const q = s.quiz.question; if (!q) return;
  const correct = s.quiz.correctIdx;
  const answers = o.querySelectorAll('.quiz-answer');
  answers.forEach((el, i) => {
    if (i === correct){ el.classList.add('correct'); }
    else { el.classList.add('wrong'); }
  });
  sfx.reveal();
  confetti.burst({ x: window.innerWidth/2, y: window.innerHeight/2 - 100, count: 60 });
}

function renderLeaderboard(s){
  const o = document.getElementById('overlays');
  const sorted = s.players.slice().sort((a,b) => b.score - a.score);
  o.innerHTML = `
    <div class="lb-wrap">
      <h1 style="font-size: 42px; background: linear-gradient(135deg, var(--mint), var(--gold)); -webkit-background-clip: text; color:transparent;">🏆 Tavle</h1>
      <div class="lb-list">
        ${sorted.slice(0, 15).map((p, i) => `
          <div class="lb-row" style="animation-delay: ${i*60}ms">
            <div class="rank">#${i+1}</div>
            <div>${p.emoji} ${escapeHtml(p.name)}</div>
            <div>${p.score}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderVoting(s){
  const o = document.getElementById('overlays');
  if (!o.querySelector('.voting-wrap')){
    o.innerHTML = `
      <div class="voting-wrap big-center">
        <div style="color:var(--muted)">Hvem er mest sannsynlig</div>
        <div class="prompt">${escapeHtml(s.vote.prompt)}</div>
        <div style="color:var(--muted); margin-top: 20px;">${s.vote.votesCount} / ${s.players.length} har stemt</div>
      </div>
    `;
    mascotSpeak(s.vote.prompt, 4000);
  } else {
    const c = o.querySelector('.voting-wrap div[style*="--muted"]:last-child');
    if (c) c.textContent = s.vote.votesCount + ' / ' + s.players.length + ' har stemt';
  }
}

function renderVoteResult(s){
  const o = document.getElementById('overlays');
  const res = s.vote.results || [];
  const max = Math.max(1, ...res.map(r => r.votes));
  o.innerHTML = `
    <div class="big-center">
      <div style="color:var(--muted)">${escapeHtml(s.vote.prompt)}</div>
      <div class="voting-grid" style="grid-template-columns: 1fr; max-width: 700px;">
        ${res.slice(0, 10).map((r, i) => `
          <div class="vote-result-bar">
            <div class="fill" style="width: ${(r.votes/max*100)}%"></div>
            <span style="font-size: 22px">${r.emoji}</span>
            <span style="font-weight:700">${escapeHtml(r.name)}</span>
            <span style="margin-left:auto; color: var(--mint); font-weight:700">${r.votes}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  confetti.burst({ count: 80 });
  sfx.bigWin();
}

function renderScatterPlay(s){
  const o = document.getElementById('overlays');
  if (!o.querySelector('.scatter-wrap')){
    o.innerHTML = `
      <div class="big-center scatter-wrap">
        <div style="color:var(--muted)">Bokstav:</div>
        <div style="font-size: 180px; font-weight: 900; background: linear-gradient(135deg, var(--mint), var(--gold)); -webkit-background-clip:text; color:transparent; line-height: 1">${escapeHtml(s.scatter.letter)}</div>
        <div style="display:flex; gap: 20px; flex-wrap: wrap; justify-content:center; margin-top: 20px; max-width: 1100px;">
          ${s.scatter.categories.map(c => `<div style="padding: 12px 20px; background: rgba(255,255,255,.06); border-radius: 14px; font-size: 22px; font-weight:700;">${escapeHtml(c)}</div>`).join('')}
        </div>
        <div class="timer-bar" style="margin-top: 30px; max-width: 600px;"><div></div></div>
        <div style="color:var(--muted)">Innsendt: <span id="sp-count">${s.scatter.submittedCount}</span> / ${s.players.length}</div>
      </div>
    `;
    const bar = o.querySelector('.timer-bar > div');
    const rem = Math.max(0, (s.scatter.deadline - Date.now())/1000);
    bar.style.transition = `width ${rem}s linear`;
    bar.style.width = '100%';
    setTimeout(() => { bar.style.width = '0%'; }, 50);
  } else {
    const c = document.getElementById('sp-count');
    if (c) c.textContent = s.scatter.submittedCount;
  }
}

function renderScatterReview(s){
  const o = document.getElementById('overlays');
  const cats = s.scatter.categories;
  const review = s.scatter.review || [];
  o.innerHTML = `
    <div class="big-center">
      <div style="font-size: 32px; font-weight: 800;">Bokstav <span style="color: var(--mint)">${escapeHtml(s.scatter.letter)}</span> — gjennomgang</div>
      <div class="scatter-review">
        ${cats.map((c, i) => `
          <div class="scatter-card">
            <h5>${escapeHtml(c)}</h5>
            ${(review[i]||[]).map(e => `<div class="scatter-entry ${e.points===100?'unique':'shared'}"><span>${escapeHtml(e.name)}: <b>${escapeHtml(e.word)}</b></span><span>+${e.points}</span></div>`).join('') || '<div style="color:var(--muted); padding: 10px">Ingen gyldige svar</div>'}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  confetti.burst({ count: 60 });
  sfx.reveal();
}

function renderIcebreaker(s){
  const o = document.getElementById('overlays');
  const t = s.icebreaker.target;
  o.innerHTML = `
    <div class="big-center">
      <div style="font-size: 80px;">💬</div>
      <div class="prompt">${escapeHtml(s.icebreaker.prompt)}</div>
      ${t ? `<div style="margin-top: 30px; font-size: 24px;">Svar fra: <span style="font-size: 50px; margin-left: 10px; color: ${t.color}">${t.emoji}</span> <b>${escapeHtml(t.name)}</b></div>` : ''}
    </div>
  `;
  mascotSpeak(s.icebreaker.prompt, 6000);
}

function renderWheel(s){
  const o = document.getElementById('overlays');
  const chosen = s.wheel.chosen;
  if (!o.querySelector('.wheel-wrap')){
    o.innerHTML = `
      <div class="wheel-wrap">
        <div style="font-size: 28px; font-weight: 800;">🎡 Lykkehjulet</div>
        <div class="wheel"><div class="wheel-center" id="wc">?</div></div>
        <div id="wh-name" style="font-size: 38px; font-weight: 900; margin-top: 20px;">${chosen ? (chosen.emoji + ' ' + escapeHtml(chosen.name)) : ''}</div>
      </div>
    `;
  }
  if (chosen){
    const el = o.querySelector('.wheel');
    if (el && !el.dataset.spinning){
      el.dataset.spinning = '1';
      // Realistisk fysikk: økt tempo, naturlig deceleration via cubic-bezier
      const spins = 6 + Math.random() * 3;
      const finalAngle = spins * 360 + Math.random() * 360;
      el.style.transition = 'transform 4.2s cubic-bezier(.15, .95, .28, 1)';
      el.style.transform = `rotate(${finalAngle}deg)`;
      sfx.whoosh();

      // Tick-lyd — akselererer og decelererer med hjulfarten
      const startTime = performance.now();
      const tickLoop = () => {
        const t = (performance.now() - startTime) / 4200; // 0-1
        if (t >= 1) return;
        // Fart: raskt i starten, sakte mot slutten (kvadratisk)
        const speed = Math.max(0.04, 1 - t * t);
        sfx.wheelTick(0.7 + (1 - t) * 0.6);
        setTimeout(tickLoop, 60 + (1 - speed) * 220);
      };
      tickLoop();

      setTimeout(() => {
        sfx.fanfare();
        confetti.burst({ count: 140 });
        stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'gold', 1.5);
        fx.emojiBurst('✨', window.innerWidth/2, window.innerHeight/2, 14);
        fx.phaseBanner(chosen.emoji, chosen.name);
        mascotCelebrate(4500);
        fx.brandPulse('gold');
        fx.spotlightPlayer(chosen.id);
        const nm = o.querySelector('#wh-name');
        if (nm) nm.textContent = chosen.emoji + ' ' + chosen.name;
      }, 4300);
    }
  }
}

function renderSnakeGame(s){
  const o = document.getElementById('overlays');
  if (!snakeRenderer){
    o.innerHTML = `<canvas class="fullbleed-canvas" id="snake-canvas"></canvas>
      <div class="game-hud-top"><div class="hud-title">🐍 Slange-kamp</div><div class="hud-timer" id="snake-timer">∞</div></div>
      <div class="game-hud-right" id="snake-score"><h4>Poeng</h4><div id="snake-score-list"></div></div>`;
    import('./snake3d.js').then(m => {
      snakeRenderer = new m.SnakeRenderer(document.getElementById('snake-canvas'));
    });
  }
}
function renderBombGame(s){
  const o = document.getElementById('overlays');
  if (!bombRenderer){
    o.innerHTML = `<canvas class="fullbleed-canvas" id="bomb-canvas"></canvas>
      <div class="game-hud-top"><div class="hud-title">💣 Bomberman</div><div class="hud-timer" id="bomb-timer">∞</div></div>
      <div class="game-hud-right" id="bomb-score"><h4>Poeng</h4><div id="bomb-score-list"></div></div>`;
    import('./bomb3d.js').then(m => {
      bombRenderer = new m.BombRenderer(document.getElementById('bomb-canvas'), { follow: false });
      if (bombInit){
        const hardCells = bombInit.hard;
        const softCells = bombInit.soft;
        bombRenderer.setWalls(hardCells, softCells);
      }
    });
  }
}

function renderGameHud(data, type){
  const timerEl = document.getElementById(type + '-timer');
  if (timerEl && data.endAt){
    const left = Math.max(0, Math.round((data.endAt - Date.now())/1000));
    timerEl.textContent = left + 's';
  } else if (timerEl){
    timerEl.textContent = '∞';
  }
  const listEl = document.getElementById(type + '-score-list');
  if (listEl){
    const scoreData = type === 'snake' ? (data.score || []) : data.players.map(p => ({ name: p.name, score: (state.players.find(sp => sp.id===p.id)||{}).score||0, alive: p.alive, kills: p.kills }));
    scoreData.sort((a,b) => (b.score||0) - (a.score||0));
    listEl.innerHTML = scoreData.slice(0, 12).map(p => `
      <div class="hud-row ${p.alive===false?'dead':''}">
        <span>${escapeHtml(p.name)}${p.kills?' <small style="color:var(--danger)">💀'+p.kills+'</small>':''}</span>
        <span class="n">${p.score||0}</span>
      </div>
    `).join('');
  }
}

function renderLieCollect(s){
  const o = document.getElementById('overlays');
  o.innerHTML = `
    <div class="big-center">
      <div style="font-size: 80px;">🤥</div>
      <div class="prompt">2 sannheter, 1 løgn</div>
      <div style="color:var(--muted); font-size: 22px;">Spillerne skriver inn 3 påstander på telefonen.</div>
      <div style="font-size: 48px; font-weight: 900; color: var(--mint); margin-top: 20px;">${s.lie.submittedCount} / ${s.lie.total}</div>
    </div>
  `;
}
function renderLiePlay(s){
  const o = document.getElementById('overlays');
  const c = s.lie.current; if (!c) return;
  if (!o.querySelector('.lie-wrap')){
    o.innerHTML = `
      <div class="lie-wrap">
        <div style="font-size: 22px; color: var(--muted);">Hvem snakker sant om</div>
        <div style="font-size: 40px; font-weight: 900; color: ${c.color};">${c.emoji} ${escapeHtml(c.name)}</div>
        <div class="lie-list">
          ${c.items.map((it,i) => `<div class="lie-claim" data-i="${i}">${['A','B','C'][i]}. ${escapeHtml(it)}</div>`).join('')}
        </div>
        <div style="color:var(--muted); margin-top: 20px;">${s.lie.votesCount} har stemt</div>
      </div>
    `;
  }
}
function renderLieReveal(s){
  const o = document.getElementById('overlays');
  const c = s.lie.current; if (!c || c.lieIdx==null) return;
  o.innerHTML = `
    <div class="lie-wrap">
      <div style="font-size: 22px; color: var(--muted);">Avsløring for</div>
      <div style="font-size: 40px; font-weight: 900; color: ${c.color};">${c.emoji} ${escapeHtml(c.name)}</div>
      <div class="lie-list">
        ${c.items.map((it,i) => `<div class="lie-claim ${i===c.lieIdx?'lie':'truth'}">${['A','B','C'][i]}. ${i===c.lieIdx?'🤥 LØGN: ':'✔︎ '}${escapeHtml(it)}</div>`).join('')}
      </div>
    </div>
  `;
  confetti.burst({ count: 60 });
  sfx.reveal();
}

function renderEnd(s){
  const o = document.getElementById('overlays');
  const podium = s.players.slice().sort((a,b) => b.score - a.score).slice(0, 3);
  const awards = s.awards || [];
  const total = s.players.reduce((n,p) => n + p.score, 0);
  const facts = [];
  if (podium[0]) facts.push(`<b>${escapeHtml(podium[0].name)}</b> tok ${podium[0].score} poeng — topp av ${s.players.length} spillere`);
  if (podium[0] && podium[1] && podium[0].score - podium[1].score > 0){
    const diff = podium[0].score - podium[1].score;
    facts.push(`Vinneren hadde <b>${diff}</b> poeng forsprang til andreplassen`);
  }
  const gameLabel = { quiz: 'Quiz', lightning: 'Lyn-runde', snake: 'Slange-kamp', bomb: 'Bomberman', scatter: 'Kategori-kamp', lie: '2 sannheter 1 løgn' }[s.lastGame] || '';
  o.innerHTML = `
    <div class="end-screen">
      <h1>🎉 ${gameLabel ? escapeHtml(gameLabel) + ' — over' : 'Runde over'} 🎉</h1>
      <div class="podium">
        ${podium[1] ? `<div class="podium-spot"><div class="avatar">${podium[1].emoji}</div><div class="name">${escapeHtml(podium[1].name)}</div><div class="score">${podium[1].score}</div><div class="podium-bar silver">🥈</div></div>` : ''}
        ${podium[0] ? `<div class="podium-spot"><div class="avatar">${podium[0].emoji}</div><div class="name">${escapeHtml(podium[0].name)}</div><div class="score">${podium[0].score}</div><div class="podium-bar gold">🥇</div></div>` : ''}
        ${podium[2] ? `<div class="podium-spot"><div class="avatar">${podium[2].emoji}</div><div class="name">${escapeHtml(podium[2].name)}</div><div class="score">${podium[2].score}</div><div class="podium-bar bronze">🥉</div></div>` : ''}
      </div>
      ${awards.length ? `
        <div class="awards-strip">
          ${awards.map(a => `
            <div class="award-card">
              <div class="aw-ic">${a.icon}</div>
              <div>
                <div class="aw-label">${escapeHtml(a.label)}</div>
                <div class="aw-winner">${a.emoji} ${escapeHtml(a.winner)}</div>
                <div class="aw-value">${escapeHtml(a.value)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="round-stats">
        <div>Spillere: <b>${s.players.length}</b></div>
        <div>Total poeng: <b>${total}</b></div>
      </div>
      ${facts.length ? `<div class="fun-facts">${facts.map(f => `<div class="fun-fact">${f}</div>`).join('')}</div>` : ''}
      <button class="btn-primary" id="end-btn" style="margin-top: 24px; opacity:0; transition: opacity .5s;">Tilbake til lobby</button>
    </div>
  `;
  document.getElementById('end-btn').addEventListener('click', () => socket.emit('host:reset'));

  // Cinematic orchestration
  fx.cinematicEnd({
    podium, awards,
    onDrumroll: () => sfx.drumroll(1100),
    onSpotlight: (i) => {
      sfx.zoom();
      const positions = ['silver', 'gold', 'bronze']; // rekkefølge: bronze(0), silver(1), gold(2)
      // Mascot-cheer på hver posisjon
      mascotCelebrate(900);
    },
    onAwardTick: (i) => {
      sfx.tickUp(i);
      stageBg.boom(window.innerWidth/2, window.innerHeight * 0.7, i%2 ? 'gold' : 'mint', 0.6);
    },
    onFanfare: () => {
      sfx.fanfare();
      fx.brandPulse('gold');
      confetti.shower(260);
      stageBg.boom(window.innerWidth/2, window.innerHeight/2, 'gold', 2);
      setTimeout(() => stageBg.boom(window.innerWidth * 0.2, window.innerHeight * 0.4, 'mint', 1.3), 200);
      setTimeout(() => stageBg.boom(window.innerWidth * 0.8, window.innerHeight * 0.4, 'gold', 1.3), 400);
      mascotCelebrate(8000);
      // Fade inn "Tilbake"-knappen
      const btn = document.getElementById('end-btn');
      if (btn) btn.style.opacity = '1';
    }
  });

  // Reset rank-tracking for next match
  fx.resetRankTracking();
}

// ====== Mascot ======
const mascot = document.getElementById('mascot');
const mascotBubble = document.getElementById('mascot-bubble');
function wanderMascot(){
  // Hold deg unna venstre-panel (QR) — bruk kun høyre halvdel
  const zones = [
    { right: '40px', bottom: '40px' },
    { right: '40px', top: '120px' },
    { right: '420px', bottom: '40px' },
    { right: '420px', top: '120px' }
  ];
  const z = zones[(Math.random()*zones.length)|0];
  mascot.style.left = 'auto';
  mascot.style.right = z.right || 'auto';
  mascot.style.top = z.top || 'auto';
  mascot.style.bottom = z.bottom || 'auto';
}
let speakTimer = null;
function mascotSpeak(text, ms = 4000){
  mascotBubble.textContent = text;
  mascot.classList.add('speaking');
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => mascot.classList.remove('speaking'), ms);
}
let celebTimer = null;
function mascotCelebrate(ms = 3000){
  mascot.classList.add('celebrating', 'happy');
  clearTimeout(celebTimer);
  celebTimer = setTimeout(() => mascot.classList.remove('celebrating', 'happy'), ms);
}
function mascotEmotion(emotion){
  mascot.classList.remove('happy', 'excited', 'dancing');
  if (emotion) mascot.classList.add(emotion);
}

// Blink hvert 4-8 sekunder
function scheduleBlink(){
  const next = 4000 + Math.random() * 4000;
  setTimeout(() => {
    mascot.classList.add('blinking');
    setTimeout(() => mascot.classList.remove('blinking'), 160);
    scheduleBlink();
  }, next);
}
scheduleBlink();

// Phase-baserte uttrykk
function mascotForPhase(phase){
  if (phase === 'question' || phase === 'reveal') mascotEmotion('happy');
  else if (phase === 'bomb') mascotEmotion('excited');
  else if (phase === 'wheel' || phase === 'end') mascotEmotion('dancing');
  else mascotEmotion(null);
}

function showKillBanner(name){
  const el = document.createElement('div');
  el.className = 'kill-banner';
  el.innerHTML = `💥 K.O. ${escapeHtml(name)} 💣`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function floatReaction(emoji){
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * (window.innerWidth - 80)) + 'px';
  el.style.bottom = '40px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
  sfx.pop();
}

function toast(text){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' })[ch]);
}

// Expose for debugging
window.state = () => state;
