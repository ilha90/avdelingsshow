// === DATA FOR AVDELINGSSHOW ===

const QUIZ_QUESTIONS = [
  { q: "Hva er Norges lengste elv?", a: ["Glomma", "Pasvikelva", "Numedalslågen", "Gudbrandsdalslågen"], correct: 0 },
  { q: "Hvem skrev «Et dukkehjem»?", a: ["Henrik Wergeland", "Knut Hamsun", "Henrik Ibsen", "Bjørnstjerne Bjørnson"], correct: 2 },
  { q: "Hvilket fjell er Norges høyeste?", a: ["Store Skagastølstind", "Glittertind", "Galdhøpiggen", "Snøhetta"], correct: 2 },
  { q: "Hvor mange strofer har «Ja, vi elsker» offisielt?", a: ["3", "5", "8", "12"], correct: 2 },
  { q: "Hvilket år ble DNB (som merkenavn) etablert etter fusjonen av DnB og Gjensidige NOR?", a: ["2001", "2003", "2007", "2011"], correct: 1 },
  { q: "Hva er Norges største innsjø?", a: ["Tyrifjorden", "Femunden", "Randsfjorden", "Mjøsa"], correct: 3 },
  { q: "Hvem vant Eurovision for Norge i 2009?", a: ["Bobbysocks", "Secret Garden", "Alexander Rybak", "Margaret Berger"], correct: 2 },
  { q: "I hvilken by ble OL arrangert i 1994?", a: ["Oslo", "Trondheim", "Bergen", "Lillehammer"], correct: 3 },
  { q: "Hva står «BIC» for i bank-verden?", a: ["Business Identifier Code", "Bank International Code", "Basel Identity Card", "Banking Index Core"], correct: 0 },
  { q: "Hvilken farge har 1000-kroneseddelen (2024-utgaven)?", a: ["Blå", "Lilla", "Grønn", "Oransje"], correct: 1 },
  { q: "Hvor mange kommuner har Norge per 2024?", a: ["356", "357", "422", "428"], correct: 1 },
  { q: "Hvilket land har flest tidssoner i verden?", a: ["USA", "Russland", "Kina", "Frankrike"], correct: 3 },
  { q: "Hva heter sentralbanksjefen i Norge (fra 2023)?", a: ["Øystein Olsen", "Jens Stoltenberg", "Ida Wolden Bache", "Siv Jensen"], correct: 2 },
  { q: "Hvilket grunnstoff har kjemisk symbol «Au»?", a: ["Sølv", "Aluminium", "Gull", "Argon"], correct: 2 },
  { q: "Hvor mange planeter har solsystemet vårt (offisielt)?", a: ["7", "8", "9", "10"], correct: 1 },
  { q: "Hva er hovedstaden i Australia?", a: ["Sydney", "Melbourne", "Canberra", "Brisbane"], correct: 2 },
  { q: "Hva er IBAN en forkortelse for?", a: ["International Bank Account Number", "Internal Banking Authority Network", "Interbank Authorized Number", "Integrated Banking Access Node"], correct: 0 },
  { q: "Hvilket dyr er på det norske riksvåpenet?", a: ["Bjørn", "Ulv", "Løve", "Ørn"], correct: 2 },
  { q: "Hvor mange bein har en edderkopp?", a: ["6", "8", "10", "12"], correct: 1 },
  { q: "Hva heter Norges lengste tunnel for biltrafikk?", a: ["Eiksundtunnelen", "Lærdalstunnelen", "Atlanterhavstunnelen", "Bømlafjordtunnelen"], correct: 1 }
];

const EMOJI_PUZZLES = [
  { emoji: "🦁👑", answer: "Løvenes konge", cat: "Film" },
  { emoji: "🕷️🧑‍🦰", answer: "Spider-Man", cat: "Film" },
  { emoji: "❄️👸🏰", answer: "Frost", cat: "Film" },
  { emoji: "🚢🧊💔", answer: "Titanic", cat: "Film" },
  { emoji: "🧙‍♂️⚡👦", answer: "Harry Potter", cat: "Film" },
  { emoji: "🦖🏝️", answer: "Jurassic Park", cat: "Film" },
  { emoji: "🏠🎈👴", answer: "Up", cat: "Film" },
  { emoji: "🐟🔍🪸", answer: "Oppdrag Nemo", cat: "Film" },
  { emoji: "🤖💚🌱", answer: "WALL-E", cat: "Film" },
  { emoji: "⭐⚔️🚀", answer: "Star Wars", cat: "Film" },
  { emoji: "🦇🦸", answer: "Batman", cat: "Film" },
  { emoji: "👽☎️🏡", answer: "E.T.", cat: "Film" },
  { emoji: "🐻🍯🌳", answer: "Ole Brumm", cat: "Film" },
  { emoji: "🥶👟🐌", answer: "Sniglete" , cat: "Uttrykk" },
  { emoji: "🌧️🐱🐶", answer: "Det pøser ned", cat: "Uttrykk" },
  { emoji: "🫖🌪️", answer: "Storm i vannglass", cat: "Uttrykk" },
  { emoji: "🐻🧊", answer: "Isbjørn", cat: "Dyr" },
  { emoji: "👑🦅🇳🇴", answer: "Kongeørn", cat: "Dyr" },
  { emoji: "🎶👻👻👻", answer: "Ghostbusters", cat: "Film" },
  { emoji: "🏰⚔️🐉", answer: "Game of Thrones", cat: "Serie" }
];

const WHEEL_CHALLENGES = [
  "Fortell en vits",
  "Beskriv jobben din med 3 emojis",
  "Si en ting du er stolt av fra sist måned",
  "Anbefal en bok, film eller serie",
  "Hvilken superkraft ville du hatt?",
  "Lag en ny avdelings-tradisjon",
  "Hvilken sang beskriver en mandag morgen?",
  "Fortell om beste ferieminne",
  "Hvis avdelingen var en film — hvilken?",
  "Del et lite livshack",
  "Hva ville du gjort hvis du vant lotto?",
  "Si tre hyggelige ord om personen til venstre",
  "Hvilken emoji bruker du mest?",
  "Hva er din «guilty pleasure»?",
  "Hvis du måtte bytte jobb i én uke — hvilken?",
  "Sist du ble overrasket på jobb?",
  "Hva pleier du å spise til lunsj?",
  "Hvor reiser du helst hen neste ferie?",
  "Hva er din beste karrieretips?",
  "Hvilken myte om bankbransjen stemmer ikke?"
];

const KATEGORI_SETS = [
  ["Dyr", "Land", "Mat", "Yrke", "Sport"],
  ["Film", "Frukt", "By i verden", "Fornavn", "Klær"],
  ["Merkevare", "Norsk artist", "Grønnsak", "Farge", "TV-serie"],
  ["Sjefers navn", "Ting i kontoret", "Drikke", "Hovedstad", "Hobby"],
  ["Kjendis", "Dessert", "Musikkinstrument", "Fjell", "Kroppsdel"],
  ["Brettspill", "Bilmerke", "Fisk", "Kjøkkenredskap", "Yrkesgruppe"],
  ["Norsk by", "Superhelt", "Kosedyr", "Eventyrfigur", "Ferieland"]
];

// Litt enklere — unngå bokstaver som er svært vanskelige på norsk
const KATEGORI_LETTERS = "ABDEFGHIKLMNOPRSTV".split("");

const BLIKJENT_CARDS = [
  "Hva var din første sommerjobb?",
  "Hvis du måtte gi bort alle apper unntatt tre — hvilke beholder du?",
  "Hvilken sang kan du ALLE tekstene til?",
  "Beskriv deg selv i tre ord.",
  "Hva er den mest spennende personen du har møtt?",
  "Hvilket talent skulle du ønske du hadde?",
  "Hva gjør deg genuint glad på en grå tirsdag?",
  "Hva var drømmejobben din som 10-åring?",
  "Hva er det mest overraskende du har oppdaget om deg selv?",
  "Hvilket sted på jorden vil du gjerne tilbake til?",
  "Et kompliment du husker ekstra godt?",
  "Hva er den siste tingen som fikk deg til å le høyt?",
  "Hvis du kunne spise én rett for alltid, hva ville det vært?",
  "Hva lærte du sist uke?",
  "En film, bok eller serie som betyr mye for deg — og hvorfor?",
  "Hvis du måtte holde et TED-foredrag i morgen, om hva?",
  "Hva er det rareste du har på CV-en din?",
  "Hvilken årstid passer personligheten din?",
  "Hvem beundrer du mest — og hvorfor?",
  "Hva er din beste morgenrutine?",
  "Hvilken uvane har du som du egentlig elsker?",
  "Hva er et godt råd du har fått som du husker?",
  "Hvis du kunne møte hvem som helst i en kaffe — hvem?",
  "Hva er du mest takknemlig for akkurat nå?",
  "En ting på bucket-listen din?",
  "Hva ville du gjort hvis du hadde et år helt fritt?",
  "Hva gjør deg til en god kollega?",
  "Hvilken påstand vil du alltid forsvare?",
  "Hva er det snilleste noen har gjort for deg på jobb?",
  "Hvilken stil av humor passer deg best?"
];
