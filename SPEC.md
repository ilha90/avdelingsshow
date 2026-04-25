# Avdelingsshow — Kravspesifikasjon

Dette dokumentet beskriver sluttproduktet. Bruk det til å bygge hele prosjektet fra
bunnen av i en fersk session.

## 1. Hva er dette?

En web-basert **live multiplayer show-plattform** til avdelingssamlinger på jobb.
Én vert kjører storskjerm (PC/projektor) som viser `/host`. Spillere kobler seg på
med telefon (QR-kode eller kort URL) og spiller i samme runde.

**Brukssituasjon:** 10-40 ansatte sitter i et rom. Vert åpner `/host`, deltakere skanner
QR-kode og spiller sammen. Showet varer 30-90 minutter med forskjellige spill imellom.

**Deploy:** Render (gratis-tier, HTTPS). Serveren er én Node-prosess, data er i
minnet + én JSON-fil for historikk.

## 2. Tech-stack

- **Server:** Node.js 20+ (ESM), Express 4, Socket.io 4, QRCode-lib
- **Client:** Ren vanilla JS (ingen bundler), Canvas 2D for quiz/voting, Three.js 0.161
  for 3D (snake/bomberman) via ESM importmap fra unpkg
- **Styling:** Én `style.css` med CSS custom properties + animasjoner
- **Persistens:** `scores.json` på disk (ephemeral på Render, resetter ved redeploy)

Pakker: `express`, `socket.io`, `qrcode`. Ingen build-step.

## 3. Ruter og oppsett

- `GET /host` → `host.html` — storskjerm (passord-beskyttet)
- `GET /` → `player.html` — spiller-UI
- `GET /qr` → QR-bilde (PNG) som peker til `/`
- `GET /connect-url` → JSON `{ url }` med public URL
- `GET /scores?game=all|quiz|lightning|snake|bomb|scatter|lie` → topp 100
- `GET /favicon.ico` → SVG-bombe

Socket.io over `/socket.io`. HTML/JS/CSS serveres med `Cache-Control: no-cache`
for å unngå stale kode hos brukere.

Host-passord: `process.env.HOST_PASSWORD || 'dnb'`. Klient lagrer i sessionStorage.
Serveren validerer `host:hello`-eventet.

## 4. Filstruktur

```
server.js                    Game-state, socket handlers, API
public/
  host.html                  Host entry-point (importmap for three)
  player.html                Player entry-point (importmap for three)
  style.css                  All styling
  host.js                    Host-UI + rendering + socket-handlers
  player.js                  Spiller-UI + socket-handlers
  bomb3d.js                  Three.js Bomberman-scene
  snake3d.js                 Three.js Snake-scene
  data.js                    Quiz-spørsmål, kategorier, prompts (eksporterte konstanter)
  sound.js                   Web Audio-lyder (sfx)
  confetti.js                Confetti-canvas effekt
  ai.js                      (Valgfri) AI-generering av quiz via OpenAI API
  avatars.js                 Deterministisk emoji/farge basert på navn
scores.json                  Persisterte score-data (gitignored)
package.json                 "type": "module", start: node server.js
README.md                    Kort beskrivelse
render.yaml                  Render deploy-konfig
```

## 5. Spillmoduser

9 spill. Host velger i meny, server har en `game.phase`-statemaskin.

### 5.1 Quiz (🧠)
- 5 kategorier: generelt, norge, dnb, popkultur, emoji-gåter
- Spørsmål har 4 svaralternativer, én korrekt
- Standard: 10 spørsmål per runde, 20s per spørsmål
- Konfigurerbart: 5/8/10/12/15/20 spørsmål, 10/15/20/30s tid
- Tidsbonus: flere poeng for raskt svar
- Trofeer: ⚡ første ute, 🔥 streak (3/5/7+), 💯 alle riktig
- Leaderboard hver N spørsmål (konfig: av / hver 3 / 5 / 10)

### 5.2 Lyn-runde (⚡)
- Samme som quiz men tiden per spørsmål er konfigurerbar (3-15s, default 5s)
- Dobbel poeng
- Maks 12 spørsmål per runde
- Egen "start-lightning" handler

### 5.3 Hvem er mest sannsynlig (🗳️)
- Anonym avstemning
- Prompt fra `MOST_LIKELY`-liste + AI-genererte prompts
- Host viser prompt, spillere stemmer på en spiller
- Resultat viser hvem som fikk flest stemmer
- "Neste runde"-knapp for host

### 5.4 Kategori-kamp (📝)
- Scattergories-stil
- Tilfeldig bokstav + 5 kategorier
- Konfigurerbar tid (30-180s, default 60s)
- Unike ord = 100 poeng, delte ord = 50 poeng
- Host-gjennomgang på slutt

### 5.5 2 sannheter, 1 løgn (🤥)
- 3-fase spill: collect → play → reveal
- Hver spiller sender inn 3 påstander + markerer hvilken som er løgn
- Én og én spiller får sine påstander vist, andre stemmer
- Stemmetid: 15-90s (default 30s)
- +100 for korrekt gjetning, +50 per lurte spiller til løgneren
- Lag-modus: poeng går også til laget

### 5.6 Bli-kjent-kort (💬)
- Trekker prompt fra `ICEBREAKERS` + tilfeldig spiller
- Ingen tid / scoring — bare samtale
- "Neste kort"-knapp for host

### 5.7 Lykkehjulet (🎡)
- Trekker tilfeldig spiller fra listen
- Host klikker for å snurre

### 5.8 Slange-kamp (🐍) — 3D
- Grid 40×25, tick 140ms
- Alle spillere er slanger samtidig (alle mot alle)
- Matbobler gir +10 poeng og +1 segment
- **Regler for kollisjon (størst spiser minst):**
  - Head-to-head: lengste slange spiser alle kortere. Uavgjort = alle dør.
  - Head-to-body: større angriper spiser forsvareren. Mindre angriper dør. Uavgjort = begge dør.
  - Vegg / egen kropp: dør alene (ingen bonus)
- Vinner vokser med ofrets lengde (cap 50 segmenter), +20 base + 3 per segment
- Respawn 3s etter død
- Konfigurerbar varighet 30-240s + ∞-modus
- Lag-modus støttet

### 5.9 Bomberman (💣) — 3D
- Grid 25×15, tick 220ms
- Alle spillere starter i hvert sitt hjørne
- **Myke vegger** (trekasser) kan sprenges. **Harde vegger** (murstein) kan ikke.
- Powerups fra 50% av knuste myke vegger:
  - 💣 +1 maks bomber (cap 8)
  - 🔥 +1 rekkevidde (cap 10)
  - 👟 **Kick** — gå inn i egen/annens bombe → den glir i retningen din til blokkert
  - 🥊 **Punch** — plukk opp og kast bomber
  - 📡 **Remote** — dine bomber detonerer ikke auto; detoner med 💥-knapp
  - 🛡️ Shield — én treff-beskyttelse + 1s grace
  - ⭐ Gold — +50 poeng
  - ⚡ Speed — **IKKE flytt til multi-cell per tick** (teleporterer stygt). La den være kosmetisk eller utelat.
- **Unified bombe-knapp** (samme knapp gjør alt):
  - Holder bombe → kast
  - Står på egen bombe + har punch → plukk opp
  - Ellers → legg ny bombe
- **Kast med sprett:** flyr 3 ruter. Blokkert? Sprett 1 rute til. Fortsatt blokkert? Fall tilbake.
- **Ingen corner-cut:** diagonal kun tillatt hvis begge akse-nabo-celler er frie
- Drap: +100 poeng + 1 kill-count
- Siste overlevende: +200 bonus
- Kill-cam på host: kamera zoomer inn på dødsstedet i 2.5s + rød banner
- Screen shake + shockwave-ringer + bloom på eksplosjoner
- Respawn 5s med 1 shield + 1.5s grace
- Konfigurerbar varighet 30-300s + ∞-modus

## 6. Klient-UI — Host

**Lobby (passord-gate først):**
- Brand "Live Avdelingsshow" øverst-venstre med pulserende grønn dot
- Hjelp-knapp (?), fullskjerm-knapp (⛶), lyd-av/på (🔊)
- Fase-tag øverst-høyre (endrer seg med pulse når ny fase)
- Venstre: QR-kode (pulsende glow), URL, lobby-config (lag-modus, spørsmål-antall, tid, tavle-interval)
- Høyre: Spillerliste + 🏆 Topplist-knapp
- Knapp: "🎮 Velg spill" (åpner meny)
- AI-boks: input for å generere egne quiz-spørsmål

**Menu-modal ("Velg spill"):**
- 3 seksjoner: Quiz, Lyn-runde, Sosiale spill
- Hvert kort har ikon, tittel, beskrivelse
- Stagger-in-animasjon (40ms delay mellom kort)
- Hvert tids-basert kort har en ⏱-chip øverst-høyre som cycler varighet
- Lyn-runde-header viser "X sek, dobbel poeng" basert på lightningDuration

**Tutorial (før hvert spill, 5.5s):**
- Stort emoji-ikon (quiz=🧠, bomb=💣, etc)
- Gradient-gylden tekst med regler
- Progress-bar fyller over tid
- Mascot leser teksten via speech bubble
- Host kan hoppe over: Enter / Space / "Hopp over →"-knapp

**Quiz-visning:**
- Countdown med eksplosiv entrance-animasjon (3→2→1→GO)
- Spørsmål i stor tekst, 4 fargekodede alternativer (A B C D)
- Timer-bar som tømmes
- Svar-teller ("X / Y har svart")

**Spill-visning (bomb/snake):**
- Fullbleed canvas (position: absolute, inset 0)
- Topp-overlay: tittel + timer (bg gradient fade)
- Høyre-overlay: score-panel (backdrop-blur)
- Bunn: host-kontroller ("Avslutt runde", "Ny runde", etc)

**Kill-banner (bomberman):**
- "💀 Navn ble sprengt 💣" fader inn på top med rød glow 2.2s

**End-screen:**
- Podium 🥇🥈🥉 som reiser seg med bounce
- Runde-stats under: antall spillere, total kills/lengste, total poeng

**Maskot (alltid synlig):**
- Grønn karakter med øyne + munn + 🎤 mikrofon + antenne
- Rusler mellom 4 hjørnesoner hvert 5-9s (aldri sentrum)
- `speaking` class gjør ham mer animert + vise speech bubble
- `celebrating` class ved trofé (hopper + 🎉 popper ut)
- Leser tutorial-tekst + trofé-tekst visuelt i bubble (ingen ekte TTS)

**Animerte backgrounds:**
- Animert gradient-bg (24s loop) + 6 partikkel-lag (60s parallax) + stjerne-blink
- Brand-tittel har shine-effekt som glir over
- Alle knapper har shimmer på hover
- Phase-change gir soft fade

## 7. Klient-UI — Spiller

**Login:**
- Stor "Avdelingsshow"-tittel (gradient)
- Avatar-plukker (28 emojier i 7-kolonne grid, ingen overflow-cut)
- Navneinput + "Bli med"-knapp
- Ved reconnect: auto-join med lagret navn

**Lobby-venting:**
- Grønn "Du er med!"-skjerm
- Navnet ditt med fargen din
- Lagmedlemskap vises hvis lag-modus

**Tutorial (når host setter phase=tutorial):**
- Stort ikon + forklarings-tekst
- "Starter snart…"

**Quiz:**
- Spørsmålsteksten (stor) + 4 svar-knapper (A/B/C/D farget)
- Etter svar: "Sendt ✓" + "Venter på andre..."
- Reveal: vis om du svarte rett/feil + poeng-delta

**Bomberman-visning (fullbleed):**
- Canvas fyller skjermen
- Kompakt header øverst: score + powerup-ikoner (💣× · 🔥 · 👟 · 🥊 · 📡 · 🛡️)
- Venstre bunn: Joystick (170px sirkel, 60px thumb, 22% deadzone)
- Høyre bunn: **💣 bombe-knapp** (120px)
  - Ikonet endres: 💣 (legg) → 🤲 (plukk opp mulig) → 🫳 (kaster)
  - 💥-knapp vises over når spilleren har Remote-powerup
- Zoom-knapper øverst-høyre (＋/−)
  - <1.4 = follow-kamera (zoomet inn)
  - ≥1.4 = overview (samme som host)

**Snake-visning (fullbleed):**
- Canvas fyller skjermen (overview, aldri follow)
- Header som bomb
- Pilknapper-pad: **display:none på PC** (brukere har piltaster/WASD).
  På mobil vises pad nederst-høyre.
- Swipe-støtte på hele skjermen

**Landskapsmodus:**
- Automatisk — canvas fyller viewport i begge orienteringer
- Kontrollene er fixed-overlays

**Kontrollhåndtering:**
- Multi-touch via Pointer Events + setPointerCapture
- Joystick: track 1 pointer, compute dx/dy, angle gir up/down/left/right-flags
- Kan holde flere pad-knapper samtidig (diagonale bevegelser)
- Keyboard: WASD + piltaster, multipile keys = diagonal
- Space/B = bombe-handling

**Reaction-bar (voting/icebreaker/slutt):**
- 6 emoji-knapper som fyrer floater-animasjoner på host

## 8. Server state-maskin

```
phase: 'lobby' | 'tutorial' | 'countdown' | 'question' | 'reveal' | 'leaderboard'
     | 'wheel' | 'voting' | 'vote-result' | 'scatter-play' | 'scatter-review'
     | 'icebreaker' | 'snake' | 'snake-end' | 'bomb' | 'bomb-end'
     | 'lie-collect' | 'lie-play' | 'lie-reveal' | 'end'
```

**Transisjoner:**
- `host:start-X` (fra lobby) → `tutorial` → (5.5s) → spilleroppstart
- Quiz: countdown → question → reveal → leaderboard → countdown (neste) → end
- Bomb/Snake: 3s countdown (grid + spillere rendret) → faktisk spill → end
- Lie: collect (alle sender inn) → play (en og en) × N → reveal per spiller → leaderboard → end

**Scoreboard:**
- `game.players[pid].score` akkumuleres per spill-runde
- Ved runde-slutt: `recordScores(gameType, playerList)` lagrer til scores.json hvis ≥4 spillere

**Broadcast:**
- Hver state-endring: `broadcast()` sender publicState() til alle
- High-frequency spill (snake/bomb): egne tick-handlers sender `snake:tick` / `bomb:tick`

## 9. Viktige implementasjons-detaljer

**Multi-touch (Bomberman joystick):**
```js
// Bruk Set<dir> med pointer capture. Ikke pointerleave (forsvinn når glider).
// Joystick: lagre pointerId på down, track move, tøm på up/cancel.
```

**Hastighet i Bomberman:**
```js
// ALDRI multi-cell per tick (ser teleporty ut).
// Hvis speed powerup ønskes, ha det som kosmetisk eller ekstra poeng.
const steps = 1;  // Hver spiller beveger seg 1 celle per tick
```

**Corner-cut:**
```js
// Diagonal kun tillatt hvis begge akse-celler er åpne
if (dx !== 0 && dy !== 0) {
  if (canPass(p.x + dx, p.y) && canPass(p.x, p.y + dy)) {
    moved = tryMoveTo(p.x + dx, p.y + dy);
  }
}
```

**Shield:**
```js
// Grace 1s etter absorb så ikke påfølgende ticks av samme eksplosjon dreper
if (p.invulnerableUntil && Date.now() < p.invulnerableUntil) return;
if (p.shield > 0) { p.shield--; p.invulnerableUntil = Date.now() + 1000; return; }
```

**Kast med sprett:**
```js
// 3 ruter, sprett 1 hvis blokkert, fall tilbake til nærmere
// baseX = player.x (ikke bomb.x, siden bomben ligger hos spilleren)
```

**Tutorial-wrapping:**
```js
socket.on('host:start-bomb', () => {
  playTutorialThen('bomb', () => startBomberman());
});
function playTutorialThen(gameType, startFn, ms = 5500) {
  game.phase = 'tutorial';
  game.tutorialGame = gameType;
  game.tutorialText = TUTORIAL_TEXT[gameType];
  game._tutorialNextFn = startFn;
  broadcast();
  setTimeout(() => { if (game.phase === 'tutorial') startFn(); }, ms);
}
```

## 10. Styling & designspråk

- Bakgrunn: mørk teal (#0a1a15) med animert gradient (24s loop)
- Accent: mint (#5de0ae, #00a877) + gold (#d4af37)
- Skygger: subtile, aldri harde
- Typografi: system-font (-apple-system, Segoe UI, Roboto)
- Runde hjørner overalt (12-20px radius)
- Animasjoner: cubic-bezier(.2, 1.4, .3, 1) for bounce-feel
- Stagger-entrance på lister (40-50ms mellom elementer)
- Shimmer-sveip på knapper ved hover
- Alle tilstands-endringer har soft transitions (.2-.3s)

## 11. Kjente fallgruver (IKKE gjør dette)

1. **TTS (speechSynthesis):** Utrolig upålitelig på tvers av nettlesere/OS.
   Droppet — maskoten viser tekst visuelt isteden.
2. **CSS perspective/rotateX på canvas:** Noen nettlesere rendrer svart.
   Bruk 3D via Three.js, ikke CSS transform.
3. **padding: 0 !important på host-main:** Bryter quiz + lobby. Bruk `:has()`.
4. **Multi-cell movement per tick:** Ser teleporty ut, brukere hater det.
   Hold 1 celle/tick alltid.
5. **Static import av three/addons:** Hvis CDN treger, hele host-siden krasjer.
   Bruk dynamisk import med fallback.
6. **express.static case-sensitive på Linux:** `/Host` matcher ikke `/host`.
   Bruk `app.get('/host', ...)` + `app.get('/Host', ...)` hvis nødvendig.
7. **ttsOnState importert men ikke eksportert:** ES module error = hvit skjerm.
8. **Keypress som sender dir-event hver repeat:** Sjekk `if (already in set) return`.
9. **Speed-powerup som gir multi-step:** Ikke gjør det. Spillere hopper over ruter.
10. **Cache på Render:** Server må sende `Cache-Control: no-cache` på HTML/JS/CSS.

## 12. Utviklings-oppsett

```bash
npm install express socket.io qrcode
PORT=3000 node server.js
# Åpne http://localhost:3000 (spiller) og http://localhost:3000/host (vert)
```

Standard test-pipeline:
- Åpne host i ett browser-vindu, trykk gjennom passord
- Åpne 4+ player-vinduer (context-isolerte), join med navn
- Test hvert spill + cleanup

## 13. Data-krav

`public/data.js` skal eksportere:
- `QUIZ_CATEGORIES`: { generelt, norge, dnb, popkultur, emoji } — hver med `{ label, questions: [{q, a: [], c: int, isEmoji?}] }`
- `MOST_LIKELY`: string[] — "til å..."-prompts (minst 50)
- `SCATTERGORIES`: `{ letters: string[], categorySets: [[5 kategorier], ...] }`
- `ICEBREAKERS`: string[] — bli-kjent-prompts
- `TEAM_NAMES`: `[{ name, emoji, color }, ...]` — minst 6 lag

Mål: **300+ quiz-spørsmål totalt**, **70+ most-likely**, **60+ icebreakers**.

## 14. Performance-mål

- Host må takle 40+ tilkoblede spillere
- Three.js rendering ved 60fps på moderne laptop
- Bomb-tick 220ms + Snake-tick 140ms (server)
- Klient interpolerer posisjoner per frame (lerp 0.22)
- Shadow maps 1024px (ikke 2048+ som dreper mobile GPUs)
- Cast shadows kun på spillere og bomber, IKKE på vegger/kasser

## 15. Sikkerhet & sanitering

- Player names: maks 20 tegn, sanitiseres server-side
- Emoji: maks 6 tegn
- Custom quiz-spørsmål: maks 300 tegn per felt
- Host-passord: sessionStorage (ikke localStorage), validert server-side
- AI-endepunkt: bruker-levert API-key via client, aldri server-stored
- Rate limiting: reactions 200ms mellom hver

---

**Bygg dette fra bunnen av. Se `SPEC.md` i prosjektet for referanse.**
