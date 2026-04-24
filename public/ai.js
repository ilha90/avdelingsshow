// ai.js — generer quiz-spørsmål via OpenAI-kompatibelt API (BYOK)
// Nøkkelen lagres KUN lokalt i nettleseren (localStorage).
// Serveren ser aldri nøkkelen din.

const LS_KEY = 'ai-config';

export function getAiConfig() {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) try { return JSON.parse(saved); } catch {}
  return {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    apiKey: '',
  };
}

export function saveAiConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

export async function generateQuestions({ topic, count = 10, language = 'norsk', tone = 'quiz' } = {}) {
  const cfg = getAiConfig();
  if (!cfg.apiKey) throw new Error('Mangler API-nøkkel');
  if (!topic || !topic.trim()) throw new Error('Du må skrive et tema');

  const systemPrompt = `Du er en quiz-mester som lager engasjerende spørsmål på ${language}. Svar ALLTID med gyldig JSON uten forklaringer, uten markdown, uten kodeblokker.`;
  const userPrompt = `Lag ${count} ${tone === 'emoji' ? 'emoji-gåter' : 'quiz-spørsmål'} på ${language} om temaet: "${topic}".

Krav:
- Hvert spørsmål skal være morsomt, tydelig og presist.
- Eksakt 4 svaralternativer per spørsmål.
- Kun ett korrekt svar (indeks 0–3 i "c").
- Varier vanskelighetsgraden (noen lette, noen vanskelige).
- Distraktorer (gale svar) skal være troverdige, ikke åpenbart tull.
- ${tone === 'emoji' ? 'Spørsmålet "q" skal bestå KUN av 2-4 emojier som tilsammen peker mot svaret (film/bok/uttrykk).' : 'Skriv spørsmålet direkte uten innledning som "Hvilket..." unødvendig. Vær konkret.'}
- Ikke gjenta spørsmål. Ikke still hypotetiske ukjente ting.

Returner EKSAKT dette JSON-formatet:
{
  "title": "kort tittel på quizen",
  "questions": [
    { "q": "spørsmål", "a": ["svar1","svar2","svar3","svar4"], "c": 0 }
  ]
}`;

  return await callAi({ systemPrompt, userPrompt, validate: (parsed) => {
    const qs = parsed.questions || parsed.quiz || [];
    if (!Array.isArray(qs) || !qs.length) throw new Error('AI returnerte ingen spørsmål');
    const cleaned = qs
      .filter(q => q && typeof q.q === 'string' && Array.isArray(q.a) && q.a.length === 4 && typeof q.c === 'number' && q.c >= 0 && q.c <= 3)
      .map(q => ({ q: String(q.q).trim(), a: q.a.map(x => String(x).trim()), c: q.c, isEmoji: tone === 'emoji' }));
    if (!cleaned.length) throw new Error('AI-svaret hadde ikke gyldige spørsmål');
    return { title: parsed.title || topic, questions: cleaned };
  }});
}

export async function generateVotingPrompts({ topic, count = 10, language = 'norsk' } = {}) {
  const cfg = getAiConfig();
  if (!cfg.apiKey) throw new Error('Mangler API-nøkkel');
  if (!topic || !topic.trim()) throw new Error('Du må skrive et tema/gruppe');

  const systemPrompt = `Du lager morsomme og trygge "Hvem er mest sannsynlig til å..."-spørsmål på ${language}. Svar ALLTID med gyldig JSON.`;
  const userPrompt = `Lag ${count} morsomme, lettfattelige "Hvem er mest sannsynlig til å..."-spørsmål tilpasset gruppen/temaet: "${topic}".

Krav:
- Hvert spørsmål skal starte med "Hvem er mest sannsynlig til å..." eller tilsvarende naturlig formulering
- Morsomme, men trygge (ingen støtende eller personlig ekle ting)
- Tilpasset gruppens dynamikk (kontekst: "${topic}")
- Varier mellom det hverdagslige, det komiske og det overraskende
- På ${language}

Returner EKSAKT dette JSON-formatet:
{
  "prompts": [
    "Hvem er mest sannsynlig til å ...?",
    "Hvem er mest sannsynlig til å ...?"
  ]
}`;

  return await callAi({ systemPrompt, userPrompt, validate: (parsed) => {
    const list = parsed.prompts || parsed.questions || [];
    if (!Array.isArray(list) || !list.length) throw new Error('AI returnerte ingen prompts');
    const cleaned = list.map(x => String(x).trim()).filter(x => x.length > 5);
    if (!cleaned.length) throw new Error('AI-svaret hadde ikke gyldige prompts');
    return cleaned;
  }});
}

async function callAi({ systemPrompt, userPrompt, validate }) {
  const cfg = getAiConfig();
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    let msg = 'API-feil: ' + res.status;
    try { const e = await res.json(); msg = e?.error?.message || e?.message || msg; } catch {}
    throw new Error(msg);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content
              ?? json.content?.[0]?.text
              ?? '';
  if (!content) throw new Error('Tomt svar fra AI');

  let parsed;
  try { parsed = JSON.parse(content); }
  catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('Kunne ikke lese JSON fra AI-svaret');
  }
  return validate(parsed);
}
