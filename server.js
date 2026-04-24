// server.js — Avdelingsshow live multiplayer
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { QUIZ_CATEGORIES, MOST_LIKELY, SCATTERGORIES, ICEBREAKERS, TEAM_NAMES } from './public/data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Feilsikring: Ikke krasj serveren på uventede feil
process.on('uncaughtException', (e) => console.error('[Uncaught]', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[UnhandledRejection]', e?.stack || e));

const MAX_PLAYERS = 100;
const SANITIZE_NAME_MAX = 20;
const SANITIZE_EMOJI_MAX = 6;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'dnb';

// Track brukte spørsmål per kategori i denne sesjonen — unngå gjentak mellom runder
const usedQuestions = new Map(); // categoryKey -> Set of question texts

const app = express();
const http = createServer(app);
const io = new Server(http, {
  // Komprimer payloads over 1 KB
  perMessageDeflate: { threshold: 1024 },
  // Hurtigere upgrade til WebSocket
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 20000,
});

// Utled offentlig URL (fungerer lokalt + Render/Railway/Fly)
function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
    const host = req.headers.host;
    if (host) return `${proto}://${host}`;
  }
  const ips = getLocalIPs();
  return ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`;
}

app.use(express.static(join(__dirname, 'public')));
app.get('/host', (_, res) => res.sendFile(join(__dirname, 'public', 'host.html')));
app.get('/', (_, res) => res.sendFile(join(__dirname, 'public', 'player.html')));
app.get('/qr', async (req, res) => {
  const url = publicUrl(req);
  try {
    const buf = await QRCode.toBuffer(url, { width: 400, margin: 1 });
    res.type('png').send(buf);
  } catch { res.status(500).send('qr-feil'); }
});
app.get('/connect-url', (req, res) => {
  res.json({ url: publicUrl(req) });
});

const PORT = process.env.PORT || 3000;

// ---- Game state ----
const game = {
  phase: 'lobby',           // lobby | question | reveal | leaderboard | wheel | voting | vote-result | scatter-play | scatter-review | icebreaker | end
  mode: null,               // quiz | emoji | voting | scatter | icebreaker
  category: null,           // key in QUIZ_CATEGORIES
  teamMode: false,
  teams: [],                // [{id, name, color, emoji, score}]
  questions: [],
  qIndex: -1,
  questionStartedAt: 0,
  timeLimit: 20000,
  configTimeLimit: 20000,
  players: new Map(),       // socketId -> {name, teamId, score, streak, lastDelta, lastCorrect, answered, vote, scatterAnswers}
  answers: new Map(),       // socketId -> {choice, ms}
  answerOrder: [],          // track who answered first (for FIRST trophy)
  hostId: null,
  wheelResult: null,
  paused: false,
  pauseRemainingMs: 0,
  lightning: false,
  countdownEndsAt: 0,
  // Voting specific
  votingPrompt: null,
  // Scattergories specific
  scatterLetter: null,
  scatterCategories: [],
  scatterSubmissions: new Map(),  // socketId -> [word, word, word, word, word]
  // Icebreaker specific
  icebreakerPrompt: null,
  icebreakerTarget: null,
  // Snake specific
  snake: null,
  snakeTickInterval: null,
  snakeEndTimer: null,
  // Bomberman specific
  bomb: null,
  bombTickInterval: null,
  bombEndTimer: null,
  // Config
  questionCount: 10,
};

function publicState() {
  const showQuestion = ['countdown', 'question', 'reveal'].includes(game.phase);
  const q = showQuestion && game.questions[game.qIndex];
  return {
    phase: game.phase,
    mode: game.mode,
    category: game.category,
    teamMode: game.teamMode,
    teams: game.teams,
    qIndex: game.qIndex,
    total: game.questions.length,
    paused: game.paused,
    questionCount: game.questionCount,
    timeLimit: game.timeLimit,
    configTimeLimit: game.configTimeLimit,
    lightning: game.lightning,
    countdownEndsAt: game.phase === 'countdown' ? game.countdownEndsAt : 0,
    question: q ? {
      text: game.phase === 'countdown' ? null : q.q,
      options: game.phase === 'countdown' ? null : q.a,
      timeLimit: game.timeLimit,
      startedAt: game.questionStartedAt,
      correct: game.phase === 'reveal' ? q.c : null,
      isEmoji: !!q.isEmoji,
    } : null,
    players: [...game.players.entries()].map(([id, p]) => ({
      id, name: p.name, emoji: p.emoji, teamId: p.teamId, score: p.score,
      answered: p.answered, lastDelta: p.lastDelta, lastCorrect: p.lastCorrect, streak: p.streak,
      bestStreak: p.bestStreak || 0, totalCorrect: p.totalCorrect || 0, totalWrong: p.totalWrong || 0,
      fastestMs: p.fastestMs, firstCount: p.firstCount || 0,
      voted: p.vote != null,
    })),
    wheelResult: game.wheelResult,
    votingPrompt: game.votingPrompt,
    votingResults: game.phase === 'vote-result' ? computeVoteResults() : null,
    scatterLetter: game.scatterLetter,
    scatterCategories: game.scatterCategories,
    scatterStartedAt: game.phase === 'scatter-play' ? game.questionStartedAt : 0,
    scatterTimeLimit: game.phase === 'scatter-play' ? SCATTER_TIME : 0,
    scatterReview: game.phase === 'scatter-review' ? buildScatterReview() : null,
    icebreakerPrompt: game.icebreakerPrompt,
    icebreakerTarget: game.icebreakerTarget,
  };
}

function broadcast() { io.emit('state', publicState()); }

// ---- Lifecycle helpers ----
function resetPlayersForRound() {
  for (const p of game.players.values()) {
    p.answered = false; p.lastDelta = 0; p.lastCorrect = null;
    p.vote = null; p.scatterAnswers = null;
  }
  game.answers.clear();
  game.answerOrder = [];
  game.scatterSubmissions.clear();
}

function startQuestion() {
  game.phase = 'countdown';
  game.countdownEndsAt = Date.now() + 3200;
  resetPlayersForRound();
  broadcast();
  const idx = game.qIndex;
  setTimeout(() => {
    if (game.qIndex !== idx) return;
    game.phase = 'question';
    game.questionStartedAt = Date.now();
    broadcast();
    setTimeout(() => {
      if (game.phase === 'question' && game.qIndex === idx && !game.paused) revealAnswer();
    }, game.timeLimit + 500);
  }, 3000);
}

function revealAnswer() {
  if (game.phase !== 'question') return;
  const q = game.questions[game.qIndex];
  if (!q) return;
  const teamDeltas = new Map();
  const trophies = [];
  const firstCorrect = game.answerOrder.find(sid => {
    const a = game.answers.get(sid);
    return a && a.choice === q.c;
  });
  for (const [sid, p] of game.players) {
    const a = game.answers.get(sid);
    if (a && a.choice === q.c) {
      const timeFactor = Math.max(0, 1 - a.ms / game.timeLimit);
      const baseMult = game.lightning ? 2 : 1;
      const base = (500 + Math.floor(500 * timeFactor)) * baseMult;
      const streakBonus = p.streak >= 1 ? p.streak * 100 : 0;
      const delta = base + streakBonus;
      p.score += delta;
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      p.totalCorrect = (p.totalCorrect || 0) + 1;
      p.fastestMs = p.fastestMs == null ? a.ms : Math.min(p.fastestMs, a.ms);
      p.lastDelta = delta;
      p.lastCorrect = true;
      if (sid === firstCorrect) {
        p.firstCount = (p.firstCount || 0) + 1;
        trophies.push({ type: 'first', name: p.name, emoji: '⚡', label: 'FØRSTE UTE' });
      }
      if (p.streak === 3) trophies.push({ type: 'streak', name: p.name, emoji: '🔥', label: '3 PÅ RAD' });
      else if (p.streak === 5) trophies.push({ type: 'streak', name: p.name, emoji: '🌋', label: '5 PÅ RAD' });
      else if (p.streak >= 7) trophies.push({ type: 'streak', name: p.name, emoji: '🚀', label: p.streak + ' PÅ RAD' });
      if (game.teamMode && p.teamId != null) {
        teamDeltas.set(p.teamId, (teamDeltas.get(p.teamId) || 0) + delta);
      }
    } else {
      p.streak = 0;
      p.lastDelta = 0;
      p.lastCorrect = a ? false : null;
      if (a) p.totalWrong = (p.totalWrong || 0) + 1;
      else p.totalSkipped = (p.totalSkipped || 0) + 1;
    }
  }
  const players = [...game.players.values()];
  if (players.length >= 2 && players.every(p => p.lastCorrect === true)) {
    trophies.push({ type: 'perfect', name: '', emoji: '💯', label: 'ALLE RIKTIG!' });
  }
  if (game.teamMode) {
    for (const [tid, delta] of teamDeltas) {
      const team = game.teams.find(t => t.id === tid);
      if (team) team.score += delta;
    }
  }
  game.phase = 'reveal';
  if (trophies.length) io.emit('trophies', trophies);
  broadcast();
  // Auto-advance etter 5s hvis hosten ikke gjør noe
  scheduleAutoAdvance();
}

let autoAdvanceTimer = null;
function clearAutoAdvance() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
}
function scheduleAutoAdvance() {
  clearAutoAdvance();
  const curIdx = game.qIndex;
  autoAdvanceTimer = setTimeout(() => {
    if (game.phase !== 'reveal' || game.qIndex !== curIdx) return;
    // Hver 3. spørsmål OG på siste: vis leaderboard før vi går videre
    const shouldShowBoard = ((curIdx + 1) % 3 === 0) || (curIdx + 1 >= game.questions.length);
    if (shouldShowBoard) {
      game.phase = 'leaderboard';
      broadcast();
      autoAdvanceTimer = setTimeout(() => {
        if (game.phase === 'leaderboard') nextQuestion();
      }, 6000);
    } else {
      nextQuestion();
    }
  }, 5000);
}

function nextQuestion() {
  clearAutoAdvance();
  if (game.qIndex + 1 >= game.questions.length) {
    game.phase = 'end';
    broadcast();
    return;
  }
  game.qIndex += 1;
  startQuestion();
}

function startQuizGame(categoryKey, lightning = false) {
  const cat = QUIZ_CATEGORIES[categoryKey];
  if (!cat) return;
  game.mode = 'quiz';
  game.category = categoryKey;
  game.lightning = !!lightning;
  // Track brukte spørsmål — ikke gjenta i samme sesjon
  if (!usedQuestions.has(categoryKey)) usedQuestions.set(categoryKey, new Set());
  const used = usedQuestions.get(categoryKey);
  const countWant = lightning ? Math.min(12, cat.questions.length) : game.questionCount;
  let available = cat.questions.filter(q => !used.has(q.q));
  // Hvis vi har for få ubrukte, reset bassenget (men hold de siste få som "nylig brukt")
  if (available.length < countWant) {
    used.clear();
    available = [...cat.questions];
  }
  const selected = shuffle([...available]).slice(0, countWant);
  selected.forEach(q => used.add(q.q));
  if (lightning) {
    game.timeLimit = 5000;
  } else {
    game.timeLimit = game.configTimeLimit;
  }
  game.questions = selected;
  game.qIndex = -1;
  for (const p of game.players.values()) {
    p.score = 0; p.streak = 0; p.bestStreak = 0; p.totalCorrect = 0;
    p.totalWrong = 0; p.totalSkipped = 0; p.fastestMs = null; p.firstCount = 0;
  }
  for (const t of game.teams) t.score = 0;
  nextQuestion();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function resetToLobby() {
  snakeCleanTimers();
  bombCleanTimers();
  clearAutoAdvance();
  game.snake = null;
  game.bomb = null;
  game.phase = 'lobby';
  game.mode = null;
  game.category = null;
  game.qIndex = -1;
  game.questions = [];
  game.wheelResult = null;
  game.paused = false;
  game.lightning = false;
  game.timeLimit = game.configTimeLimit;
  game.votingPrompt = null;
  game.scatterLetter = null;
  game.scatterCategories = [];
  game.scatterSubmissions.clear();
  game.icebreakerPrompt = null;
  game.icebreakerTarget = null;
  // Reset voting-pool til defaults (fjerner AI-lagde prompts når man går tilbake til lobby)
  customVotingPrompts.length = 0;
  refreshVotingPool();
  for (const p of game.players.values()) {
    p.score = 0; p.streak = 0; p.answered = false;
    p.lastDelta = 0; p.lastCorrect = null; p.vote = null; p.scatterAnswers = null;
  }
  for (const t of game.teams) t.score = 0;
  broadcast();
}

// ---- Team helpers ----
function enableTeams(numTeams) {
  game.teamMode = true;
  const n = Math.max(2, Math.min(TEAM_NAMES.length, numTeams || 2));
  game.teams = TEAM_NAMES.slice(0, n).map((t, i) => ({ id: i, ...t, score: 0 }));
  redistributePlayersToTeams();
}

function disableTeams() {
  game.teamMode = false;
  game.teams = [];
  for (const p of game.players.values()) p.teamId = null;
}

function redistributePlayersToTeams() {
  if (!game.teamMode) return;
  const players = [...game.players.values()];
  shuffle(players);
  players.forEach((p, i) => {
    p.teamId = i % game.teams.length;
  });
}

// ---- Voting ("Hvem er mest sannsynlig til å...") ----
const customVotingPrompts = []; // AI-added prompts for this session
let votingPool = [...MOST_LIKELY];
function refreshVotingPool() {
  votingPool = shuffle([...MOST_LIKELY, ...customVotingPrompts]);
}

function startVoting(prompt) {
  game.phase = 'voting';
  game.mode = 'voting';
  if (prompt) game.votingPrompt = prompt;
  else {
    if (!votingPool.length) refreshVotingPool();
    game.votingPrompt = votingPool.shift();
  }
  for (const p of game.players.values()) p.vote = null;
  broadcast();
}

function computeVoteResults() {
  const tally = new Map(); // playerId -> count
  for (const p of game.players.values()) {
    if (p.vote) tally.set(p.vote, (tally.get(p.vote) || 0) + 1);
  }
  const result = [];
  for (const [pid, count] of tally) {
    const target = game.players.get(pid);
    if (target) result.push({ id: pid, name: target.name, count });
  }
  return result.sort((a, b) => b.count - a.count);
}

function endVoting() {
  game.phase = 'vote-result';
  broadcast();
}

// ---- Scattergories ----
const SCATTER_TIME = 60000;
function startScatter() {
  game.phase = 'scatter-play';
  game.mode = 'scatter';
  game.scatterLetter = SCATTERGORIES.letters[Math.floor(Math.random() * SCATTERGORIES.letters.length)];
  game.scatterCategories = SCATTERGORIES.categorySets[Math.floor(Math.random() * SCATTERGORIES.categorySets.length)];
  game.scatterSubmissions.clear();
  for (const p of game.players.values()) { p.scatterAnswers = null; p.answered = false; p.lastDelta = 0; }
  game.questionStartedAt = Date.now();
  broadcast();
  const started = game.questionStartedAt;
  setTimeout(() => {
    if (game.phase === 'scatter-play' && game.questionStartedAt === started) endScatter();
  }, SCATTER_TIME + 500);
}

function endScatter() {
  // Score: 100 pr ord som starter med letter (case insensitive) og er unikt blant innsendinger for samme kategori
  const letter = (game.scatterLetter || '').toLowerCase();
  const counts = game.scatterCategories.map(() => new Map()); // catIdx -> word -> count

  for (const [sid, arr] of game.scatterSubmissions) {
    if (!arr) continue;
    arr.forEach((w, i) => {
      const word = (w || '').trim().toLowerCase();
      if (!word || word[0] !== letter) return;
      counts[i].set(word, (counts[i].get(word) || 0) + 1);
    });
  }

  // Award points
  for (const [sid, arr] of game.scatterSubmissions) {
    const p = game.players.get(sid);
    if (!p || !arr) continue;
    let delta = 0;
    arr.forEach((w, i) => {
      const word = (w || '').trim().toLowerCase();
      if (!word || word[0] !== letter) return;
      const c = counts[i].get(word) || 0;
      if (c === 1) delta += 100; // unique → full
      else if (c > 1) delta += 50; // shared
    });
    p.score += delta;
    p.lastDelta = delta;
    if (game.teamMode && p.teamId != null) {
      const team = game.teams.find(t => t.id === p.teamId);
      if (team) team.score += delta;
    }
  }
  game.phase = 'scatter-review';
  broadcast();
}

function buildScatterReview() {
  const rows = [];
  for (const [sid, arr] of game.scatterSubmissions) {
    const p = game.players.get(sid);
    if (!p || !arr) continue;
    rows.push({ name: p.name, teamId: p.teamId, answers: arr, delta: p.lastDelta || 0 });
  }
  rows.sort((a, b) => b.delta - a.delta);
  return rows;
}

// ---- Icebreaker ----
function drawIcebreaker() {
  const players = [...game.players.values()];
  if (!players.length) return;
  game.phase = 'icebreaker';
  game.mode = 'icebreaker';
  game.icebreakerPrompt = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
  game.icebreakerTarget = players[Math.floor(Math.random() * players.length)].name;
  broadcast();
}

// ---- Snake game ----
const SNAKE_GRID = { w: 40, h: 25 };
const SNAKE_DURATION = 60000;
const SNAKE_TICK = 140;
const SNAKE_COLORS = ['#e54b4b','#3a86ff','#ffbe0b','#29c46a','#a855f7','#ff7b00','#14b8a6','#ec4899','#f59e0b','#06b6d4'];

function snakeCleanTimers() {
  if (game.snakeTickInterval) { clearInterval(game.snakeTickInterval); game.snakeTickInterval = null; }
  if (game.snakeEndTimer) { clearTimeout(game.snakeEndTimer); game.snakeEndTimer = null; }
}

function snakeSpawnFood() {
  if (!game.snake) return;
  const occupied = new Set();
  for (const s of game.snake.snakes.values()) {
    if (!s.alive) continue;
    s.body.forEach(seg => occupied.add(seg.x + ',' + seg.y));
  }
  for (const f of game.snake.food) occupied.add(f.x + ',' + f.y);
  for (let tries = 0; tries < 50; tries++) {
    const x = Math.floor(Math.random() * SNAKE_GRID.w);
    const y = Math.floor(Math.random() * SNAKE_GRID.h);
    if (!occupied.has(x + ',' + y)) { game.snake.food.push({ x, y }); return; }
  }
}

function snakeRespawn(sid, snake) {
  // Finn tom plass
  const occupied = new Set();
  for (const s of game.snake.snakes.values()) {
    if (!s.alive) continue;
    s.body.forEach(seg => occupied.add(seg.x + ',' + seg.y));
  }
  for (let tries = 0; tries < 200; tries++) {
    const x = 5 + Math.floor(Math.random() * (SNAKE_GRID.w - 10));
    const y = 3 + Math.floor(Math.random() * (SNAKE_GRID.h - 6));
    let ok = true;
    for (let d = 0; d < 3; d++) if (occupied.has((x-d) + ',' + y)) { ok = false; break; }
    if (!ok) continue;
    snake.body = [{x, y}, {x: x-1, y}, {x: x-2, y}];
    snake.dir = 'right'; snake.nextDir = 'right';
    snake.alive = true; snake.deadAt = 0;
    return;
  }
}

function startSnake() {
  if (!game.players.size) return;
  snakeCleanTimers();
  game.phase = 'snake';
  game.mode = 'snake';
  game.snake = {
    snakes: new Map(),
    food: [],
    startedAt: Date.now() + 3000, // 3s countdown
    endAt: Date.now() + 3000 + SNAKE_DURATION,
    started: false,
  };
  let colorIdx = 0;
  for (const [sid, p] of game.players) {
    const snake = {
      name: p.name, emoji: p.emoji,
      color: SNAKE_COLORS[colorIdx++ % SNAKE_COLORS.length],
      body: [], dir: 'right', nextDir: 'right',
      alive: false, deadAt: 0, score: 0,
    };
    snakeRespawn(sid, snake);
    game.snake.snakes.set(sid, snake);
  }
  // 5 food items to start
  for (let i = 0; i < 5; i++) snakeSpawnFood();
  broadcast();
  // After countdown, start tick-loop
  setTimeout(() => {
    if (game.phase !== 'snake' || !game.snake) return;
    game.snake.started = true;
    game.snakeTickInterval = setInterval(snakeTick, SNAKE_TICK);
  }, 3000);
  game.snakeEndTimer = setTimeout(() => endSnake(), 3000 + SNAKE_DURATION);
}

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
function snakeTick() {
  try {
    snakeTickInner();
  } catch (e) {
    console.error('[SnakeTick error]', e);
  }
}

function snakeTickInner() {
  const sd = game.snake;
  if (!sd || !sd.started) return;
  const now = Date.now();
  // Handle respawns after 3s
  for (const [sid, s] of sd.snakes) {
    if (!s.alive && s.deadAt && now - s.deadAt > 3000 && now < sd.endAt - 2000) {
      snakeRespawn(sid, s);
    }
  }
  // Build collision map of all live snake cells
  const cells = new Map();
  for (const [sid, s] of sd.snakes) {
    if (!s.alive) continue;
    s.body.forEach(seg => cells.set(seg.x + ',' + seg.y, sid));
  }
  const newHeads = new Map();
  for (const [sid, s] of sd.snakes) {
    if (!s.alive) continue;
    // Ignore opposite-direction requests
    if (s.nextDir && s.nextDir !== OPPOSITE[s.dir]) s.dir = s.nextDir;
    const head = s.body[0];
    const next = { x: head.x, y: head.y };
    if (s.dir === 'up') next.y--;
    else if (s.dir === 'down') next.y++;
    else if (s.dir === 'left') next.x--;
    else if (s.dir === 'right') next.x++;
    newHeads.set(sid, next);
  }
  // Check collisions & move
  const dyingNow = new Set();
  for (const [sid, next] of newHeads) {
    const s = sd.snakes.get(sid);
    if (next.x < 0 || next.x >= SNAKE_GRID.w || next.y < 0 || next.y >= SNAKE_GRID.h) {
      dyingNow.add(sid); continue;
    }
    // Check if someone elses head targets same cell (head-to-head collision: both die)
    for (const [osid, onext] of newHeads) {
      if (osid !== sid && onext.x === next.x && onext.y === next.y) {
        dyingNow.add(sid); dyingNow.add(osid);
      }
    }
    if (dyingNow.has(sid)) continue;
    // Check bodies
    if (cells.has(next.x + ',' + next.y)) {
      const ownerSid = cells.get(next.x + ',' + next.y);
      if (ownerSid === sid) {
        // Check if it's own tail (tail will move unless eating)
        const owner = sd.snakes.get(sid);
        const tail = owner.body[owner.body.length - 1];
        const tailIsMoving = !sd.food.some(f => f.x === next.x && f.y === next.y);
        if (!(next.x === tail.x && next.y === tail.y && tailIsMoving)) {
          dyingNow.add(sid);
        }
      } else {
        dyingNow.add(sid);
      }
    }
  }
  for (const sid of dyingNow) {
    const s = sd.snakes.get(sid);
    s.alive = false; s.deadAt = now;
  }
  // Move surviving snakes
  for (const [sid, next] of newHeads) {
    const s = sd.snakes.get(sid);
    if (!s.alive || dyingNow.has(sid)) continue;
    s.body.unshift(next);
    const foodIdx = sd.food.findIndex(f => f.x === next.x && f.y === next.y);
    if (foodIdx >= 0) {
      sd.food.splice(foodIdx, 1);
      s.score += 10;
      snakeSpawnFood();
      // Randomly spawn extra food for more fun with many players
      if (sd.food.length < Math.max(5, sd.snakes.size * 2) && Math.random() < 0.3) snakeSpawnFood();
    } else {
      s.body.pop();
    }
  }
  io.volatile.emit('snake:tick', snakeSnapshot());
}

function snakeSnapshot() {
  if (!game.snake) return null;
  const now = Date.now();
  return {
    grid: SNAKE_GRID,
    started: game.snake.started,
    startedAt: game.snake.startedAt,
    endAt: game.snake.endAt,
    timeLeft: Math.max(0, game.snake.endAt - now),
    countdownLeft: Math.max(0, game.snake.startedAt - now),
    snakes: [...game.snake.snakes.entries()].map(([sid, s]) => ({
      id: sid, name: s.name, emoji: s.emoji, color: s.color,
      body: s.body, alive: s.alive, score: s.score,
      respawnIn: !s.alive && s.deadAt ? Math.max(0, 3000 - (now - s.deadAt)) : 0,
    })),
    food: game.snake.food,
  };
}

function endSnake() {
  snakeCleanTimers();
  if (!game.snake) return;
  // Award main-game points (både individ og lag)
  for (const [sid, s] of game.snake.snakes) {
    const p = game.players.get(sid);
    if (!p) continue;
    p.score += s.score;
    if (game.teamMode && p.teamId != null) {
      const team = game.teams.find(t => t.id === p.teamId);
      if (team) team.score += s.score;
    }
  }
  game.phase = 'snake-end';
  broadcast();
}

// ---- Bomberman ----
const BOMB_GRID = { w: 25, h: 15 };
const BOMB_DURATION = 90000;
const BOMB_TICK = 180;
const BOMB_FUSE = 2500;
const BOMB_EXPLOSION_TTL = 700;
const BOMB_RESPAWN_MS = 5000;
const BOMB_COLORS = ['#e54b4b','#3a86ff','#ffbe0b','#29c46a','#a855f7','#ff7b00','#14b8a6','#ec4899','#f59e0b','#06b6d4','#84cc16','#a78bfa'];

// Wall-verdier: 0=tom, 1=hard, 2=myk
function bombGenerateMap() {
  const W = BOMB_GRID.w, H = BOMB_GRID.h;
  const grid = new Array(W * H).fill(0);
  const idx = (x, y) => y * W + x;
  // Ramme + pillar-mønster (hver annen celle med x/y partall = hard)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x === 0 || y === 0 || x === W-1 || y === H-1) grid[idx(x,y)] = 1;
    else if (x % 2 === 0 && y % 2 === 0) grid[idx(x,y)] = 1;
  }
  return { grid, W, H, idx };
}

function bombSpawnPositions() {
  const W = BOMB_GRID.w, H = BOMB_GRID.h;
  // Rekkefølge basert på avstand fra andre spawnpunkter
  return [
    {x: 1, y: 1}, {x: W-2, y: H-2}, {x: W-2, y: 1}, {x: 1, y: H-2},
    {x: Math.floor(W/2), y: 1}, {x: Math.floor(W/2), y: H-2},
    {x: 1, y: Math.floor(H/2)}, {x: W-2, y: Math.floor(H/2)},
    {x: Math.floor(W/4), y: 1}, {x: Math.floor(3*W/4), y: H-2},
    {x: Math.floor(W/4), y: H-2}, {x: Math.floor(3*W/4), y: 1},
    {x: 1, y: Math.floor(H/4)}, {x: W-2, y: Math.floor(3*H/4)},
    {x: 1, y: Math.floor(3*H/4)}, {x: W-2, y: Math.floor(H/4)},
    {x: Math.floor(W/2), y: Math.floor(H/2)},
    {x: 3, y: 3}, {x: W-4, y: H-4}, {x: W-4, y: 3}, {x: 3, y: H-4},
  ];
}

function bombFillSoftWalls(map, spawnPts) {
  // Fyll 60% av tomme celler med myk vegg, men ikke rundt spawn-punkter
  const safeCells = new Set();
  for (const p of spawnPts) {
    safeCells.add(p.x + ',' + p.y);
    // 2 celler i hver retning
    for (const [dx, dy] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      safeCells.add((p.x+dx) + ',' + (p.y+dy));
    }
  }
  for (let i = 0; i < map.grid.length; i++) {
    if (map.grid[i] !== 0) continue;
    const x = i % map.W, y = Math.floor(i / map.W);
    if (safeCells.has(x + ',' + y)) continue;
    if (Math.random() < 0.70) map.grid[i] = 2;
  }
}

function bombCleanTimers() {
  if (game.bombTickInterval) { clearInterval(game.bombTickInterval); game.bombTickInterval = null; }
  if (game.bombEndTimer) { clearTimeout(game.bombEndTimer); game.bombEndTimer = null; }
}

function bombRespawnPlayer(sid, player) {
  const positions = bombSpawnPositions();
  const occupied = new Set();
  for (const p of game.bomb.players.values()) {
    if (p.alive) occupied.add(p.x + ',' + p.y);
  }
  // Sjekk også vegger
  const { grid, W, idx } = game.bomb.map;
  for (const pos of positions) {
    const key = pos.x + ',' + pos.y;
    if (occupied.has(key)) continue;
    if (grid[idx(pos.x, pos.y)] !== 0) continue;
    player.x = pos.x; player.y = pos.y;
    player.nextDir = null;
    player.alive = true; player.deadAt = 0;
    // Clear cells around spawn of soft walls
    for (const [dx, dy] of [[0,0],[0,1],[1,0],[0,-1],[-1,0]]) {
      const nx = pos.x + dx, ny = pos.y + dy;
      if (nx > 0 && nx < W-1 && ny > 0 && ny < BOMB_GRID.h-1) {
        if (grid[idx(nx, ny)] === 2) grid[idx(nx, ny)] = 0;
      }
    }
    return true;
  }
  return false;
}

function startBomberman() {
  if (!game.players.size) return;
  bombCleanTimers();
  game.phase = 'bomb';
  game.mode = 'bomb';
  const map = bombGenerateMap();
  const spawnPts = bombSpawnPositions();
  bombFillSoftWalls(map, spawnPts);
  game.bomb = {
    map,
    players: new Map(),
    bombs: [],
    explosions: [],
    powerups: [],
    startedAt: Date.now() + 3000,
    endAt: Date.now() + 3000 + BOMB_DURATION,
    started: false,
    bombCounter: 0,
    wallsVersion: 1,
    wallsLastSent: 0,
  };
  let colorIdx = 0;
  let posIdx = 0;
  for (const [sid, p] of game.players) {
    const color = BOMB_COLORS[colorIdx++ % BOMB_COLORS.length];
    const pos = spawnPts[posIdx++ % spawnPts.length];
    game.bomb.players.set(sid, {
      id: sid, name: p.name, emoji: p.emoji, color,
      x: pos.x, y: pos.y,
      nextDir: null, alive: true, deadAt: 0,
      bombsMax: 1, bombsPlaced: 0, range: 2,
      score: 0, kills: 0,
    });
  }
  broadcast();
  setTimeout(() => {
    if (game.phase !== 'bomb' || !game.bomb) return;
    game.bomb.started = true;
    game.bombTickInterval = setInterval(bombermanTick, BOMB_TICK);
  }, 3000);
  game.bombEndTimer = setTimeout(() => endBomberman(), 3000 + BOMB_DURATION);
}

function bombermanTick() {
  try {
    bombermanTickInner();
  } catch (e) {
    console.error('[BombTick error]', e);
  }
}

function bombermanTickInner() {
  const b = game.bomb;
  if (!b || !b.started) return;
  const { grid, W, idx } = b.map;
  const now = Date.now();

  // Respawn dead players etter BOMB_RESPAWN_MS
  for (const [sid, p] of b.players) {
    if (!p.alive && p.deadAt && now - p.deadAt > BOMB_RESPAWN_MS && now < b.endAt - 2000) {
      bombRespawnPlayer(sid, p);
    }
  }

  // Cleanup expired explosions
  b.explosions = b.explosions.filter(e => e.endsAt > now);

  // Detonate bombs whose time is up
  const toDetonate = b.bombs.filter(bb => bb.explodesAt <= now);
  for (const bomb of toDetonate) detonateBomb(bomb);
  b.bombs = b.bombs.filter(bb => bb.explodesAt > now);

  // Move players
  const explCells = new Set(b.explosions.map(e => e.x + ',' + e.y));
  for (const [sid, p] of b.players) {
    if (!p.alive) continue;
    if (p.nextDir) {
      let nx = p.x, ny = p.y;
      if (p.nextDir === 'up') ny--;
      else if (p.nextDir === 'down') ny++;
      else if (p.nextDir === 'left') nx--;
      else if (p.nextDir === 'right') nx++;
      if (nx >= 0 && nx < W && ny >= 0 && ny < BOMB_GRID.h) {
        const cell = grid[idx(nx, ny)];
        // Blokkert av vegg eller bombe
        const bombAt = b.bombs.some(bb => bb.x === nx && bb.y === ny);
        if (cell === 0 && !bombAt) {
          p.x = nx; p.y = ny;
          // Pick up powerup
          const puIdx = b.powerups.findIndex(u => u.x === nx && u.y === ny);
          if (puIdx >= 0) {
            const pu = b.powerups[puIdx];
            if (pu.type === 'bomb') p.bombsMax += 1;
            else if (pu.type === 'range') p.range += 1;
            b.powerups.splice(puIdx, 1);
          }
        }
      }
    }
    // Sjekk eksplosjon under spiller
    if (explCells.has(p.x + ',' + p.y)) killPlayer(p, null);
  }

  // Broadcast snapshot (walls komprimeres av perMessageDeflate)
  io.volatile.emit('bomb:tick', bombSnapshot(true));

  // End hvis bare 1 player alive og >1 spillere totalt, eller tid er ute
  const alive = [...b.players.values()].filter(p => p.alive);
  if (alive.length <= 1 && b.players.size > 1 && now < b.endAt - 5000) {
    // Gi bonus hvis det er en lone survivor, end etter 3 sek
    setTimeout(() => { if (game.phase === 'bomb') endBomberman(); }, 1500);
    b.endAt = now + 1500; // forkort
  }
}

function detonateBomb(bomb) {
  const b = game.bomb;
  const { grid, W, idx } = b.map;
  const H = BOMB_GRID.h;
  const now = Date.now();
  const owner = b.players.get(bomb.ownerId);
  if (owner) owner.bombsPlaced = Math.max(0, owner.bombsPlaced - 1);

  // Origin
  addExplosion(bomb.x, bomb.y, bomb.ownerId);
  // 4 retninger
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    for (let r = 1; r <= bomb.range; r++) {
      const nx = bomb.x + dx * r, ny = bomb.y + dy * r;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
      const cell = grid[idx(nx, ny)];
      if (cell === 1) break; // hard wall stopper
      addExplosion(nx, ny, bomb.ownerId);
      if (cell === 2) {
        grid[idx(nx, ny)] = 0;
        b.wallsVersion = (b.wallsVersion || 0) + 1;
        // 40% sjanse for powerup
        if (Math.random() < 0.4) {
          const type = Math.random() < 0.5 ? 'bomb' : 'range';
          b.powerups.push({ x: nx, y: ny, type });
        }
        break; // soft wall stopper
      }
    }
  }
}

function addExplosion(x, y, ownerId) {
  const b = game.bomb;
  if (b.explosions.some(e => e.x === x && e.y === y)) return;
  b.explosions.push({ x, y, endsAt: Date.now() + BOMB_EXPLOSION_TTL, ownerId });
  // Drep spillere som er her
  for (const p of b.players.values()) {
    if (p.alive && p.x === x && p.y === y) killPlayer(p, ownerId);
  }
  // Detonér andre bomber som er her (chain reaction)
  const hit = b.bombs.find(bb => bb.x === x && bb.y === y);
  if (hit) {
    hit.explodesAt = Date.now(); // neste tick sprenger den
  }
  // Fjern powerup hvis truffet
  b.powerups = b.powerups.filter(u => !(u.x === x && u.y === y));
}

function killPlayer(p, byOwnerId) {
  if (!p.alive) return;
  p.alive = false;
  p.deadAt = Date.now();
  if (byOwnerId && byOwnerId !== p.id) {
    const killer = game.bomb.players.get(byOwnerId);
    if (killer) { killer.kills += 1; killer.score += 100; }
  }
}

function bombSnapshot(includeWalls = false) {
  if (!game.bomb) return null;
  const b = game.bomb;
  const now = Date.now();
  return {
    grid: BOMB_GRID,
    walls: includeWalls ? b.map.grid : undefined,
    wallsVersion: b.wallsVersion || 0,
    started: b.started,
    startedAt: b.startedAt,
    endAt: b.endAt,
    timeLeft: Math.max(0, b.endAt - now),
    countdownLeft: Math.max(0, b.startedAt - now),
    players: [...b.players.values()].map(p => ({
      id: p.id, name: p.name, emoji: p.emoji, color: p.color,
      x: p.x, y: p.y, alive: p.alive, score: p.score, kills: p.kills,
      bombsMax: p.bombsMax, range: p.range,
      respawnIn: !p.alive && p.deadAt ? Math.max(0, BOMB_RESPAWN_MS - (now - p.deadAt)) : 0,
    })),
    bombs: b.bombs.map(bb => ({ x: bb.x, y: bb.y, ownerId: bb.ownerId, tLeft: Math.max(0, bb.explodesAt - now) })),
    explosions: b.explosions.map(e => ({ x: e.x, y: e.y, tLeft: Math.max(0, e.endsAt - now) })),
    powerups: b.powerups,
  };
}

function endBomberman() {
  bombCleanTimers();
  if (!game.bomb) return;
  for (const p of game.bomb.players.values()) {
    // Bonus for siste overlevende
    if (p.alive && [...game.bomb.players.values()].filter(x => x.alive).length === 1 && game.bomb.players.size > 1) {
      p.score += 200;
    }
    const mp = game.players.get(p.id);
    if (!mp) continue;
    mp.score += p.score;
    if (game.teamMode && mp.teamId != null) {
      const team = game.teams.find(t => t.id === mp.teamId);
      if (team) team.score += p.score;
    }
  }
  game.phase = 'bomb-end';
  broadcast();
}


// ---- Socket handlers ----
io.on('connection', (socket) => {
  // Send initial state to new socket (fikser hvit skjerm)
  socket.emit('state', publicState());

  socket.on('host:hello', (password) => {
    // Sjekk passord
    if (HOST_PASSWORD && password !== HOST_PASSWORD) {
      socket.emit('host:denied', { reason: 'password' });
      return;
    }
    // Forhindre at en tilfeldig bruker overtar host-rollen når det allerede er en
    if (game.hostId && game.hostId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(game.hostId);
      if (existingSocket && existingSocket.connected) {
        socket.emit('host:denied', { reason: 'taken' });
        return;
      }
    }
    game.hostId = socket.id;
    socket.emit('host:ok');
    broadcast();
  });

  socket.on('player:join', (name, emoji) => {
    try {
      if (game.players.size >= MAX_PLAYERS) { socket.emit('join:error', 'Spillet er fullt'); return; }
      const clean = String(name || '').trim().slice(0, SANITIZE_NAME_MAX);
      if (!clean) { socket.emit('join:error', 'Skriv et navn'); return; }
      const taken = [...game.players.values()].some(p => p.name.toLowerCase() === clean.toLowerCase());
      if (taken) { socket.emit('join:error', 'Navnet er allerede i bruk'); return; }
      let teamId = null;
      if (game.teamMode && game.teams.length) {
        const sizes = game.teams.map(t => ({ id: t.id, n: [...game.players.values()].filter(p => p.teamId === t.id).length }));
        sizes.sort((a, b) => a.n - b.n);
        teamId = sizes[0].id;
      }
      const cleanEmoji = typeof emoji === 'string' && emoji.length <= SANITIZE_EMOJI_MAX ? emoji : null;
      game.players.set(socket.id, {
        name: clean, emoji: cleanEmoji, teamId, score: 0, streak: 0, bestStreak: 0,
        answered: false, lastDelta: 0, lastCorrect: null,
        vote: null, scatterAnswers: null,
        totalCorrect: 0, totalWrong: 0, totalSkipped: 0, fastestMs: null, firstCount: 0,
      });
      socket.emit('join:ok', { name: clean, teamId, emoji: cleanEmoji });
      broadcast();
    } catch (e) { console.error('[join error]', e); socket.emit('join:error', 'Noe gikk galt'); }
  });

  socket.on('player:answer', (choice) => {
    if (game.phase !== 'question') return;
    const p = game.players.get(socket.id);
    if (!p || p.answered) return;
    const ms = Date.now() - game.questionStartedAt;
    if (ms > game.timeLimit) return;
    game.answers.set(socket.id, { choice, ms });
    game.answerOrder.push(socket.id);
    p.answered = true;
    broadcast();
    if ([...game.players.values()].every(p => p.answered)) {
      setTimeout(() => { if (game.phase === 'question') revealAnswer(); }, 300);
    }
  });

  socket.on('player:react', (emoji) => {
    const allowed = ['🔥','❤️','😂','👏','💪','😱','🎉','🙌','💯','🤯'];
    if (!allowed.includes(emoji)) return;
    const p = game.players.get(socket.id);
    if (!p) return;
    io.emit('reaction', { emoji, from: p.name });
  });

  socket.on('player:vote', (targetId) => {
    if (game.phase !== 'voting') return;
    const p = game.players.get(socket.id);
    if (!p) return;
    if (!game.players.has(targetId)) return;
    p.vote = targetId;
    broadcast();
    // Auto-end when everyone has voted
    if ([...game.players.values()].every(p => p.vote != null)) {
      setTimeout(() => { if (game.phase === 'voting') endVoting(); }, 500);
    }
  });

  socket.on('player:scatter', (arr) => {
    if (game.phase !== 'scatter-play') return;
    const p = game.players.get(socket.id);
    if (!p) return;
    if (!Array.isArray(arr)) return;
    const cleaned = arr.slice(0, game.scatterCategories.length).map(x => String(x || '').slice(0, 40));
    game.scatterSubmissions.set(socket.id, cleaned);
    p.scatterAnswers = cleaned;
    p.answered = true;
    broadcast();
  });

  // ---- Host controls ----
  const isHost = () => socket.id === game.hostId;

  socket.on('host:config', (cfg) => {
    if (!isHost()) return;
    if (typeof cfg.teamMode === 'boolean') {
      if (cfg.teamMode) enableTeams(cfg.numTeams || 2);
      else disableTeams();
    }
    if (typeof cfg.numTeams === 'number' && game.teamMode) {
      enableTeams(cfg.numTeams);
    }
    if (typeof cfg.timeLimit === 'number') { game.timeLimit = Math.max(5000, Math.min(60000, cfg.timeLimit)); game.configTimeLimit = game.timeLimit; }
    if (typeof cfg.questionCount === 'number') game.questionCount = Math.max(3, Math.min(20, cfg.questionCount));
    broadcast();
  });

  socket.on('host:reshuffle-teams', () => {
    if (!isHost() || !game.teamMode) return;
    redistributePlayersToTeams();
    broadcast();
  });

  socket.on('host:start-quiz', (categoryKey) => {
    if (!isHost()) return;
    if (!game.players.size) return;
    startQuizGame(categoryKey, false);
  });

  socket.on('host:start-lightning', (categoryKey) => {
    if (!isHost()) return;
    if (!game.players.size) return;
    startQuizGame(categoryKey, true);
  });

  socket.on('host:start-custom-quiz', (payload) => {
    if (!isHost()) return;
    if (!game.players.size) return;
    const qs = Array.isArray(payload?.questions) ? payload.questions : [];
    const valid = qs.filter(q =>
      q && typeof q.q === 'string' && Array.isArray(q.a) && q.a.length === 4 &&
      typeof q.c === 'number' && q.c >= 0 && q.c <= 3
    ).map(q => ({
      q: String(q.q).slice(0, 300),
      a: q.a.map(x => String(x).slice(0, 120)),
      c: q.c,
      isEmoji: !!q.isEmoji,
    }));
    if (!valid.length) return;
    game.mode = 'quiz';
    game.lightning = false;
    game.timeLimit = game.configTimeLimit;
    game.category = 'custom:' + (payload.title || 'Egen quiz').slice(0, 40);
    game.questions = valid.slice(0, 25);
    game.qIndex = -1;
    for (const p of game.players.values()) {
      p.score = 0; p.streak = 0; p.bestStreak = 0; p.totalCorrect = 0;
      p.totalWrong = 0; p.totalSkipped = 0; p.fastestMs = null; p.firstCount = 0;
    }
    for (const t of game.teams) t.score = 0;
    nextQuestion();
  });

  socket.on('host:start-voting', () => {
    if (!isHost() || !game.players.size) return;
    startVoting();
  });

  socket.on('host:add-voting-prompts', (prompts) => {
    if (!isHost()) return;
    if (!Array.isArray(prompts)) return;
    const clean = prompts.filter(p => typeof p === 'string' && p.trim().length > 5).map(p => String(p).slice(0, 200));
    customVotingPrompts.push(...clean);
    refreshVotingPool();
    socket.emit('voting-prompts-added', { count: clean.length, total: customVotingPrompts.length });
  });

  socket.on('host:next-voting', () => {
    if (!isHost()) return;
    startVoting();
  });

  socket.on('host:end-voting', () => {
    if (!isHost()) return;
    endVoting();
  });

  socket.on('host:start-scatter', () => {
    if (!isHost() || !game.players.size) return;
    startScatter();
  });

  socket.on('host:end-scatter', () => {
    if (!isHost()) return;
    if (game.phase === 'scatter-play') endScatter();
  });

  socket.on('host:icebreaker', () => {
    if (!isHost() || !game.players.size) return;
    drawIcebreaker();
  });

  socket.on('host:start-snake', () => {
    if (!isHost() || !game.players.size) return;
    startSnake();
  });

  socket.on('host:end-snake', () => {
    if (!isHost()) return;
    if (game.phase === 'snake') endSnake();
  });

  socket.on('player:snake-dir', (dir) => {
    if (game.phase !== 'snake' || !game.snake) return;
    const s = game.snake.snakes.get(socket.id);
    if (!s || !s.alive) return;
    if (!['up','down','left','right'].includes(dir)) return;
    // Ignore if opposite of current dir
    if (OPPOSITE[s.dir] === dir) return;
    s.nextDir = dir;
  });

  socket.on('host:start-bomb', () => {
    if (!isHost() || !game.players.size) return;
    startBomberman();
  });

  socket.on('host:end-bomb', () => {
    if (!isHost()) return;
    if (game.phase === 'bomb') endBomberman();
  });

  socket.on('player:bomb-move', (dir) => {
    if (game.phase !== 'bomb' || !game.bomb) return;
    const p = game.bomb.players.get(socket.id);
    if (!p || !p.alive) return;
    if (dir === null || dir === 'stop') { p.nextDir = null; return; }
    if (!['up','down','left','right'].includes(dir)) return;
    p.nextDir = dir;
  });

  socket.on('player:bomb-drop', () => {
    if (game.phase !== 'bomb' || !game.bomb) return;
    const p = game.bomb.players.get(socket.id);
    if (!p || !p.alive) return;
    if (p.bombsPlaced >= p.bombsMax) return;
    if (game.bomb.bombs.some(bb => bb.x === p.x && bb.y === p.y)) return;
    game.bomb.bombs.push({
      id: ++game.bomb.bombCounter,
      x: p.x, y: p.y,
      ownerId: p.id,
      explodesAt: Date.now() + BOMB_FUSE,
      range: p.range,
    });
    p.bombsPlaced += 1;
  });

  socket.on('host:wheel', () => {
    if (!isHost() || !game.players.size) return;
    const names = [...game.players.values()].map(p => p.name);
    game.phase = 'wheel';
    game.wheelResult = names[Math.floor(Math.random() * names.length)];
    broadcast();
  });

  socket.on('host:reveal', () => { if (isHost()) revealAnswer(); });
  socket.on('host:leaderboard', () => { if (isHost()) { game.phase = 'leaderboard'; broadcast(); } });
  socket.on('host:next', () => { if (isHost()) nextQuestion(); });
  socket.on('host:skip', () => {
    if (!isHost() || game.phase !== 'question') return;
    // Null out results — no one gets points, streaks reset for those who didn't answer
    for (const p of game.players.values()) {
      p.lastCorrect = null;
      p.lastDelta = 0;
      p.streak = 0;
    }
    game.phase = 'reveal';
    broadcast();
  });
  socket.on('host:pause', () => {
    if (!isHost() || game.phase !== 'question') return;
    game.paused = true;
    game.pauseRemainingMs = Math.max(0, game.timeLimit - (Date.now() - game.questionStartedAt));
    broadcast();
  });
  socket.on('host:resume', () => {
    if (!isHost() || !game.paused) return;
    game.paused = false;
    game.questionStartedAt = Date.now() - (game.timeLimit - game.pauseRemainingMs);
    broadcast();
  });
  socket.on('host:reset', () => { if (isHost()) resetToLobby(); });
  socket.on('host:rename-team', ({ id, name }) => {
    if (!isHost() || !game.teamMode) return;
    const team = game.teams.find(t => t.id === id);
    if (!team) return;
    const clean = String(name || '').trim().slice(0, 20);
    if (clean) { team.name = clean; broadcast(); }
  });

  socket.on('host:kick', (playerId) => {
    if (!isHost()) return;
    game.players.delete(playerId);
    io.to(playerId).emit('kicked');
    broadcast();
  });

  socket.on('disconnect', () => {
    if (game.players.has(socket.id)) {
      game.players.delete(socket.id);
      broadcast();
    }
    if (socket.id === game.hostId) {
      game.hostId = null;
      // Auto-reset til lobby når vert lukker
      resetToLobby();
    }
  });
});

// ---- Boot ----
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return ips;
}

http.listen(PORT, async () => {
  const ips = getLocalIPs();
  const url = ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`;
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         AVDELINGSSHOW — live server          ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log('  Vert-skjerm (åpne på PC/projektor):');
  console.log(`    ${url}/host\n`);
  console.log('  Spillere kobler seg på (telefon/laptop):');
  ips.forEach(ip => console.log(`    http://${ip}:${PORT}`));
  console.log('');
  try {
    const qr = await QRCode.toString(url, { type: 'terminal', small: true });
    console.log(qr);
  } catch {}
  console.log(`  → Trykk Ctrl+C for å stoppe.\n`);
});
