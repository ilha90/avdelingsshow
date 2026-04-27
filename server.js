// server.js — Avdelingsshow server (ESM)
import express from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  QUIZ_CATEGORIES,
  MOST_LIKELY,
  SCATTERGORIES,
  ICEBREAKERS,
  TEAM_NAMES,
  TUTORIAL_TEXT
} from './public/data.js';
import { BOMB_CHARS, getChar } from './public/bomb-chars.js';
import { SNAKE_CHARS, getSnakeChar } from './public/snake-chars.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'dnb';
const SCORES_FILE = path.join(__dirname, 'scores.json');

// ==================== Express setup ====================
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: '*' }, maxHttpBufferSize: 256 * 1024 });

app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') ||
      req.path === '/' || req.path === '/host') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get(['/host', '/Host'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// Favicon — SVG bombe
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="28" cy="36" r="20" fill="#111"/><path d="M44 22 L50 16 L56 18 L58 24 L52 26" stroke="#d4af37" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="58" cy="24" r="3" fill="#ff6a2a"/></svg>`);
});

// Connect URL (for QR)
function getConnectUrl(req){
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:' + PORT;
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return `${proto}://${host}/`;
}

app.get('/connect-url', (req, res) => {
  res.json({ url: getConnectUrl(req) });
});

// Health endpoint + keep-alive ping for Render free tier
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    players: game.players.size,
    phase: game.phase,
    uptime: process.uptime()
  });
});

app.get('/qr', async (req, res) => {
  try {
    const url = getConnectUrl(req);
    const buf = await QRCode.toBuffer(url, { width: 440, margin: 1, color: { dark: '#0a1a15', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.send(buf);
  } catch(e){
    res.status(500).send('qr-error');
  }
});

// Scores API
app.get('/scores', (req, res) => {
  const game = (req.query.game || 'all').toString();
  const data = loadScores();
  const arr = (game === 'all')
    ? Object.values(data).flat()
    : (data[game] || []);
  arr.sort((a,b) => b.score - a.score);
  res.json(arr.slice(0, 100));
});

// ==================== Scores persistence ====================
function loadScores(){
  try {
    if (!fs.existsSync(SCORES_FILE)) return {};
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch(e){ return {}; }
}
function saveScores(obj){
  try { fs.writeFileSync(SCORES_FILE, JSON.stringify(obj)); } catch(e) {}
}
function recordScores(gameType, playerList){
  if (!playerList || playerList.length < 4) return;
  const data = loadScores();
  if (!data[gameType]) data[gameType] = [];
  const now = Date.now();
  for (const p of playerList){
    if (!p || !p.name || typeof p.score !== 'number' || p.score <= 0) continue;
    data[gameType].push({ name: p.name, score: p.score, at: now });
  }
  data[gameType].sort((a,b) => b.score - a.score);
  data[gameType] = data[gameType].slice(0, 200);
  saveScores(data);
}

// ==================== Helpers ====================
function sanitizeName(s){
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
}
function sanitizeEmoji(s){
  return String(s || '🦊').trim().slice(0, 6);
}
function sanitizeText(s, max = 300){
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function shuffle(arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = (Math.random() * (i+1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rand(arr){ return arr[(Math.random()*arr.length)|0]; }

// ==================== Game state ====================
const game = {
  phase: 'lobby',
  players: new Map(),  // id -> { id, name, emoji, color, score, team, alive, ... }
  hosts: new Set(),    // socket ids
  config: {
    teams: false,
    qcount: 10,
    qtime: 20,
    lbevery: 3,
    lighttime: 5,
    scattertime: 60,
    lietime: 30,
    snaketime: 90,
    bombtime: 120
  },
  // Quiz state
  quiz: null,  // { questions, index, question, startAt, deadline, answers: Map(pid -> {idx, t}), isLightning, streaks: Map }
  // Voting
  vote: null,  // { prompt, votes: Map(pid->targetId) }
  // Scatter
  scatter: null, // { letter, categories, deadline, entries: Map(pid -> [5 strings]) }
  // Lie
  lie: null,    // { claims: Map(pid -> {items:[3], lieIdx}), order: [pid,...], i: 0, votes: Map(pid -> 0..2), deadline }
  // Wheel
  wheel: null,  // { chosen }
  // Icebreaker
  icebreaker: null, // { prompt, target }
  // Snake
  snake: null,  // { snakes: Map, food: [], tickTimer, endAt }
  // Bomb
  bomb: null,   // { players: Map, bombs: Map, hard: [], soft: [], powerups: [], tickTimer, endAt, explosions }
  bombSelect: null, // { chosen: Map<pid, charId>, deadline, timer }
  snakeSelect: null, // { chosen: Map<pid, charId>, deadline, timer }
  // AI questions
  customQuestions: [],
  customMostLikely: [],
  // Tutorial
  tutorialGame: null,
  tutorialText: '',
  _tutorialNextFn: null,
  // Awards / match stats — per-spill-statistikk som vises i end-screen.
  // Hver stat er Map<playerId, number>, + meta for siste spill
  matchStats: {
    firstAnswers: new Map(),   // quiz: antall ganger først ute
    correctAnswers: new Map(), // quiz: antall riktige
    totalAnswers: new Map(),   // quiz: totalt antall svar (for nøyaktighet)
    bestStreak: new Map(),     // quiz: høyeste streak i løpet av spillet
    allCorrectRounds: 0,       // quiz: antall runder der alle svarte riktig
    fastestAnswer: null,       // quiz: { pid, name, ms } — raskeste riktige svar
    kills: new Map(),          // bomb: antall kills
    biggestCombo: null,        // bomb: { pid, name, count } — største combo i ett tick
    survived: new Map(),       // bomb: antall ganger siste overlevende
    biggestSnake: new Map(),   // snake: lengste slange noensinne
    apples: new Map(),         // snake: antall matebiter
    bestScatter: new Map(),    // scatter: beste enkeltinnsending
    votesReceived: new Map(),  // voting: totalt antall stemmer fått
    liesCaught: new Map()      // lie: antall løgner gjenkjent
  },
  lastGame: null,  // 'quiz' | 'bomb' | 'snake' | ...
  lastCharacters: new Map(), // pid -> charId fra siste bomb/snake-runde
  sessionScores: new Map(),  // pid -> { name, emoji, total, gamesPlayed } — akkumulert over hele kvelden
  sessionGames: 0
};

function teamForIndex(i){
  return TEAM_NAMES[i % TEAM_NAMES.length];
}

function assignTeams(){
  if (!game.config.teams){
    for (const p of game.players.values()) p.team = null;
    return;
  }
  const teamCount = Math.min(TEAM_NAMES.length, Math.max(2, Math.ceil(game.players.size / 3)));
  const arr = Array.from(game.players.values());
  shuffle(arr).forEach((p, i) => {
    p.team = teamForIndex(i % teamCount);
  });
}

function publicState(){
  const players = Array.from(game.players.values()).map(p => ({
    id: p.id, name: p.name, emoji: p.emoji, color: p.color, score: p.score|0,
    team: p.team ? { name: p.team.name, emoji: p.team.emoji, color: p.team.color } : null,
    hasAnswered: game.quiz ? game.quiz.answers.has(p.id) : false,
    hasVoted: game.vote ? game.vote.votes.has(p.id) : false,
    hasSubmitted: (game.scatter && game.scatter.entries.has(p.id)) || (game.lie && game.lie.claims.has(p.id)),
    streak: game.quiz ? (game.quiz.streaks.get(p.id) || 0) : 0
  }));
  const base = {
    phase: game.phase,
    players,
    config: game.config,
    tutorialGame: game.tutorialGame,
    tutorialText: game.tutorialText,
    customQuestionsCount: game.customQuestions.length
  };
  if (game.quiz){
    const q = game.quiz.question;
    base.quiz = {
      index: game.quiz.index,
      total: game.quiz.questions.length,
      question: q ? { q: q.q, a: q.a, isEmoji: q.isEmoji, category: q.category } : null,
      deadline: game.quiz.deadline,
      isLightning: !!game.quiz.isLightning,
      answersCount: game.quiz.answers ? game.quiz.answers.size : 0,
      correctIdx: game.quiz.revealCorrect ? q?.c : null
    };
  }
  if (game.vote){
    base.vote = {
      prompt: game.vote.prompt,
      votesCount: game.vote.votes.size,
      results: game.vote.revealResults ? game.vote.results : null
    };
  }
  if (game.scatter){
    base.scatter = {
      letter: game.scatter.letter,
      categories: game.scatter.categories,
      deadline: game.scatter.deadline,
      submittedCount: game.scatter.entries.size,
      review: game.scatter.review || null
    };
  }
  if (game.lie){
    base.lie = {
      stage: game.lie.stage, // 'collect' | 'play' | 'reveal'
      current: game.lie.current || null,
      submittedCount: game.lie.claims.size,
      total: game.players.size,
      votesCount: game.lie.votes ? game.lie.votes.size : 0,
      deadline: game.lie.deadline
    };
  }
  if (game.icebreaker){
    base.icebreaker = { prompt: game.icebreaker.prompt, target: game.icebreaker.target };
  }
  if (game.wheel){
    base.wheel = { chosen: game.wheel.chosen };
  }
  if (game.bombSelect){
    base.bombSelect = {
      chosen: Array.from(game.bombSelect.chosen.entries()).map(([pid, cid]) => ({ pid, charId: cid })),
      deadline: game.bombSelect.deadline
    };
  }
  if (game.snakeSelect){
    base.snakeSelect = {
      chosen: Array.from(game.snakeSelect.chosen.entries()).map(([pid, cid]) => ({ pid, charId: cid })),
      deadline: game.snakeSelect.deadline
    };
  }
  // Awards — kun når vi er på end-phase
  if (game.phase === 'end'){
    base.awards = computeAwards();
    base.recap = computeMatchRecap();
    base.lastGame = game.lastGame;
    // Inkluder karakter-IDs for podium-rendering
    if (game.lastCharacters && game.lastCharacters.size){
      base.lastCharacters = Array.from(game.lastCharacters.entries()).map(([pid, cid]) => ({ pid, charId: cid }));
    }
  }
  // Session-totals (akkumulert over alle spill kvelden)
  if (game.sessionGames > 0){
    base.session = {
      games: game.sessionGames,
      scores: Array.from(game.sessionScores.entries())
        .map(([pid, rec]) => ({ pid, name: rec.name, emoji: rec.emoji, total: rec.total, gamesPlayed: rec.gamesPlayed }))
        .sort((a, b) => b.total - a.total)
    };
  }
  return base;
}

function computeAwards(){
  const awards = [];
  const pName = (pid) => (game.players.get(pid) || {}).name || '?';
  const pEmoji = (pid) => (game.players.get(pid) || {}).emoji || '🎉';
  const topOf = (map) => {
    let best = null, bestVal = 0;
    for (const [pid, v] of map){
      if (v > bestVal){ bestVal = v; best = pid; }
    }
    return best ? { pid: best, value: bestVal, name: pName(best), emoji: pEmoji(best) } : null;
  };
  const add = (icon, label, winner, valueText) => {
    if (!winner) return;
    awards.push({ icon, label, winner: winner.name, emoji: winner.emoji, value: valueText });
  };
  const lg = game.lastGame;

  // Quiz-type spill
  if (lg === 'quiz' || lg === 'lightning'){
    const ff = topOf(game.matchStats.firstAnswers);
    if (ff) add('⚡', 'Lynhurtig', ff, ff.value + ' × først ute');
    const ca = topOf(game.matchStats.correctAnswers);
    if (ca) add('🎯', 'Treffsikker', ca, ca.value + ' riktige');
    const bs = topOf(game.matchStats.bestStreak);
    if (bs && bs.value >= 3) add('🔥', 'Beste streak', bs, bs.value + ' på rad');
    if (game.matchStats.allCorrectRounds > 0){
      awards.push({ icon: '💯', label: 'Samlet innsats', winner: 'Alle', emoji: '🎉', value: game.matchStats.allCorrectRounds + ' ' + (game.matchStats.allCorrectRounds === 1 ? 'runde' : 'runder') + ' der alle traff rett' });
    }
  }
  // Bomb
  if (lg === 'bomb'){
    const k = topOf(game.matchStats.kills);
    if (k) add('💣', 'Bombemester', k, k.value + ' kills');
    const s = topOf(game.matchStats.survived);
    if (s) add('🛡️', 'Siste mann', s, 'overlevde runden');
  }
  // Snake
  if (lg === 'snake'){
    const big = topOf(game.matchStats.biggestSnake);
    if (big) add('🐍', 'Slangekonge', big, big.value + ' segmenter');
    const a = topOf(game.matchStats.apples);
    if (a) add('🍎', 'Fråtser', a, a.value + ' epler');
  }
  // Generelt — høyeste score uansett spill
  const players = Array.from(game.players.values()).sort((a, b) => b.score - a.score);
  if (players.length > 0 && players[0].score > 0){
    add('🏆', 'Totalseier', { name: players[0].name, emoji: players[0].emoji }, players[0].score + ' poeng');
  }
  return awards;
}

function computeMatchRecap(){
  // Returnerer opptil 5 highlight-kort for match-recap sekvens
  const recap = [];
  const pp = (pid) => game.players.get(pid);
  const lg = game.lastGame;

  // 1. FLEST POENG — alltid vis
  const players = Array.from(game.players.values()).sort((a, b) => b.score - a.score);
  if (players.length > 0 && players[0].score > 0){
    recap.push({
      icon: '🏆',
      title: 'Storvinneren',
      stat: players[0].score + ' poeng',
      name: players[0].name,
      emoji: players[0].emoji,
      color: 'gold'
    });
  }

  // 2. Quiz: raskeste svar
  if ((lg === 'quiz' || lg === 'lightning') && game.matchStats.fastestAnswer){
    const f = game.matchStats.fastestAnswer;
    const p = pp(f.pid);
    recap.push({
      icon: '⚡',
      title: 'Raskeste svar',
      stat: (f.ms / 1000).toFixed(2) + ' sekunder',
      name: f.name,
      emoji: p?.emoji || '⚡',
      color: 'mint'
    });
  }

  // 3. Quiz: beste streak
  if ((lg === 'quiz' || lg === 'lightning') && game.matchStats.bestStreak.size){
    let bestPid = null, bestN = 0;
    for (const [pid, n] of game.matchStats.bestStreak){
      if (n > bestN){ bestPid = pid; bestN = n; }
    }
    if (bestN >= 3){
      const p = pp(bestPid);
      recap.push({
        icon: '🔥',
        title: 'Lengste streak',
        stat: bestN + ' på rad',
        name: p?.name || '?',
        emoji: p?.emoji || '🔥',
        color: 'orange'
      });
    }
  }

  // 4. Quiz: nøyaktighet (riktige / totale)
  if ((lg === 'quiz' || lg === 'lightning')){
    let bestAccPid = null, bestAcc = 0, bestTotal = 0;
    for (const [pid, correct] of game.matchStats.correctAnswers){
      const total = game.matchStats.totalAnswers.get(pid) || 1;
      const acc = correct / total;
      if (total >= 3 && acc > bestAcc){
        bestAccPid = pid; bestAcc = acc; bestTotal = correct;
      }
    }
    if (bestAccPid){
      const p = pp(bestAccPid);
      recap.push({
        icon: '🎯',
        title: 'Høyeste nøyaktighet',
        stat: Math.round(bestAcc * 100) + '% (' + bestTotal + ' riktige)',
        name: p?.name || '?',
        emoji: p?.emoji || '🎯',
        color: 'mint'
      });
    }
  }

  // 5. Bomb: største combo
  if (lg === 'bomb' && game.matchStats.biggestCombo){
    const c = game.matchStats.biggestCombo;
    const p = pp(c.pid);
    const label = c.count >= 4 ? 'MEGA' : c.count === 3 ? 'TRIPPEL' : 'DOBBELT';
    recap.push({
      icon: '💥',
      title: 'Største combo',
      stat: label + ' (' + c.count + ' i ett tick)',
      name: c.name,
      emoji: p?.emoji || '💣',
      color: 'danger'
    });
  }

  // 6. Bomb: flest kills
  if (lg === 'bomb' && game.matchStats.kills.size){
    let bestPid = null, bestN = 0;
    for (const [pid, n] of game.matchStats.kills){
      if (n > bestN){ bestPid = pid; bestN = n; }
    }
    if (bestN > 0){
      const p = pp(bestPid);
      recap.push({
        icon: '💣',
        title: 'Flest drap',
        stat: bestN + ' kills',
        name: p?.name || '?',
        emoji: p?.emoji || '💣',
        color: 'danger'
      });
    }
  }

  // 7. Snake: lengste slange
  if (lg === 'snake' && game.matchStats.biggestSnake.size){
    let bestPid = null, bestN = 0;
    for (const [pid, n] of game.matchStats.biggestSnake){
      if (n > bestN){ bestPid = pid; bestN = n; }
    }
    if (bestN >= 5){
      const p = pp(bestPid);
      const label = bestN >= 50 ? 'LEGENDE!' : bestN >= 30 ? 'EPISK!' : bestN >= 20 ? 'LANG' : 'OK';
      recap.push({
        icon: '🐍',
        title: 'Lengste slange',
        stat: bestN + ' segmenter ' + label,
        name: p?.name || '?',
        emoji: p?.emoji || '🐍',
        color: 'mint'
      });
    }
  }

  // 8. Snake: flest epler
  if (lg === 'snake' && game.matchStats.apples.size){
    let bestPid = null, bestN = 0;
    for (const [pid, n] of game.matchStats.apples){
      if (n > bestN){ bestPid = pid; bestN = n; }
    }
    if (bestN >= 3){
      const p = pp(bestPid);
      recap.push({
        icon: '🍎',
        title: 'Fråtser',
        stat: bestN + ' epler',
        name: p?.name || '?',
        emoji: p?.emoji || '🍎',
        color: 'gold'
      });
    }
  }

  // 9. Alle-riktig-runder (hvis noe, spesialt)
  if ((lg === 'quiz' || lg === 'lightning') && game.matchStats.allCorrectRounds > 0){
    recap.push({
      icon: '💯',
      title: 'Samlet innsats',
      stat: game.matchStats.allCorrectRounds + ' runde' + (game.matchStats.allCorrectRounds > 1 ? 'r' : '') + ' der alle traff',
      name: 'Hele gjengen',
      emoji: '🎉',
      color: 'gold'
    });
  }

  return recap.slice(0, 5); // Cap til 5 highlights
}

function resetMatchStats(){
  game.matchStats.firstAnswers.clear();
  game.matchStats.correctAnswers.clear();
  game.matchStats.totalAnswers.clear();
  game.matchStats.bestStreak.clear();
  game.matchStats.allCorrectRounds = 0;
  game.matchStats.fastestAnswer = null;
  game.matchStats.kills.clear();
  game.matchStats.biggestCombo = null;
  game.matchStats.survived.clear();
  game.matchStats.biggestSnake.clear();
  game.matchStats.apples.clear();
  game.matchStats.bestScatter.clear();
  game.matchStats.votesReceived.clear();
  game.matchStats.liesCaught.clear();
}

// Accumuler scores fra ferdigspilte runde til sesjon-total
function accumulateSessionScores(){
  for (const p of game.players.values()){
    if (!p.score || p.score <= 0) continue;
    const rec = game.sessionScores.get(p.id) || { name: p.name, emoji: p.emoji, total: 0, gamesPlayed: 0 };
    rec.name = p.name; rec.emoji = p.emoji;
    rec.total += p.score;
    rec.gamesPlayed += 1;
    game.sessionScores.set(p.id, rec);
  }
  game.sessionGames += 1;
}

function resetSessionScores(){
  game.sessionScores.clear();
  game.sessionGames = 0;
}

function broadcast(){
  io.emit('state', publicState());
}

// ==================== Socket handlers ====================
io.on('connection', socket => {

  // ===== Player join / reconnect =====
  socket.on('player:hello', ({ name, emoji, token } = {}) => {
    const n = sanitizeName(name);
    if (!n) { socket.emit('error:msg', 'Ugyldig navn'); return; }
    const e = sanitizeEmoji(emoji);
    // Reconnect by token if provided
    let rec = null;
    if (token){
      for (const p of game.players.values()){
        if (p.token === token){ rec = p; break; }
      }
    }
    if (rec){
      // Flytt rec til ny socket-id som map-nøkkel (den gamle nøkkelen var gammel socket-id)
      if (rec.id !== socket.id){
        game.players.delete(rec.id);
        rec.id = socket.id;
        game.players.set(socket.id, rec);
        // Flytt også i aktive spill-Maps hvis spillet pågår
        if (game.bombSelect && game.bombSelect.chosen.has(rec.id)){
          const c = game.bombSelect.chosen.get(rec.id);
          game.bombSelect.chosen.delete(rec.id);
          game.bombSelect.chosen.set(socket.id, c);
        }
        if (game.snakeSelect && game.snakeSelect.chosen.has(rec.id)){
          const c = game.snakeSelect.chosen.get(rec.id);
          game.snakeSelect.chosen.delete(rec.id);
          game.snakeSelect.chosen.set(socket.id, c);
        }
        // Bevar quiz/vote/scatter/lie-svar ved reconnect
        if (game.quiz && game.quiz.answers.has(rec.id)){
          const a = game.quiz.answers.get(rec.id);
          game.quiz.answers.delete(rec.id);
          game.quiz.answers.set(socket.id, a);
        }
        if (game.quiz && game.quiz.streaks.has(rec.id)){
          const s = game.quiz.streaks.get(rec.id);
          game.quiz.streaks.delete(rec.id);
          game.quiz.streaks.set(socket.id, s);
        }
        if (game.vote && game.vote.votes.has(rec.id)){
          const v = game.vote.votes.get(rec.id);
          game.vote.votes.delete(rec.id);
          game.vote.votes.set(socket.id, v);
        }
        if (game.scatter && game.scatter.entries.has(rec.id)){
          const e = game.scatter.entries.get(rec.id);
          game.scatter.entries.delete(rec.id);
          game.scatter.entries.set(socket.id, e);
        }
        if (game.lie){
          if (game.lie.claims && game.lie.claims.has(rec.id)){
            const c = game.lie.claims.get(rec.id);
            game.lie.claims.delete(rec.id);
            game.lie.claims.set(socket.id, c);
          }
          if (game.lie.votes && game.lie.votes.has(rec.id)){
            const v = game.lie.votes.get(rec.id);
            game.lie.votes.delete(rec.id);
            game.lie.votes.set(socket.id, v);
          }
        }
        if (game.snake && game.snake.snakes.has(rec.id)){
          const s = game.snake.snakes.get(rec.id);
          s.id = socket.id;
          game.snake.snakes.delete(rec.id);
          game.snake.snakes.set(socket.id, s);
        }
        if (game.bomb && game.bomb.players.has(rec.id)){
          const bp = game.bomb.players.get(rec.id);
          bp.id = socket.id;
          game.bomb.players.delete(rec.id);
          game.bomb.players.set(socket.id, bp);
        }
      }
      rec.name = n; rec.emoji = e;
    } else {
      // Max 100 spillere samtidig (spec) — reconnects teller ikke mot capet
      if (game.players.size >= 100){
        socket.emit('error:msg', 'Rommet er fullt (maks 100 spillere)');
        return;
      }
      const p = {
        id: socket.id,
        token: Math.random().toString(36).slice(2) + Date.now().toString(36),
        name: n, emoji: e,
        color: randColor(),
        score: 0,
        team: null
      };
      if (game.config.teams){
        const counts = new Map();
        for (const q of game.players.values()){
          if (q.team) counts.set(q.team.name, (counts.get(q.team.name) || 0) + 1);
        }
        const activeTeams = TEAM_NAMES.slice(0, Math.min(TEAM_NAMES.length, Math.max(2, Math.ceil((game.players.size+1)/3))));
        activeTeams.sort((a,b) => (counts.get(a.name)||0) - (counts.get(b.name)||0));
        p.team = activeTeams[0];
      }
      game.players.set(socket.id, p);
      rec = p;
    }
    socket.emit('player:welcome', { id: socket.id, token: rec.token, team: rec.team });
    broadcast();
  });

  socket.on('player:reaction', (emoji) => {
    const now = Date.now();
    if (!socket._reactAt) socket._reactAt = 0;
    if (now - socket._reactAt < 200) return;
    socket._reactAt = now;
    io.emit('reaction', { emoji: sanitizeEmoji(emoji) || '👍' });
  });

  socket.on('disconnect', () => {
    game.hosts.delete(socket.id);
    if (game.players.has(socket.id)){
      // Don't delete immediately — allow reconnect via token for 60s
      const p = game.players.get(socket.id);
      setTimeout(() => {
        const still = game.players.get(socket.id);
        if (still && still.id === socket.id && !io.sockets.sockets.get(socket.id)){
          game.players.delete(socket.id);
          broadcast();
        }
      }, 60000);
    }
    broadcast();
  });

  // ===== Host =====
  socket.on('host:hello', ({ password } = {}) => {
    if (password !== HOST_PASSWORD) { socket.emit('host:denied'); return; }
    // Kun 1 host om gangen — kick den gamle
    if (game.hosts.size > 0){
      for (const oldHostId of game.hosts){
        if (oldHostId !== socket.id){
          io.to(oldHostId).emit('host:evicted');
        }
      }
      game.hosts.clear();
    }
    game.hosts.add(socket.id);
    socket.emit('host:ok', { connectUrl: null });
    broadcast();
  });

  socket.on('host:config', (cfg) => {
    if (!game.hosts.has(socket.id)) return;
    const c = game.config;
    if (cfg.teams !== undefined) c.teams = !!cfg.teams;
    if (cfg.qcount) c.qcount = clamp(parseInt(cfg.qcount,10), 5, 20);
    if (cfg.qtime) c.qtime = clamp(parseInt(cfg.qtime,10), 5, 60);
    if (cfg.lbevery !== undefined) c.lbevery = clamp(parseInt(cfg.lbevery,10), 0, 20);
    if (cfg.lighttime) c.lighttime = clamp(parseInt(cfg.lighttime,10), 3, 20);
    if (cfg.scattertime) c.scattertime = clamp(parseInt(cfg.scattertime,10), 20, 300);
    if (cfg.lietime) c.lietime = clamp(parseInt(cfg.lietime,10), 10, 180);
    if (cfg.snaketime !== undefined) c.snaketime = clamp(parseInt(cfg.snaketime,10), 0, 600);
    if (cfg.bombtime !== undefined) c.bombtime = clamp(parseInt(cfg.bombtime,10), 0, 600);
    if (cfg.teams !== undefined) assignTeams();
    broadcast();
  });

  socket.on('host:reset', () => {
    if (!game.hosts.has(socket.id)) return;
    stopAllTimers();
    game.phase = 'lobby';
    game.quiz = null; game.vote = null; game.scatter = null; game.lie = null;
    game.icebreaker = null; game.wheel = null;
    game.snake = null; game.bomb = null;
    if (game.bombSelect && game.bombSelect.timer) clearTimeout(game.bombSelect.timer);
    game.bombSelect = null;
    if (game.snakeSelect && game.snakeSelect.timer) clearTimeout(game.snakeSelect.timer);
    game.snakeSelect = null;
    game.lastGame = null;
    for (const p of game.players.values()) p.score = 0;
    resetMatchStats();
    // MERK: sessionScores nullstilles IKKE her — det gjøres kun ved host:reset-session
    broadcast();
  });
  socket.on('host:reset-session', () => {
    if (!game.hosts.has(socket.id)) return;
    resetSessionScores();
    broadcast();
  });

  socket.on('host:ai-questions', (qs) => {
    if (!game.hosts.has(socket.id)) return;
    if (!Array.isArray(qs)) return;
    for (const q of qs){
      if (q && typeof q.q === 'string' && Array.isArray(q.a) && q.a.length === 4 && Number.isInteger(q.c)){
        game.customQuestions.push({
          q: sanitizeText(q.q, 300),
          a: q.a.map(x => sanitizeText(x, 120)),
          c: Math.max(0, Math.min(3, q.c|0)),
          category: 'custom'
        });
      }
    }
    if (game.customQuestions.length > 200) game.customQuestions = game.customQuestions.slice(-200);
    broadcast();
  });

  // Game starters (imported later)
  socket.on('host:start-quiz', ({ category } = {}) => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('quiz', () => startQuiz({ category, isLightning: false }));
  });
  socket.on('host:start-lightning', ({ category } = {}) => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('lightning', () => startQuiz({ category, isLightning: true }));
  });
  socket.on('host:start-voting', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('voting', () => startVoting());
  });
  socket.on('host:next-vote', () => {
    if (!game.hosts.has(socket.id)) return;
    nextVote();
  });
  socket.on('host:start-scatter', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('scatter', () => startScatter());
  });
  socket.on('host:scatter-end', () => {
    if (!game.hosts.has(socket.id)) return;
    endScatter();
  });
  socket.on('host:start-lie', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('lie', () => startLie());
  });
  socket.on('host:lie-next', () => {
    if (!game.hosts.has(socket.id)) return;
    advanceLie();
  });
  socket.on('host:start-icebreaker', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('icebreaker', () => startIcebreaker());
  });
  socket.on('host:next-icebreaker', () => {
    if (!game.hosts.has(socket.id)) return;
    startIcebreaker();
  });
  socket.on('host:start-wheel', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('wheel', () => startWheel());
  });
  socket.on('host:spin-wheel', () => {
    if (!game.hosts.has(socket.id)) return;
    spinWheel();
  });
  socket.on('host:start-snake', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('snake', () => startSnakeCharacterSelect());
  });
  socket.on('player:snake-char', ({ charId } = {}) => {
    if (!game.snakeSelect) return;
    if (game.phase !== 'snake-select') return;
    const p = game.players.get(socket.id); if (!p) return;
    if (!SNAKE_CHARS.find(c => c.id === charId)) return;
    game.snakeSelect.chosen.set(socket.id, charId);
    broadcast();
    if (game.snakeSelect.chosen.size >= game.players.size){
      startSnakeNow();
    }
  });
  socket.on('host:end-snake', () => {
    if (!game.hosts.has(socket.id)) return;
    endSnake();
  });
  socket.on('host:start-bomb', () => {
    if (!game.hosts.has(socket.id)) return;
    playTutorialThen('bomb', () => startBombCharacterSelect());
  });
  socket.on('player:bomb-char', ({ charId } = {}) => {
    if (!game.bombSelect) return;
    if (game.phase !== 'bomb-select') return;
    const p = game.players.get(socket.id); if (!p) return;
    if (!BOMB_CHARS.find(c => c.id === charId)) return;
    game.bombSelect.chosen.set(socket.id, charId);
    broadcast();
    // Alle har valgt?
    if (game.bombSelect.chosen.size >= game.players.size){
      startBombermanNow();
    }
  });
  socket.on('host:end-bomb', () => {
    if (!game.hosts.has(socket.id)) return;
    endBomberman();
  });
  socket.on('host:end-quiz', () => {
    if (!game.hosts.has(socket.id)) return;
    if (!game.quiz) return;
    if (game.quiz.questionTimer){ clearTimeout(game.quiz.questionTimer); game.quiz.questionTimer = null; }
    finishQuiz();
  });
  socket.on('host:skip-tutorial', () => {
    if (!game.hosts.has(socket.id)) return;
    if (game.phase === 'tutorial' && game._tutorialNextFn){
      const fn = game._tutorialNextFn;
      game._tutorialNextFn = null;
      fn();
    }
  });

  // ===== Host: kick en spiller =====
  socket.on('host:kick', ({ pid } = {}) => {
    if (!game.hosts.has(socket.id)) return;
    if (!pid || !game.players.has(pid)) return;
    const p = game.players.get(pid);
    io.to(pid).emit('kicked', { reason: 'Du ble kicket av host' });
    // Drop socket
    const victimSocket = io.sockets.sockets.get(pid);
    if (victimSocket) victimSocket.disconnect(true);
    game.players.delete(pid);
    // Hvis spillet er aktivt, rydd ut referanser i tilhørende Map
    if (game.snake && game.snake.snakes.has(pid)) game.snake.snakes.delete(pid);
    if (game.bomb && game.bomb.players.has(pid)) game.bomb.players.delete(pid);
    broadcast();
  });

  // ===== Host: stokk lag på nytt =====
  socket.on('host:reshuffle-teams', () => {
    if (!game.hosts.has(socket.id)) return;
    if (!game.config.teams) return;
    assignTeams();
    broadcast();
  });

  // ===== Host: legg til custom voting-prompts =====
  socket.on('host:add-voting-prompts', (prompts) => {
    if (!game.hosts.has(socket.id)) return;
    if (!Array.isArray(prompts)) return;
    for (const p of prompts){
      const s = sanitizeText(p, 200);
      if (s && s.length >= 4) game.customMostLikely.push(s);
    }
    // Cap for å hindre misbruk
    if (game.customMostLikely.length > 200) game.customMostLikely.length = 200;
    broadcast();
  });

  // ===== Quiz answer =====
  socket.on('player:answer', ({ idx } = {}) => {
    if (!game.quiz || game.phase !== 'question') return;
    const p = game.players.get(socket.id); if (!p) return;
    if (game.quiz.answers.has(socket.id)) return;
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
    game.quiz.answers.set(socket.id, { idx, t: Date.now() });
    broadcast();
    // Alle har svart?
    if (game.quiz.answers.size >= game.players.size){
      revealQuizEarly();
    }
  });

  // ===== Voting =====
  socket.on('player:vote', ({ targetId } = {}) => {
    if (!game.vote || game.phase !== 'voting') return;
    const p = game.players.get(socket.id); if (!p) return;
    if (!game.players.has(targetId)) return;
    game.vote.votes.set(socket.id, targetId);
    broadcast();
    if (game.vote.votes.size >= game.players.size){
      revealVote();
    }
  });

  // ===== Scatter submit =====
  socket.on('player:scatter', ({ entries } = {}) => {
    if (!game.scatter || game.phase !== 'scatter-play') return;
    if (!Array.isArray(entries)) return;
    const clean = entries.slice(0, 5).map(s => sanitizeText(s, 60));
    game.scatter.entries.set(socket.id, clean);
    broadcast();
  });

  // ===== Lie submit =====
  socket.on('player:lie-submit', ({ items, lieIdx } = {}) => {
    if (!game.lie || game.lie.stage !== 'collect') return;
    if (!Array.isArray(items) || items.length !== 3) return;
    if (!Number.isInteger(lieIdx) || lieIdx < 0 || lieIdx > 2) return;
    const clean = items.map(s => sanitizeText(s, 160));
    game.lie.claims.set(socket.id, { items: clean, lieIdx });
    broadcast();
    // Alle inne? Gå videre.
    if (game.lie.claims.size >= game.players.size){
      startLiePlay();
    }
  });

  socket.on('player:lie-vote', ({ idx } = {}) => {
    if (!game.lie || game.lie.stage !== 'play') return;
    if (!Number.isInteger(idx) || idx < 0 || idx > 2) return;
    // Kan ikke stemme på egen
    if (game.lie.current && socket.id === game.lie.current.pid) return;
    game.lie.votes.set(socket.id, idx);
    broadcast();
  });

  // ===== Snake controls =====
  socket.on('player:snake-dir', ({ dir } = {}) => {
    if (!game.snake) return;
    const s = game.snake.snakes.get(socket.id); if (!s || !s.alive) return;
    if (!['up','down','left','right'].includes(dir)) return;
    s.nextDir = dir;
  });

  // ===== Bomb controls =====
  socket.on('player:bomb-move', ({ dirs } = {}) => {
    if (!game.bomb) return;
    const p = game.bomb.players.get(socket.id); if (!p || !p.alive) return;
    if (!Array.isArray(dirs)) return;
    p.dirs = new Set(dirs.filter(d => ['up','down','left','right'].includes(d)));
  });
  socket.on('player:bomb-action', () => {
    if (!game.bomb) return;
    const p = game.bomb.players.get(socket.id); if (!p || !p.alive) return;
    p.actionPending = true;
  });
  socket.on('player:bomb-detonate', () => {
    if (!game.bomb) return;
    const p = game.bomb.players.get(socket.id); if (!p || !p.alive) return;
    if (!p.remote) return;
    // Detoner alle dine bomber
    for (const b of game.bomb.bombs.values()){
      if (b.owner === socket.id && !b.exploded){
        b.fuse = 0;
      }
    }
  });
});

function randColor(){
  const palette = ['#ff5a6b','#ff9d4a','#ffcf4a','#9ae053','#2fbf71','#3cc1d6','#5cc7ff','#7a9bff','#b074ff','#e56bff'];
  return palette[(Math.random()*palette.length)|0];
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v|0)); }

function playTutorialThen(gameType, startFn, ms = 5500){
  stopAllTimers();
  game.phase = 'tutorial';
  game.tutorialGame = gameType;
  game.tutorialText = TUTORIAL_TEXT[gameType] || '';
  game._tutorialNextFn = startFn;
  broadcast();
  setTimeout(() => {
    if (game.phase === 'tutorial' && game._tutorialNextFn === startFn){
      game._tutorialNextFn = null;
      startFn();
    }
  }, ms);
}

function stopAllTimers(){
  if (game.snake && game.snake.tickTimer){ clearInterval(game.snake.tickTimer); game.snake.tickTimer = null; }
  if (game.bomb && game.bomb.tickTimer){ clearInterval(game.bomb.tickTimer); game.bomb.tickTimer = null; }
  if (game.quiz && game.quiz.questionTimer){ clearTimeout(game.quiz.questionTimer); game.quiz.questionTimer = null; }
  if (game.scatter && game.scatter.timer){ clearTimeout(game.scatter.timer); game.scatter.timer = null; }
  if (game.lie && game.lie.timer){ clearTimeout(game.lie.timer); game.lie.timer = null; }
}

// Game logic lives in server-games.js (imported at bottom)

// ==================== Quiz ====================
function startQuiz({ category, isLightning } = {}){
  stopAllTimers();
  const pool = [];
  if (category === 'custom'){
    pool.push(...game.customQuestions);
  } else if (category && QUIZ_CATEGORIES[category]){
    pool.push(...QUIZ_CATEGORIES[category].questions.map(q => ({ ...q, category })));
    if (game.customQuestions.length) pool.push(...game.customQuestions);
  } else {
    for (const [k, v] of Object.entries(QUIZ_CATEGORIES)){
      pool.push(...v.questions.map(q => ({ ...q, category: k })));
    }
    if (game.customQuestions.length) pool.push(...game.customQuestions);
  }
  const total = Math.min(isLightning ? Math.min(12, game.config.qcount) : game.config.qcount, pool.length);
  const questions = shuffle(pool).slice(0, total);
  game.quiz = {
    questions, index: -1, question: null,
    startAt: 0, deadline: 0,
    answers: new Map(),
    streaks: new Map(),  // pid -> streak count
    isLightning: !!isLightning,
    revealCorrect: false,
    questionTimer: null,
    correctFirstPid: null
  };
  for (const p of game.players.values()) p.score = 0;
  // Countdown 3s
  game.phase = 'countdown';
  broadcast();
  setTimeout(() => nextQuizQuestion(), 3000);
}

function nextQuizQuestion(){
  if (!game.quiz) return;
  if (game.phase === 'lobby') return; // reset har skjedd
  game.quiz.index++;
  if (game.quiz.index >= game.quiz.questions.length){
    return finishQuiz();
  }
  const q = game.quiz.questions[game.quiz.index];
  game.quiz.question = q;
  game.quiz.answers = new Map();
  game.quiz.revealCorrect = false;
  game.quiz.correctFirstPid = null;
  game.quiz.startAt = Date.now();
  const secs = game.quiz.isLightning ? game.config.lighttime : game.config.qtime;
  game.quiz.deadline = Date.now() + secs * 1000;
  game.phase = 'question';
  broadcast();
  game.quiz.questionTimer = setTimeout(() => revealQuiz(), secs * 1000 + 100);
}

function revealQuizEarly(){
  if (!game.quiz || game.phase !== 'question') return;
  if (game.quiz.questionTimer){ clearTimeout(game.quiz.questionTimer); game.quiz.questionTimer = null; }
  revealQuiz();
}

function revealQuiz(){
  if (!game.quiz) return;
  const q = game.quiz.question; if (!q) return;
  const secs = game.quiz.isLightning ? game.config.lighttime : game.config.qtime;
  const mult = game.quiz.isLightning ? 2 : 1;
  // Sorter svar etter tid
  const answersArr = Array.from(game.quiz.answers.entries()); // [pid, {idx,t}]
  answersArr.sort((a,b) => a[1].t - b[1].t);
  const results = [];
  for (const [pid, ans] of answersArr){
    const p = game.players.get(pid); if (!p) continue;
    const correct = ans.idx === q.c;
    let base = 0, trophies = [];
    // Totale svar — for nøyaktighet-stats
    game.matchStats.totalAnswers.set(pid, (game.matchStats.totalAnswers.get(pid) || 0) + 1);
    if (correct){
      const timeLeft = Math.max(0, (game.quiz.deadline - ans.t) / 1000);
      base = Math.round((500 + Math.min(500, timeLeft / secs * 500)) * mult);
      p.score += base;
      // Match stats — correct
      game.matchStats.correctAnswers.set(pid, (game.matchStats.correctAnswers.get(pid) || 0) + 1);
      // Raskeste riktige svar totalt
      const answeredMs = ans.t - game.quiz.startAt;
      if (!game.matchStats.fastestAnswer || answeredMs < game.matchStats.fastestAnswer.ms){
        game.matchStats.fastestAnswer = { pid, name: p.name, ms: answeredMs };
      }
      // Streak
      const s = (game.quiz.streaks.get(pid) || 0) + 1;
      game.quiz.streaks.set(pid, s);
      const prevBest = game.matchStats.bestStreak.get(pid) || 0;
      if (s > prevBest) game.matchStats.bestStreak.set(pid, s);
      if (s === 3 || s === 5 || s === 7) trophies.push({ kind: 'streak', n: s });
      // First
      if (!game.quiz.correctFirstPid){
        game.quiz.correctFirstPid = pid;
        trophies.push({ kind: 'first' });
        p.score += 100;
        game.matchStats.firstAnswers.set(pid, (game.matchStats.firstAnswers.get(pid) || 0) + 1);
      }
    } else {
      game.quiz.streaks.set(pid, 0);
    }
    results.push({ pid, name: p.name, correct, delta: base + (trophies.find(t=>t.kind==='first') ? 100 : 0), trophies });
  }
  // Ikke-svarende får streak-brudd
  for (const p of game.players.values()){
    if (!game.quiz.answers.has(p.id)){
      game.quiz.streaks.set(p.id, 0);
    }
  }
  game.quiz.revealCorrect = true;
  game.phase = 'reveal';
  game.quiz.results = results;

  // 💯 Alle riktig — trigges når alle aktive spillere svarte riktig (min 2 spillere)
  const correctCount = results.filter(r => r.correct).length;
  const allCorrect = game.players.size >= 2 && correctCount === game.players.size;
  if (allCorrect){
    game.matchStats.allCorrectRounds++;
    // Gi bonus-poeng til alle og legg til trofé-event
    for (const r of results){
      const p = game.players.get(r.pid);
      if (p){ p.score += 50; r.delta += 50; }
      r.trophies = r.trophies || [];
      r.trophies.push({ kind: 'all-correct' });
    }
  }

  // Viktig: send quiz:reveal FØR broadcast(state). Klient-side setter
  // window.lastQuizResult fra quiz:reveal, og showReveal() (som kjøres via
  // state-handler) må kunne lese det. Feil rekkefølge ga 'Du svarte ikke'
  // selv for korrekte svar.
  io.emit('quiz:reveal', { correctIdx: q.c, results, allCorrect });
  broadcast();

  // Leaderboard?
  const N = game.config.lbevery;
  const isLast = game.quiz.index === game.quiz.questions.length - 1;
  const showLb = !isLast && N > 0 && ((game.quiz.index + 1) % N === 0);
  const delay = 4500;  // reveal varer 4500ms før neste fase (LB-tilstand har egen 6000ms etter)
  setTimeout(() => {
    if (!game.quiz) return;
    if (isLast){
      finishQuiz();
    } else if (showLb){
      game.phase = 'leaderboard';
      broadcast();
      setTimeout(() => {
        if (!game.quiz) return;
        game.phase = 'countdown';
        broadcast();
        setTimeout(() => nextQuizQuestion(), 3000);
      }, 6000);
    } else {
      game.phase = 'countdown';
      broadcast();
      setTimeout(() => nextQuizQuestion(), 2500);
    }
  }, delay);
}

function finishQuiz(){
  if (!game.quiz) return;
  const isLightning = game.quiz.isLightning;
  const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score }));
  game.lastGame = isLightning ? 'lightning' : 'quiz';
  accumulateSessionScores();
  game.phase = 'end';
  game.quiz = null;
  broadcast();
  recordScores(isLightning ? 'lightning' : 'quiz', players);
}

// ==================== Voting ====================
function startVoting(){
  const pool = [...MOST_LIKELY, ...game.customMostLikely];
  game.vote = {
    prompt: rand(pool),
    votes: new Map(),
    revealResults: false,
    results: null
  };
  game.phase = 'voting';
  broadcast();
}
function nextVote(){
  const pool = [...MOST_LIKELY, ...game.customMostLikely];
  game.vote = { prompt: rand(pool), votes: new Map(), revealResults: false, results: null };
  game.phase = 'voting';
  broadcast();
}
function revealVote(){
  if (!game.vote) return;
  const counts = new Map();
  for (const t of game.vote.votes.values()){
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const results = [];
  for (const p of game.players.values()){
    results.push({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, votes: counts.get(p.id) || 0 });
  }
  results.sort((a,b) => b.votes - a.votes);
  game.vote.results = results;
  game.vote.revealResults = true;
  game.phase = 'vote-result';
  broadcast();
}

// ==================== Scatter ====================
function startScatter(){
  const letter = rand(SCATTERGORIES.letters);
  const categories = rand(SCATTERGORIES.categorySets);
  game.scatter = {
    letter, categories: categories.slice(),
    deadline: Date.now() + game.config.scattertime * 1000,
    entries: new Map(),
    review: null,
    timer: null
  };
  game.phase = 'scatter-play';
  broadcast();
  game.scatter.timer = setTimeout(() => endScatter(), game.config.scattertime * 1000 + 100);
}
function endScatter(){
  if (!game.scatter) return;
  if (game.scatter.timer){ clearTimeout(game.scatter.timer); game.scatter.timer = null; }
  // Tell opp: for hver kategori, finn ord. Unikt = 100, delt = 50. Tomt/ugyldig = 0.
  const cats = game.scatter.categories;
  const review = cats.map(() => []);
  for (const [pid, entry] of game.scatter.entries){
    const p = game.players.get(pid);
    for (let i=0;i<cats.length;i++){
      const word = (entry[i] || '').trim();
      if (!word) continue;
      if (word[0].toLowerCase() !== game.scatter.letter.toLowerCase()) continue;
      review[i].push({ pid, name: p?.name || '?', word, points: 0 });
    }
  }
  // Count duplicates per category
  for (let i=0;i<cats.length;i++){
    const counts = new Map();
    for (const r of review[i]){
      const key = r.word.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const r of review[i]){
      const k = r.word.toLowerCase();
      r.points = counts.get(k) === 1 ? 100 : 50;
      const p = game.players.get(r.pid);
      if (p) p.score += r.points;
    }
  }
  game.scatter.review = review;
  game.phase = 'scatter-review';
  broadcast();
  // Auto-avslutt etter 25s
  setTimeout(() => {
    if (game.phase === 'scatter-review'){
      const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score }));
      recordScores('scatter', players);
      game.phase = 'end';
      game.scatter = null;
      broadcast();
    }
  }, 25000);
}

// ==================== Lie (2 truths 1 lie) ====================
function startLie(){
  game.lie = {
    stage: 'collect',
    claims: new Map(),
    order: [],
    i: 0,
    current: null,
    votes: new Map(),
    timer: null,
    deadline: 0
  };
  game.phase = 'lie-collect';
  broadcast();
}
function startLiePlay(){
  if (!game.lie) return;
  const order = Array.from(game.lie.claims.keys());
  shuffle(order);
  game.lie.order = order;
  game.lie.i = 0;
  nextLieRound();
}
function nextLieRound(){
  if (!game.lie) return;
  if (game.lie.i >= game.lie.order.length){
    // Done
    const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score }));
    recordScores('lie', players);
    game.phase = 'end';
    game.lie = null;
    broadcast();
    return;
  }
  const pid = game.lie.order[game.lie.i];
  const claim = game.lie.claims.get(pid);
  if (!claim){ game.lie.i++; return nextLieRound(); }
  const p = game.players.get(pid);
  if (!p){ game.lie.i++; return nextLieRound(); }
  game.lie.current = {
    pid, name: p.name, emoji: p.emoji, color: p.color,
    items: claim.items, lieIdx: null // Skjules til reveal
  };
  game.lie.votes = new Map();
  game.lie.stage = 'play';
  game.lie.deadline = Date.now() + game.config.lietime * 1000;
  game.phase = 'lie-play';
  broadcast();
  if (game.lie.timer) clearTimeout(game.lie.timer);
  game.lie.timer = setTimeout(() => revealLie(), game.config.lietime * 1000 + 100);
}
function revealLie(){
  if (!game.lie || !game.lie.current) return;
  const c = game.lie.current;
  const claim = game.lie.claims.get(c.pid);
  if (!claim){ advanceLie(); return; }
  c.lieIdx = claim.lieIdx;
  // Score
  const liar = game.players.get(c.pid);
  let fooled = 0;
  for (const [voterPid, idx] of game.lie.votes){
    const voter = game.players.get(voterPid);
    if (!voter) continue;
    if (idx === claim.lieIdx){
      voter.score += 100;
    } else {
      fooled++;
    }
  }
  if (liar) liar.score += 50 * fooled;
  if (game.config.teams && liar && liar.team){
    // Team gets points too
    for (const p of game.players.values()){
      if (p.team && p.team.name === liar.team.name && p.id !== liar.id){
        // subtle team bonus
      }
    }
  }
  game.lie.stage = 'reveal';
  game.phase = 'lie-reveal';
  broadcast();
}
function advanceLie(){
  if (!game.lie) return;
  if (game.lie.stage === 'play'){
    if (game.lie.timer){ clearTimeout(game.lie.timer); game.lie.timer = null; }
    return revealLie();
  }
  if (game.lie.stage === 'reveal'){
    game.lie.i++;
    return nextLieRound();
  }
  if (game.lie.stage === 'collect'){
    // Tvinge videre hvis host vil
    if (game.lie.claims.size >= 1){
      startLiePlay();
    }
  }
}

// ==================== Icebreaker ====================
function startIcebreaker(){
  const pool = Array.from(game.players.values());
  const target = pool.length ? rand(pool) : null;
  game.icebreaker = {
    prompt: rand(ICEBREAKERS),
    target: target ? { id: target.id, name: target.name, emoji: target.emoji, color: target.color } : null
  };
  game.phase = 'icebreaker';
  broadcast();
}

// ==================== Wheel ====================
function startWheel(){
  game.wheel = { chosen: null };
  game.phase = 'wheel';
  broadcast();
}
function spinWheel(){
  const pool = Array.from(game.players.values());
  if (!pool.length){ broadcast(); return; }
  const target = rand(pool);
  game.wheel = { chosen: { id: target.id, name: target.name, emoji: target.emoji, color: target.color } };
  game.phase = 'wheel';
  broadcast();
}

// ==================== Snake ====================
const SNAKE_COLS = 40;
const SNAKE_ROWS = 25;
const SNAKE_TICK = 140;

function startSnakeCharacterSelect(){
  stopAllTimers();
  const players = Array.from(game.players.values());
  if (players.length === 0){
    game.phase = 'lobby';
    broadcast();
    return;
  }
  game.snakeSelect = {
    chosen: new Map(),
    deadline: Date.now() + 22000,
    timer: null
  };
  game.phase = 'snake-select';
  broadcast();
  game.snakeSelect.timer = setTimeout(() => {
    startSnakeNow();
  }, 22000);
}

function startSnakeNow(){
  if (!game.snakeSelect) return;
  if (game.snakeSelect.timer){ clearTimeout(game.snakeSelect.timer); game.snakeSelect.timer = null; }
  const taken = new Set(game.snakeSelect.chosen.values());
  const available = SNAKE_CHARS.map(c => c.id).filter(id => !taken.has(id));
  for (const p of game.players.values()){
    if (!game.snakeSelect.chosen.has(p.id)){
      const pick = available.shift() || SNAKE_CHARS[Math.floor(Math.random() * SNAKE_CHARS.length)].id;
      game.snakeSelect.chosen.set(p.id, pick);
    }
  }
  startSnake();
}

function startSnake(){
  stopAllTimers();
  const snakes = new Map();
  const players = Array.from(game.players.values());
  const positions = spreadSpawns(players.length, SNAKE_COLS, SNAKE_ROWS, 4);
  players.forEach((p, i) => {
    const pos = positions[i];
    const charId = (game.snakeSelect && game.snakeSelect.chosen.get(p.id)) || SNAKE_CHARS[i % SNAKE_CHARS.length].id;
    snakes.set(p.id, {
      id: p.id,
      name: p.name,
      color: p.color,
      character: charId,
      segs: [{ x: pos.x, y: pos.y }, { x: pos.x, y: pos.y }, { x: pos.x, y: pos.y }],
      dir: pos.dir,
      nextDir: pos.dir,
      alive: true,
      respawnAt: 0,
      growBy: 0,
      teamName: p.team?.name || null
    });
    p.score = 0;
  });
  // Nullstill select etter bruk
  game.snakeSelect = null;
  // Cache karakter-valg for podium-visualisering
  game.lastCharacters = new Map();
  for (const [pid, s] of snakes) game.lastCharacters.set(pid, s.character);
  game.snake = {
    snakes,
    food: spawnFood([], snakes, 8),
    endAt: game.config.snaketime > 0 ? Date.now() + game.config.snaketime * 1000 : 0,
    tickTimer: null
  };
  game.phase = 'countdown';
  broadcast();
  setTimeout(() => {
    if (!game.snake) return;
    game.phase = 'snake';
    broadcast();
    game.snake.tickTimer = setInterval(snakeTick, SNAKE_TICK);
  }, 3000);
}

function endSnake(){
  if (!game.snake) return;
  if (game.snake.tickTimer){ clearInterval(game.snake.tickTimer); game.snake.tickTimer = null; }
  const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score }));
  recordScores('snake', players);
  game.lastGame = 'snake';
  accumulateSessionScores();
  game.phase = 'end';
  game.snake = null;
  broadcast();
}

function snakeTick(){
  if (!game.snake) return;
  const now = Date.now();

  // Timer over?
  if (game.snake.endAt && now >= game.snake.endAt){
    return endSnake();
  }

  // Respawn dead snakes
  for (const s of game.snake.snakes.values()){
    if (!s.alive && s.respawnAt && now >= s.respawnAt){
      const spawn = findFreeSpot(game.snake);
      if (spawn){
        s.segs = [{ x: spawn.x, y: spawn.y }, { x: spawn.x, y: spawn.y }, { x: spawn.x, y: spawn.y }];
        s.dir = spawn.dir; s.nextDir = spawn.dir;
        s.alive = true; s.growBy = 0;
      }
    }
  }

  // Move all heads
  const occupied = new Map(); // key "x:y" -> [snakeIds with body]
  const heads = []; // { id, x, y, len }
  for (const s of game.snake.snakes.values()){
    if (!s.alive) continue;
    // Validate next dir (no reverse 180)
    if (s.nextDir && !isOpposite(s.nextDir, s.dir)){
      s.dir = s.nextDir;
    }
    const h = s.segs[0];
    const d = dirDelta(s.dir);
    const nx = h.x + d.x, ny = h.y + d.y;
    // Wall?
    if (nx < 0 || ny < 0 || nx >= SNAKE_COLS || ny >= SNAKE_ROWS){
      killSnake(s); continue;
    }
    // Tentatively advance
    s.segs.unshift({ x: nx, y: ny });
    // Food?
    const foodIdx = game.snake.food.findIndex(f => f.x === nx && f.y === ny);
    if (foodIdx >= 0){
      const food = game.snake.food[foodIdx];
      game.snake.food.splice(foodIdx, 1);
      const p = game.players.get(s.id);
      game.matchStats.apples.set(s.id, (game.matchStats.apples.get(s.id) || 0) + 1);
      // Effekter basert på food-type
      if (food.type === 'gold'){
        // Gull-eple: +100 poeng, ingen vekst
        if (p) p.score += 100;
        io.emit('snake:food-fx', { x: nx, y: ny, type: 'gold', pid: s.id });
      } else if (food.type === 'mega'){
        // Mega-eple: +3 segmenter, +30 poeng
        s.growBy += 3;
        if (p) p.score += 30;
        io.emit('snake:food-fx', { x: nx, y: ny, type: 'mega', pid: s.id });
      } else {
        // Normal: +10 poeng, +1 segment
        s.growBy += 1;
        if (p) p.score += 10;
      }
    }
    if (s.growBy > 0){
      s.growBy--;
    } else {
      s.segs.pop();
    }
    // Track biggest snake length
    const prevMax = game.matchStats.biggestSnake.get(s.id) || 0;
    if (s.segs.length > prevMax) game.matchStats.biggestSnake.set(s.id, s.segs.length);
    // Milestone-feiring: hver 10 segments passert → send milestone-event
    const prevLen = prevMax;
    const newLen = s.segs.length;
    if (Math.floor(newLen / 10) > Math.floor(prevLen / 10) && newLen >= 10){
      const p = game.players.get(s.id);
      io.emit('snake:milestone', {
        id: s.id,
        name: p?.name || '?',
        length: newLen,
        label: newLen >= 50 ? 'LEGENDE!' : newLen >= 30 ? 'EPISK!' : 'LANG!'
      });
      // Bonus-poeng
      if (p) p.score += 30;
    }
    heads.push({ id: s.id, x: nx, y: ny, len: s.segs.length });
  }

  // Collisions
  // 1) own body
  for (const s of game.snake.snakes.values()){
    if (!s.alive) continue;
    const h = s.segs[0];
    for (let i=1;i<s.segs.length;i++){
      if (s.segs[i].x === h.x && s.segs[i].y === h.y){
        killSnake(s); break;
      }
    }
  }
  // 2) head-to-head and head-to-body
  const headMap = new Map(); // "x:y" -> [head]
  for (const s of game.snake.snakes.values()){
    if (!s.alive) continue;
    const k = s.segs[0].x + ':' + s.segs[0].y;
    if (!headMap.has(k)) headMap.set(k, []);
    headMap.get(k).push(s);
  }
  // Head-to-head
  for (const [k, arr] of headMap){
    if (arr.length < 2) continue;
    const maxLen = Math.max(...arr.map(s => s.segs.length));
    const winners = arr.filter(s => s.segs.length === maxLen);
    if (winners.length === arr.length){
      // All same length: all die
      for (const s of arr) killSnake(s);
    } else {
      // Longest survives. He eats all shorter
      const winner = winners[0];
      let eaten = 0, totalLen = 0;
      for (const s of arr){
        if (s === winner) continue;
        totalLen += s.segs.length;
        killSnake(s);
        eaten++;
      }
      const grow = Math.min(50 - winner.segs.length, totalLen);
      if (grow > 0) winner.growBy += grow;
      const bonus = 20 + totalLen * 3;
      const p = game.players.get(winner.id); if (p) p.score += bonus;
    }
  }
  // Head-to-body
  const bodyMap = new Map(); // "x:y" -> snakeId (for non-head body)
  for (const s of game.snake.snakes.values()){
    if (!s.alive) continue;
    for (let i=1;i<s.segs.length;i++){
      bodyMap.set(s.segs[i].x + ':' + s.segs[i].y, s);
    }
  }
  for (const s of game.snake.snakes.values()){
    if (!s.alive) continue;
    const k = s.segs[0].x + ':' + s.segs[0].y;
    const victim = bodyMap.get(k);
    if (victim && victim !== s){
      if (s.segs.length > victim.segs.length){
        // Attacker wins
        const grow = Math.min(50 - s.segs.length, victim.segs.length);
        if (grow > 0) s.growBy += grow;
        const p = game.players.get(s.id); if (p) p.score += 20 + victim.segs.length * 3;
        killSnake(victim);
      } else if (s.segs.length < victim.segs.length){
        killSnake(s);
      } else {
        killSnake(s); killSnake(victim);
      }
    }
  }

  // Replenish food
  while (game.snake.food.length < 8){
    const f = randomEmptyCell(game.snake);
    if (!f) break;
    f.type = rollFoodType();
    game.snake.food.push(f);
  }

  // Broadcast tick
  const snakeState = buildSnakeState();
  io.emit('snake:tick', snakeState);

  // All dead -> end
  const alive = Array.from(game.snake.snakes.values()).filter(s => s.alive);
  if (alive.length === 0 && game.snake.snakes.size > 0){
    // Pause — wait respawn
  }
}

function killSnake(s){
  if (!s.alive) return;
  s.alive = false;
  s.respawnAt = Date.now() + 3000;
  s.segs = [];
}

function buildSnakeState(){
  if (!game.snake) return { snakes: [], food: [] };
  return {
    snakes: Array.from(game.snake.snakes.values()).map(s => ({
      id: s.id, name: s.name, color: s.color, alive: s.alive,
      character: s.character,
      dir: s.dir,
      segs: s.segs.slice(0, 60),
      len: s.segs.length
    })),
    food: game.snake.food.slice(),
    score: Array.from(game.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a,b)=>b.score-a.score).slice(0, 20),
    endAt: game.snake.endAt
  };
}

function isOpposite(a, b){
  return (a==='up'&&b==='down')||(a==='down'&&b==='up')||(a==='left'&&b==='right')||(a==='right'&&b==='left');
}
function dirDelta(d){
  switch(d){
    case 'up': return { x: 0, y: -1 };
    case 'down': return { x: 0, y: 1 };
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
  }
  return { x: 0, y: 0 };
}

function spreadSpawns(n, W, H, pad){
  const pts = [];
  for (let i=0;i<n;i++){
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const cx = W/2, cy = H/2;
    const r = Math.min(W,H)/2 - pad - 1;
    const x = Math.max(1, Math.min(W-2, Math.round(cx + Math.cos(a) * r)));
    const y = Math.max(1, Math.min(H-2, Math.round(cy + Math.sin(a) * r)));
    const dirs = ['up','down','left','right'];
    pts.push({ x, y, dir: dirs[i % 4] });
  }
  return pts;
}

function findFreeSpot(sn){
  for (let tries = 0; tries < 50; tries++){
    const x = 1 + ((Math.random() * (SNAKE_COLS - 2)) | 0);
    const y = 1 + ((Math.random() * (SNAKE_ROWS - 2)) | 0);
    let ok = true;
    for (const s of sn.snakes.values()){
      for (const seg of s.segs){ if (seg.x === x && seg.y === y){ ok = false; break; } }
      if (!ok) break;
    }
    if (ok){
      return { x, y, dir: ['up','down','left','right'][(Math.random()*4)|0] };
    }
  }
  return null;
}

function randomEmptyCell(sn){
  for (let tries=0; tries<50; tries++){
    const x = (Math.random() * SNAKE_COLS) | 0;
    const y = (Math.random() * SNAKE_ROWS) | 0;
    let ok = true;
    for (const s of sn.snakes.values()){
      for (const seg of s.segs){ if (seg.x === x && seg.y === y){ ok = false; break; } }
      if (!ok) break;
    }
    for (const f of sn.food){ if (f.x === x && f.y === y){ ok = false; break; } }
    if (ok) return { x, y };
  }
  return null;
}

function rollFoodType(){
  const r = Math.random();
  if (r < 0.08) return 'gold';      // 8% gull-eple (+100p, ingen vekst)
  if (r < 0.16) return 'mega';      // 8% mega-eple (+3 segmenter, +30p)
  return 'normal';                  // 84% normal (+10p, +1 seg)
}

function spawnFood(existing, snakes, count){
  const arr = existing.slice();
  const sn = { snakes, food: arr };
  for (let i=0;i<count;i++){
    const c = randomEmptyCell(sn);
    if (c){
      c.type = rollFoodType();
      arr.push(c);
    }
  }
  return arr;
}

// ==================== Bomberman ====================
const BOMB_COLS = 25;
const BOMB_ROWS = 15;
const BOMB_TICK = 220;
const BOMB_FUSE_TICKS = Math.round(2800 / BOMB_TICK);

function startBombCharacterSelect(){
  stopAllTimers();
  const players = Array.from(game.players.values());
  if (players.length === 0){
    // ingen spillere — gå direkte tilbake til lobby
    game.phase = 'lobby';
    broadcast();
    return;
  }
  game.bombSelect = {
    chosen: new Map(),       // pid -> charId
    deadline: Date.now() + 22000,
    timer: null
  };
  game.phase = 'bomb-select';
  broadcast();
  // Auto-start etter 22 sek: de som ikke har valgt får tildelt ledig karakter
  game.bombSelect.timer = setTimeout(() => {
    startBombermanNow();
  }, 22000);
}

function startBombermanNow(){
  if (!game.bombSelect) return;
  if (game.bombSelect.timer){ clearTimeout(game.bombSelect.timer); game.bombSelect.timer = null; }
  // Tildel gjenstående spillere en ledig karakter
  const taken = new Set(game.bombSelect.chosen.values());
  const available = BOMB_CHARS.map(c => c.id).filter(id => !taken.has(id));
  for (const p of game.players.values()){
    if (!game.bombSelect.chosen.has(p.id)){
      const pick = available.shift() || BOMB_CHARS[Math.floor(Math.random() * BOMB_CHARS.length)].id;
      game.bombSelect.chosen.set(p.id, pick);
    }
  }
  startBomberman();
}

function startBomberman(){
  stopAllTimers();
  // Build map: hard walls in grid pattern, soft walls randomly
  const hard = [];
  const soft = [];
  for (let x=0;x<BOMB_COLS;x++){
    for (let y=0;y<BOMB_ROWS;y++){
      if (x===0 || y===0 || x===BOMB_COLS-1 || y===BOMB_ROWS-1){
        hard.push([x,y]);
      } else if (x%2===0 && y%2===0){
        hard.push([x,y]);
      }
    }
  }
  const hardSet = new Set(hard.map(c => c[0]+':'+c[1]));

  const players = Array.from(game.players.values());
  const spawnCorners = [
    { x: 1, y: 1 }, { x: BOMB_COLS-2, y: BOMB_ROWS-2 },
    { x: BOMB_COLS-2, y: 1 }, { x: 1, y: BOMB_ROWS-2 },
    { x: Math.floor(BOMB_COLS/2), y: 1 }, { x: Math.floor(BOMB_COLS/2), y: BOMB_ROWS-2 },
    { x: 1, y: Math.floor(BOMB_ROWS/2) }, { x: BOMB_COLS-2, y: Math.floor(BOMB_ROWS/2) }
  ];
  const spawnSet = new Set();
  for (const s of spawnCorners){
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++){
      spawnSet.add((s.x+dx)+':'+(s.y+dy));
    }
  }
  // Soft walls at 70% of remaining cells
  for (let x=1; x<BOMB_COLS-1; x++){
    for (let y=1; y<BOMB_ROWS-1; y++){
      if (hardSet.has(x+':'+y)) continue;
      if (spawnSet.has(x+':'+y)) continue;
      if (Math.random() < 0.7) soft.push([x,y]);
    }
  }

  const bombPlayers = new Map();
  players.forEach((p, i) => {
    const sp = spawnCorners[i % spawnCorners.length];
    const charId = (game.bombSelect && game.bombSelect.chosen.get(p.id)) || BOMB_CHARS[i % BOMB_CHARS.length].id;
    bombPlayers.set(p.id, {
      id: p.id, name: p.name, color: p.color,
      character: charId,
      x: sp.x, y: sp.y,
      alive: true, score: 0, kills: 0,
      dirs: new Set(),
      actionPending: false,
      maxBombs: 1, placedBombs: 0,
      range: 2,
      kick: false, punch: false, remote: false,
      speed: 0,
      laserBomb: false,
      fireBomb: false,
      shield: 1, // start with 1 shield? spec doesn't say — we'll give 0
      invulnerableUntil: Date.now() + 2000,
      respawnAt: 0,
      carrying: null, // bomb object if carrying (punch)
      teamName: p.team?.name || null
    });
    p.score = 0;
  });
  // Clear select-state nå som vi har startet
  game.bombSelect = null;
  // Cache karakter-valg for podium-visualisering senere
  game.lastCharacters = new Map();
  for (const [pid, bp] of bombPlayers) game.lastCharacters.set(pid, bp.character);
  // Spec says start: just player with no shield. Actually we start with 0 shields. Clear shield:
  for (const bp of bombPlayers.values()) bp.shield = 0;

  game.bomb = {
    players: bombPlayers,
    bombs: new Map(),
    bombIdSeq: 1,
    hard, soft,
    hardSet,
    softSet: new Set(soft.map(c => c[0]+':'+c[1])),
    powerups: [],  // { x, y, kind }
    powerupsMap: new Map(),
    tickTimer: null,
    endAt: game.config.bombtime > 0 ? Date.now() + game.config.bombtime * 1000 : 0,
    lastExplosions: [],
    lastKills: []
  };
  game.phase = 'countdown';
  broadcast();
  io.emit('bomb:init', {
    cols: BOMB_COLS, rows: BOMB_ROWS,
    hard, soft
  });
  setTimeout(() => {
    if (!game.bomb) return;
    game.phase = 'bomb';
    broadcast();
    game.bomb.tickTimer = setInterval(bombTick, BOMB_TICK);
  }, 3000);
}

function endBomberman(){
  if (!game.bomb) return;
  if (game.bomb.tickTimer){ clearInterval(game.bomb.tickTimer); game.bomb.tickTimer = null; }
  // Last survivor bonus
  const alive = Array.from(game.bomb.players.values()).filter(p => p.alive);
  if (alive.length === 1){
    const p = game.players.get(alive[0].id); if (p) p.score += 200;
    game.matchStats.survived.set(alive[0].id, (game.matchStats.survived.get(alive[0].id) || 0) + 1);
  }
  const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score }));
  recordScores('bomb', players);
  game.lastGame = 'bomb';
  accumulateSessionScores();
  game.phase = 'end';
  game.bomb = null;
  broadcast();
}

function bombTick(){
  if (!game.bomb) return;
  const now = Date.now();

  if (game.bomb.endAt && now >= game.bomb.endAt){
    return endBomberman();
  }

  // Respawn
  for (const p of game.bomb.players.values()){
    if (!p.alive && p.respawnAt && now >= p.respawnAt){
      const sp = findFreeBombSpot();
      if (sp){
        p.x = sp.x; p.y = sp.y;
        p.alive = true;
        p.shield = 1;
        p.invulnerableUntil = now + 1500;
        p.placedBombs = 0;
        p.dirs = new Set();
      }
    }
  }

  // Move players (1 step per tick)
  for (const p of game.bomb.players.values()){
    if (!p.alive) continue;

    // Action FØR bevegelse — så bomben plasseres der spilleren faktisk står
    // visuelt akkurat nå (før tick-move). Dette fikser "bomba plasseres rart etter bevegelse"
    if (p.actionPending){
      p.actionPending = false;
      handleBombAction(p);
    }

    let dx = 0, dy = 0;
    if (p.dirs.has('left')) dx -= 1;
    if (p.dirs.has('right')) dx += 1;
    if (p.dirs.has('up')) dy -= 1;
    if (p.dirs.has('down')) dy += 1;
    // Cap to 1 per axis (no multi-step)
    const doMove = () => {
      if (dx !== 0 && dy !== 0){
        if (canPass(p.x + dx, p.y, p) && canPass(p.x, p.y + dy, p)){
          tryMoveBomb(p, dx, dy);
        } else if (canPass(p.x + dx, p.y, p)){
          tryMoveBomb(p, dx, 0);
        } else if (canPass(p.x, p.y + dy, p)){
          tryMoveBomb(p, 0, dy);
        }
      } else if (dx !== 0 || dy !== 0){
        tryMoveBomb(p, dx, dy);
      }
    };
    doMove();
    // Speed — stackable ekstra-flytt i samme tick
    if (p.speed > 0 && (dx !== 0 || dy !== 0)){
      const extraProb = Math.min(0.85, p.speed * 0.2);
      if (Math.random() < extraProb){
        doMove();
      }
    }
  }

  // Update bombs (fuse, kicked motion, carried)
  const explodeQueue = [];
  for (const b of game.bomb.bombs.values()){
    if (b.exploded) continue;
    // Kicked motion: slide 1 per tick in kickedDir until blocked
    if (b.kickedDir){
      const d = dirDelta(b.kickedDir);
      const nx = b.x + d.x, ny = b.y + d.y;
      if (canBombMoveTo(nx, ny)){
        b.x = nx; b.y = ny;
      } else {
        b.kickedDir = null;
      }
    }
    // Thrown arc: hops 1 per tick; if lands blocked, bounces 1; if still blocked, falls back
    if (b.thrown){
      b.thrown.t--;
      if (b.thrown.t <= 0){
        // Resolve landing
        const tx = b.thrown.tx, ty = b.thrown.ty;
        if (canBombLandAt(tx, ty)){
          b.x = tx; b.y = ty;
        } else {
          // Bounce 1 more
          const d = dirDelta(b.thrown.dir);
          const bx = tx + d.x, by = ty + d.y;
          if (canBombLandAt(bx, by)){
            b.x = bx; b.y = by;
          } else {
            // Fall back to player side
            const fx = tx - d.x, fy = ty - d.y;
            if (canBombLandAt(fx, fy)){ b.x = fx; b.y = fy; }
          }
        }
        b.thrown = null;
      }
    }
    // Remote bombs stay
    if (b.remote){
      // Fuse stays at 999 unless owner detonated (then 0)
      if (b.fuse === 0){
        explodeQueue.push(b);
      }
    } else {
      b.fuse--;
      b.flashing = b.fuse <= 2;
      if (b.fuse <= 0){
        explodeQueue.push(b);
      }
    }
  }

  // Explode bombs (chain)
  const explosions = [];
  const killsThisTick = [];
  while (explodeQueue.length){
    const b = explodeQueue.shift();
    if (b.exploded) continue;
    b.exploded = true;
    const cells = explodeCells(b);
    explosions.push(...cells);
    // Hvis fire-bomb: spawn flammer i nabo-ringer
    if (b.type === 'fire'){
      spawnFireFlames(cells);
    }
    // Refund bomb to owner
    const owner = game.bomb.players.get(b.owner);
    if (owner && owner.placedBombs > 0) owner.placedBombs--;
    // Kill/hit players
    for (const [x,y] of cells){
      for (const p of game.bomb.players.values()){
        if (!p.alive) continue;
        if (p.x === x && p.y === y){
          if (p.invulnerableUntil && Date.now() < p.invulnerableUntil) continue;
          if (p.shield > 0){
            p.shield--;
            p.invulnerableUntil = Date.now() + 1000;
            continue;
          }
          // Kill
          p.alive = false;
          p.respawnAt = Date.now() + 5000;
          killsThisTick.push({ killer: b.owner, victim: p.id, x: p.x, y: p.y, name: p.name });
          const killerPlayer = game.players.get(b.owner);
          if (killerPlayer && b.owner !== p.id){
            killerPlayer.score += 100;
          }
          const killerBP = game.bomb.players.get(b.owner);
          if (killerBP && b.owner !== p.id){
            killerBP.kills++;
            game.matchStats.kills.set(b.owner, (game.matchStats.kills.get(b.owner) || 0) + 1);
          }
        }
      }
      // Break soft walls; maybe drop powerup
      const key = x+':'+y;
      if (game.bomb.softSet.has(key)){
        game.bomb.softSet.delete(key);
        game.bomb.soft = game.bomb.soft.filter(c => !(c[0]===x && c[1]===y));
        if (Math.random() < 0.5){
          // Bruk bombeierens stats for pool-bias
          const owner = game.bomb.players.get(b.owner);
          const kind = rollPowerup(owner);
          if (kind){
            const p = { x, y, kind };
            game.bomb.powerups.push(p);
            game.bomb.powerupsMap.set(key, p);
          }
        }
      }
      // Chain-detonate other bombs
      for (const other of game.bomb.bombs.values()){
        if (other.exploded) continue;
        if (other.x === x && other.y === y){
          if (other.remote){ other.fuse = 0; explodeQueue.push(other); }
          else { other.fuse = 0; explodeQueue.push(other); }
        }
      }
    }
  }

  // Pickup powerups (after movement)
  for (const p of game.bomb.players.values()){
    if (!p.alive) continue;
    const key = p.x+':'+p.y;
    const pu = game.bomb.powerupsMap.get(key);
    if (pu){
      applyPowerup(p, pu.kind);
      game.bomb.powerupsMap.delete(key);
      game.bomb.powerups = game.bomb.powerups.filter(x => x !== pu);
    }
  }

  // Remove exploded bombs
  for (const [id, b] of Array.from(game.bomb.bombs.entries())){
    if (b.exploded) game.bomb.bombs.delete(id);
  }

  // Rydd utløpte flammer + drep spillere som står i dem
  if (game.bomb.flames && game.bomb.flames.length){
    const now = Date.now();
    game.bomb.flames = game.bomb.flames.filter(f => f.until > now);
    // Kollisjons-sjekk
    for (const f of game.bomb.flames){
      for (const p of game.bomb.players.values()){
        if (!p.alive) continue;
        if (p.x === f.x && p.y === f.y){
          if (p.invulnerableUntil && Date.now() < p.invulnerableUntil) continue;
          if (p.shield > 0){ p.shield--; p.invulnerableUntil = Date.now() + 1000; continue; }
          p.alive = false;
          p.respawnAt = Date.now() + 5000;
          killsThisTick.push({ killer: null, victim: p.id, x: p.x, y: p.y, name: p.name, cause: 'flame' });
        }
      }
    }
  }

  // Send updates
  if (explosions.length){
    io.emit('bomb:explosion', { cells: explosions });
  }
  for (const k of killsThisTick){
    io.emit('bomb:kill', k);
  }
  // Combo-kill: hvis >=2 kills samme tick fra SAMME killer → combo-event
  if (killsThisTick.length >= 2){
    const byKiller = new Map();
    for (const k of killsThisTick){
      if (!k.killer) continue;
      byKiller.set(k.killer, (byKiller.get(k.killer) || 0) + 1);
    }
    for (const [killerId, count] of byKiller){
      if (count >= 2){
        const killer = game.players.get(killerId);
        io.emit('bomb:combo', {
          killer: killerId,
          killerName: killer?.name || '?',
          count,
          label: count >= 4 ? 'MEGA DRAP!' : count === 3 ? 'TRIPPEL DRAP!' : 'DOBBELT DRAP!'
        });
        // Bonus-poeng: 50 per kill i combo, +100 for triple/mega
        const bonus = count * 50 + (count >= 3 ? 100 : 0);
        if (killer) killer.score += bonus;
        // Track biggestCombo for match-recap
        if (!game.matchStats.biggestCombo || count > game.matchStats.biggestCombo.count){
          game.matchStats.biggestCombo = {
            pid: killerId,
            name: killer?.name || '?',
            count
          };
        }
      }
    }
  }
  io.emit('bomb:tick', buildBombState());

  // Auto-end: only 1 alive and no respawn timer
  const aliveList = Array.from(game.bomb.players.values()).filter(p => p.alive || p.respawnAt > now);
  if (game.bomb.players.size > 1){
    const reallyAlive = Array.from(game.bomb.players.values()).filter(p => p.alive);
    if (reallyAlive.length <= 1 && game.bomb.endAt === 0){
      // On ∞ mode, wait for respawn
    }
  }
}

function handleBombAction(p){
  // Carrying -> throw
  if (p.carrying){
    throwCarriedBomb(p);
    return;
  }
  // Standing on own bomb + punch -> pick up
  const standingBomb = bombAt(p.x, p.y);
  if (standingBomb && standingBomb.owner === p.id && p.punch){
    game.bomb.bombs.delete(standingBomb.id);
    p.carrying = { id: standingBomb.id, range: standingBomb.range, remote: standingBomb.remote };
    return;
  }
  // Else place bomb
  placeBomb(p);
}

function placeBomb(p){
  if (p.placedBombs >= p.maxBombs) return;
  if (bombAt(p.x, p.y)) return;
  const b = {
    id: game.bomb.bombIdSeq++,
    x: p.x, y: p.y,
    owner: p.id,
    fuse: p.remote ? 999 : BOMB_FUSE_TICKS,
    range: p.range,
    kickedDir: null,
    thrown: null,
    remote: p.remote,
    // Ny: bombe-type basert på aktive flagg
    type: p.fireBomb ? 'fire' : (p.laserBomb ? 'laser' : 'normal'),
    exploded: false,
    flashing: false
  };
  game.bomb.bombs.set(b.id, b);
  p.placedBombs++;
}

function throwCarriedBomb(p){
  // Throw 3 cells in facing direction
  const c = p.carrying;
  p.carrying = null;
  // Pick dir from p.dirs (first active); fallback to last direction faced
  const dirs = Array.from(p.dirs);
  const dir = dirs.length ? dirs[0] : (p.lastDir || 'down');
  const d = dirDelta(dir);
  const tx = p.x + d.x * 3;
  const ty = p.y + d.y * 3;
  const b = {
    id: c.id,
    x: p.x, y: p.y,
    owner: p.id,
    fuse: p.remote ? 999 : BOMB_FUSE_TICKS,
    range: c.range,
    kickedDir: null,
    thrown: { tx, ty, t: 3, dir },
    remote: c.remote,
    exploded: false,
    flashing: false
  };
  game.bomb.bombs.set(b.id, b);
  p.placedBombs++;
}

function bombAt(x, y){
  for (const b of game.bomb.bombs.values()){
    if (!b.exploded && b.x === x && b.y === y) return b;
  }
  return null;
}

function canPass(x, y, p){
  if (x < 0 || y < 0 || x >= BOMB_COLS || y >= BOMB_ROWS) return false;
  const k = x+':'+y;
  if (game.bomb.hardSet.has(k)) return false;
  if (game.bomb.softSet.has(k)) return false;
  // Bomb at cell: if my own bomb I'm standing on, can step off; but entering it:
  const b = bombAt(x, y);
  if (b){
    if (p && p.kick){
      // Kick it — the bomb slides in our direction
      const dx = Math.sign(x - p.x);
      const dy = Math.sign(y - p.y);
      const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
      b.kickedDir = dir;
    }
    return false;
  }
  return true;
}

function canBombMoveTo(x, y){
  if (x < 0 || y < 0 || x >= BOMB_COLS || y >= BOMB_ROWS) return false;
  const k = x+':'+y;
  if (game.bomb.hardSet.has(k)) return false;
  if (game.bomb.softSet.has(k)) return false;
  for (const b of game.bomb.bombs.values()){ if (!b.exploded && b.x === x && b.y === y) return false; }
  for (const p of game.bomb.players.values()){
    if (!p.alive) continue;
    if (p.x === x && p.y === y) return false;
  }
  return true;
}
function canBombLandAt(x, y){
  return canBombMoveTo(x, y);
}

function tryMoveBomb(p, dx, dy){
  const nx = p.x + dx, ny = p.y + dy;
  if (canPass(nx, ny, p)){
    p.x = nx; p.y = ny;
    const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    p.lastDir = dir;
  }
}

function explodeCells(b){
  const cells = [[b.x, b.y]];
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  const isLaser = b.type === 'laser';
  for (const [dx, dy] of dirs){
    // Laser: penetrerer 2 myke treff før den stopper. Normal: 1.
    let softBreaks = 0;
    const maxSoft = isLaser ? 2 : 1;
    for (let i = 1; i <= b.range; i++){
      const x = b.x + dx*i, y = b.y + dy*i;
      const k = x+':'+y;
      if (game.bomb.hardSet.has(k)) break;
      cells.push([x, y]);
      if (game.bomb.softSet.has(k)){
        softBreaks++;
        if (softBreaks >= maxSoft) break;
      }
    }
  }
  return cells;
}

// Flame-propagation for fire-bombs: etter eksplosjon, spawn flammer i
// naboceller (1 ring). Flammer varer 2 ticks og kan infektere én gang.
function spawnFireFlames(cells){
  if (!game.bomb.flames) game.bomb.flames = [];
  const now = Date.now();
  const ttl = 900; // ms
  const seen = new Set();
  for (const [x, y] of cells){
    // 4-nabo + selve celle
    const neighbors = [[0,0], [-1,0], [1,0], [0,-1], [0,1]];
    for (const [dx, dy] of neighbors){
      const nx = x + dx, ny = y + dy;
      const k = nx + ':' + ny;
      if (seen.has(k)) continue;
      seen.add(k);
      if (game.bomb.hardSet.has(k)) continue;
      if (nx < 0 || ny < 0 || nx >= BOMB_COLS || ny >= BOMB_ROWS) continue;
      game.bomb.flames.push({
        x: nx, y: ny,
        until: now + ttl,
        infected: true // forhindrer re-infeksjon
      });
    }
  }
}

// Nye constants for balansering — lavere max for å nå 'taket' raskere
const MAX_BOMBS = 5;        // var 8 — nå når du maks raskere
const MAX_RANGE = 6;        // var 10
const MAX_SHIELDS = 1;      // var 3 — ikke stackable lenger
// speed er fritt stackable (ingen cap)

function rollPowerup(p){
  // Basispool
  const pool = ['bomb','bomb','fire','fire','kick','punch','remote','gold','speed'];
  // Shield tilbys kun hvis du IKKE har det alt
  if (!p || !p.shield || p.shield < MAX_SHIELDS){
    pool.push('shield');
  }
  // Laser/fire er sjeldne drops generelt, men ser større sjanse
  // hvis du har makset bomber eller rekkevidde (brukeren ba om dette)
  if (p && (p.maxBombs >= MAX_BOMBS || p.range >= MAX_RANGE)){
    pool.push('laser', 'laser', 'fire-bomb', 'fire-bomb');
  } else {
    pool.push('laser', 'fire-bomb'); // én hver, sjelden
  }
  return pool[(Math.random()*pool.length)|0];
}

function applyPowerup(p, kind){
  switch(kind){
    case 'bomb': p.maxBombs = Math.min(MAX_BOMBS, p.maxBombs + 1); break;
    case 'fire': p.range = Math.min(MAX_RANGE, p.range + 1); break;
    case 'kick': p.kick = true; break;
    case 'punch': p.punch = true; break;
    case 'remote': p.remote = true; break;
    case 'shield':
      // Ikke stackable — cap på MAX_SHIELDS (1)
      p.shield = Math.min(MAX_SHIELDS, (p.shield || 0) + 1);
      break;
    case 'speed':
      // Stackable: hver speed øker p.speed med 1. Brukes i tick-sjekk
      // for å bestemme om spilleren får ekstra flytt-tick
      p.speed = (p.speed || 0) + 1;
      break;
    case 'laser':
      // Laser-bomb aktivert: fremtidige bomber penetrerer 2 treff
      p.laserBomb = true;
      break;
    case 'fire-bomb':
      // Fire-bomb aktivert: fremtidige bomber spawner flammer i nabo-celler
      p.fireBomb = true;
      break;
    case 'gold': {
      const pl = game.players.get(p.id); if (pl) pl.score += 50;
      break;
    }
  }
}

function findFreeBombSpot(){
  for (let tries=0; tries<80; tries++){
    const x = 1 + ((Math.random() * (BOMB_COLS-2)) | 0);
    const y = 1 + ((Math.random() * (BOMB_ROWS-2)) | 0);
    const k = x+':'+y;
    if (game.bomb.hardSet.has(k)) continue;
    if (game.bomb.softSet.has(k)) continue;
    let ok = true;
    for (const p of game.bomb.players.values()){
      if (p.alive && p.x === x && p.y === y){ ok = false; break; }
    }
    if (ok) return { x, y };
  }
  return null;
}

function buildBombState(){
  if (!game.bomb) return null;
  return {
    players: Array.from(game.bomb.players.values()).map(p => ({
      id: p.id, name: p.name, color: p.color,
      character: p.character,
      x: p.x, y: p.y, alive: p.alive,
      shield: p.shield, invulnerableUntil: p.invulnerableUntil,
      kills: p.kills,
      maxBombs: p.maxBombs, range: p.range,
      kick: p.kick, punch: p.punch, remote: p.remote,
      speed: p.speed || 0,
      laserBomb: !!p.laserBomb,
      fireBomb: !!p.fireBomb,
      carrying: !!p.carrying
    })),
    bombs: Array.from(game.bomb.bombs.values()).map(b => ({
      id: b.id, x: b.x, y: b.y, owner: b.owner, flashing: b.flashing, remote: b.remote,
      type: b.type || 'normal',
      fuseLeft: b.remote ? null : b.fuse,
      fuseTotal: BOMB_FUSE_TICKS
    })),
    flames: (game.bomb.flames || []).map(f => ({ x: f.x, y: f.y, until: f.until })),
    powerups: game.bomb.powerups.slice(),
    soft: game.bomb.soft,
    endAt: game.bomb.endAt
  };
}

// ==================== Start server ====================
server.listen(PORT, () => {
  console.log(`Avdelingsshow lytter på http://localhost:${PORT}`);
  console.log(`Host-passord: ${HOST_PASSWORD}`);
});
