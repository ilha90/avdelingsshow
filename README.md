# Avdelingsshow

Live multiplayer show-plattform for avdelingssamlinger.

## Kom i gang

```bash
npm install
HOST_PASSWORD=dnb node server.js
```

Åpne `http://localhost:3000/host` på storskjerm (passord: `dnb`).
Spillere skanner QR-koden eller åpner `http://localhost:3000/` på telefon.

## Spill

- 🧠 **Quiz** — 5 kategorier, konfigurerbar lengde og tid
- ⚡ **Lyn-runde** — rask quiz med dobbel poeng
- 🗳️ **Hvem er mest sannsynlig** — anonym avstemning
- 📝 **Kategori-kamp** — Scattergories
- 🤥 **2 sannheter, 1 løgn** — spillere lurer hverandre
- 💬 **Bli-kjent-kort** — samtalestartere
- 🎡 **Lykkehjulet** — tilfeldig spiller
- 🐍 **Slange-kamp** — 3D multiplayer Snake
- 💣 **Bomberman** — 3D multiplayer Bomberman

## Deploy

Render (gratis-tier). Se `render.yaml`. Sett `HOST_PASSWORD` som env var.

## Stack

Node 20+, Express 4, Socket.io 4, Three.js 0.161 (via ESM importmap).
Ingen build-step — alt er vanilla JS.

## Se `SPEC.md` for full kravspesifikasjon.
