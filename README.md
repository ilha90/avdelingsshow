# Avdelingsshow

Live multiplayer quiz/show for avdelingssamlinger — host på storskjerm, spillere kobler seg på fra mobil.

## Kjør lokalt

```bash
npm install
npm start
```

Åpne `http://localhost:3000/host` på vert-PCen, og `http://<din-IP>:3000` på mobiler.

## Spillmoduser

- 🧠 **Quiz**: Generelt, Norge, DNB, Pop-kultur, Emoji — 250+ spørsmål totalt
- ⚡ **Lyn-runde**: 5 sek per spørsmål, dobbel poeng
- 🗳️ **Hvem er mest sannsynlig**: anonym avstemning
- 📝 **Kategori-kamp**: bokstav + 5 kategorier, 60 sek
- 💬 **Bli-kjent-kort**: trekk tilfeldig spørsmål til tilfeldig spiller
- 🎡 **Lykkehjul**: trekker én av spillerne
- 🪄 **Egendefinert AI-quiz**: generer spørsmål om hvilket som helst tema (BYOK)

## Deploy

Lokal Node.js-server (Socket.io) — deploy til Render/Railway/Fly.io.
Se `render.yaml` for Render-konfig.

Krav: Node 18+
