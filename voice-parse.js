// Voice helpline parsing + reply building (pure functions, unit tested).
// Turns a Hinglish/Hindi transcript like "O positive chahiye Dilsukhnagar me urgent"
// into a Blood Network search intent, and builds the spoken Hinglish reply.
const lib = require('./lib');

// Spoken area aliases -> lib.AREAS keys (STT output varies in spelling)
const AREA_ALIASES = {
  'gachibowli': 'Gachibowli', 'gachibauli': 'Gachibowli',
  'madhapur': 'Madhapur',
  'kukatpally': 'Kukatpally', 'kukatpalli': 'Kukatpally', 'kphb': 'Kukatpally',
  'secunderabad': 'Secunderabad', 'sikandarabad': 'Secunderabad', 'sikandrabad': 'Secunderabad',
  'ameerpet': 'Ameerpet', 'amirpet': 'Ameerpet',
  'dilsukhnagar': 'Dilsukhnagar', 'dilshuknagar': 'Dilsukhnagar',
  'uppal': 'Uppal',
  'charminar': 'Charminar', 'char minar': 'Charminar',
  'banjara hills': 'Banjara Hills', 'banjara hill': 'Banjara Hills',
  'lb nagar': 'LB Nagar', 'l b nagar': 'LB Nagar', 'albee nagar': 'LB Nagar',
  'miyapur': 'Miyapur',
  'mehdipatnam': 'Mehdipatnam', 'mahdipatnam': 'Mehdipatnam',
  // Devanagari spellings (Prisma can transcribe Hindi speech in Devanagari)
  'गचिबौली': 'Gachibowli', 'माधापुर': 'Madhapur', 'माधापूर': 'Madhapur',
  'कुकटपल्ली': 'Kukatpally', 'कुकटपल्लि': 'Kukatpally',
  'सिकंदराबाद': 'Secunderabad', 'सिकन्दराबाद': 'Secunderabad',
  'अमीरपेट': 'Ameerpet', 'अमिरपेट': 'Ameerpet',
  'दिलसुखनगर': 'Dilsukhnagar', 'दिलसुख़नगर': 'Dilsukhnagar', 'दिलसुखनागर': 'Dilsukhnagar', 'दिलसुख नगर': 'Dilsukhnagar', 'दिलशुखनगर': 'Dilsukhnagar',
  'उप्पल': 'Uppal', 'चारमीनार': 'Charminar', 'चार मीनार': 'Charminar',
  'बंजारा हिल्स': 'Banjara Hills', 'बंजारा हिल': 'Banjara Hills',
  'एलबी नगर': 'LB Nagar', 'एल बी नगर': 'LB Nagar',
  'मियापुर': 'Miyapur', 'मियापूर': 'Miyapur', 'मेहदीपटनम': 'Mehdipatnam', 'मेहदीपट्टनम': 'Mehdipatnam',
  'कुकटॉपली': 'Kukatpally', 'कुकटपली': 'Kukatpally', 'गचिबॉली': 'Gachibowli', 'गाचिबोली': 'Gachibowli',
  'माधापुर': 'Madhapur', 'मदापुर': 'Madhapur', 'अप्पल': 'Uppal',
};

const GROUP_WORDS = {
  o: 'O', oh: 'O', a: 'A', b: 'B', bee: 'B', ab: 'AB', 'a b': 'AB', eb: 'AB',
  'ओ': 'O', 'ए': 'A', 'बी': 'B', 'बि': 'B', 'एबी': 'AB', 'ए बी': 'AB',
};
const POS_WORDS = ['positive', 'positiv', 'plus', '+', 'pausitive', 'पॉजिटिव', 'पॉज़िटिव', 'पोजिटिव', 'प्लस'];
const NEG_WORDS = ['negative', 'negativ', 'minus', '-', 'negetive', 'नेगेटिव', 'निगेटिव', 'माइनस'];

function norm(text) {
  return String(text || '').toLowerCase().replace(/[.,!?;:'"\u0964\u0965]/g, ' ').replace(/\s+/g, ' ').trim();
}

// "O positive", "B-", "oh plus", "AB negative" -> 'O+' etc.
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function parseGroup(text) {
  const t = norm(text);
  // compact forms first: o+, b-, ab+
  let m = t.match(/\b(ab|a|b|o)\s*([+-])(?=\s|$)/);
  if (m) return m[1].toUpperCase() + m[2];
  // \b misses Devanagari, so use Unicode letter boundaries
  const wb = (x) => '(?<![\\p{L}\\p{N}])' + esc(x) + '(?![\\p{L}\\p{N}])';
  for (const [w, letter] of Object.entries(GROUP_WORDS)) {
    for (const p of POS_WORDS) if (new RegExp(wb(w) + ' ' + wb(p), 'u').test(t)) return letter + '+';
    for (const n of NEG_WORDS) if (new RegExp(wb(w) + ' ' + wb(n), 'u').test(t)) return letter + '-';
  }
  return null;
}

function parseArea(text) {
  const t = ' ' + norm(text) + ' ';
  const squash = (x) => x.replace(/\s+/g, '');
  const ts = squash(t); // STT sometimes splits words: "दिलसुख नागर"
  // longest alias first so "banjara hills" beats "banjara"
  const keys = Object.keys(AREA_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) if (t.includes(' ' + k + ' ') || t.includes(' ' + k) || t.includes(k + ' ') || ts.includes(squash(k))) return AREA_ALIASES[k];
  for (const a of Object.keys(lib.AREAS)) if (t.includes(a.toLowerCase()) || ts.includes(squash(a.toLowerCase()))) return a;
  return null;
}

function parseUrgency(text) {
  const t = norm(text);
  if (/\b(critical|emergency|turant|foran|fauran|bohat jaldi|bahut jaldi|life)\b/.test(t)) return 'critical';
  if (/\b(urgent|jaldi|jald|jaldhi|turant)\b/.test(t)) return 'urgent';
  return 'urgent'; // a caller on an emergency helpline defaults to urgent, never 'normal'
}

function parseComponent(text) {
  const t = norm(text);
  if (/\bplatelet/.test(t)) return 'Platelets';
  if (/\bplasma\b/.test(t)) return 'Plasma';
  return 'Whole blood';
}

function parseUnits(text) {
  const t = norm(text);
  const m = t.match(/(?<![\p{L}\p{N}])(\d+|ek|do|teen|char|paanch|panch)\s*(unit|units|bottle|bottles|यूनिट|यूनिट्स|बोतल)(?![\p{L}])/u);
  if (!m) return 1;
  const words = { ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5 };
  return words[m[1]] || Math.max(1, Math.min(10, parseInt(m[1], 10) || 1));
}

// Full transcript -> intent object. Fields stay null when not heard, so the caller can ask again.
function parseVoiceIntent(text) {
  return {
    bloodGroup: parseGroup(text),
    area: parseArea(text),
    urgency: parseUrgency(text),
    component: parseComponent(text),
    units: parseUnits(text),
  };
}

// Hinglish (Roman) lines the helpline speaks back. Kept short for TTS.
function buildReply(intent, matches) {
  if (!intent.bloodGroup && !intent.area) return 'Maaf kijiye, blood group aur area dono phir se bataiye. Jaise: O positive, Dilsukhnagar.';
  if (!intent.bloodGroup) return `Aapka area ${intent.area} samajh gaya. Blood group bataiye, jaise O positive ya B negative.`;
  if (!intent.area) return `${intent.bloodGroup} samajh gaya. Area bataiye, jaise Kukatpally, Dilsukhnagar ya Charminar.`;
  const n = matches.length;
  if (!n) return `${intent.area} ke aas-paas abhi ${intent.bloodGroup} donor nahi mila. Search apne aap aur bada area me badhega. Kripya thodi der me phir try karein.`;
  const top = matches.slice(0, 3).map((m) => `${m.donor.name}, ${m.km} kilometer`).join('. ');
  return `${intent.bloodGroup} ke liye ${intent.area} me ${n} donor mile. Sabse kareeb: ${top}. Donor se platform relay ke through contact hoga, aapka number private rehta hai. Ye demo data hai.`;
}

module.exports = { AREA_ALIASES, parseGroup, parseArea, parseUrgency, parseComponent, parseUnits, parseVoiceIntent, buildReply };
