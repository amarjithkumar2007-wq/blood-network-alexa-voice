// Agent core for the simulated Alexa+ experience.
// Layer 1: an LLM (OpenRouter, free models, fallback chain) decides the action + slots as JSON.
// Layer 2: if every model fails, a deterministic Hinglish parser (voice-parse) takes over,
// so the demo never breaks. Tool results are executed in code and replies are built from
// templates - the LLM never invents donor names, counts, or eligibility facts.
const lib = require('./lib');
const vp = require('./voice-parse');
const DONORS = require('./data/donors');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KEY = process.env.OPENROUTER_API_KEY;
const MODELS = (process.env.OPENROUTER_MODELS ||
  'openrouter/free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,minimax/minimax-m3.1-flash:free,nvidia/nemotron-3-super-120b-a12b:free'
).split(',').map((s) => s.trim()).filter(Boolean);

const SYSTEM = `You are the decision brain of a *simulated* Alexa+ voice experience called "Blood Network Voice" for Hyderabad, India.
Users speak Hinglish (Hindi + English mix, sometimes Devanagari). You choose ONE action per turn and extract slots. You NEVER invent donor data - tools do that.

Actions:
- find_donors: search matching donors. Needs bloodGroup and area.
- create_request: raise an SOS and notify matching donors (simulated). Needs bloodGroup and area. Use ONLY when the user clearly asks to notify/send/alert/create, or confirms a suggestion to notify.
- check_cooldown: when a donor can donate again. Needs donorName (a demo donor name the user mentioned) OR lastDonation (YYYY-MM-DD). Optional component.
- escalate: widen the search radius and alert blood banks (simulated). Uses the latest created request of this session.
- clarify: a required slot is missing - ask for it in "speak".
- chat: general talk or questions about blood donation or this demo - answer in "speak".

Slots: bloodGroup (O+,O-,A+,A-,B+,B-,AB+,AB-), area (Hyderabad area like Dilsukhnagar, Kukatpally, Banjara Hills, Secunderabad, Gachibowli, Madhapur, Ameerpet, Uppal, Charminar, LB Nagar, Miyapur, Mehdipatnam), component (Whole blood|Platelets|Plasma), urgency (critical|urgent|normal), units (int), patient, hospital, donorName, lastDonation.
Reply with ONLY minified JSON, no markdown, no commentary:
{"action":"find_donors","bloodGroup":null,"area":null,"component":null,"urgency":null,"units":null,"patient":null,"hospital":null,"donorName":null,"lastDonation":null,"speak":""}
"speak" is only used for clarify/chat: keep it short, Hinglish (Roman script), friendly, and honest that this is a demo.`;

const sessions = new Map(); // sessionId -> { history, lastSlots, requests }
function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { history: [], lastSlots: {}, requests: [] });
  return sessions.get(id);
}
// Expire idle sessions so the demo server never grows unbounded.
setInterval(() => { const cut = Date.now() - 3600e3; for (const [k, s] of sessions) if ((s.touched || 0) < cut) sessions.delete(k); }, 600e3).unref();

async function llmDecide(text, session) {
  if (!KEY) return null;
  const messages = [
    { role: 'system', content: SYSTEM },
    ...session.history.slice(-6),
    { role: 'user', content: text.slice(0, 400) },
  ];
  for (const model of MODELS) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 30000);
      const r = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify({ model, messages, max_tokens: 400, temperature: 0.1 }),
        signal: ac.signal,
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!content) { console.error('LLM empty (' + model + '):', (j.error && j.error.message) || 'no content'); continue; }
      const m = String(content).match(/\{[\s\S]*\}/);
      if (!m) continue;
      const d = JSON.parse(m[0]);
      if (!d || typeof d.action !== 'string') continue;
      d._model = model;
      return d;
    } catch (e) { console.error('LLM fail (' + model + '):', e.message); }
  }
  return null;
}

// Deterministic fallback: same slots via the battle-tested helpline parser.
function decideDeterministic(text, session) {
  const t = String(text || '').toLowerCase();
  const intent = vp.parseVoiceIntent(text);
  // units defaults to 1 in the parser; only carry it when the caller actually said a count
  const saidUnits = /(?<![\p{L}\p{N}])(\d+|ek|do|teen|char|paanch|panch)\s*(unit|units|bottle|bottles|यूनिट|यूनिट्स|बोतल)(?![\p{L}])/u.test(text);
  const slots = {
    bloodGroup: intent.bloodGroup, area: intent.area,
    component: intent.component, urgency: intent.urgency, units: saidUnits ? intent.units : null,
  };
  const donor = DONORS.find((d) => t.includes(d.name.toLowerCase()));
  if (/\b(cooldown|kitne din|kab de sakta|kab de sakti|phir se de|eligible|eligibility)\b/.test(t) || donor) {
    return { action: 'check_cooldown', donorName: donor ? donor.name : null, component: slots.component, speak: '' };
  }
  if (/\bescalat|aur dhundo|aur khojo|badhaiye|badhao/.test(t)) return { action: 'escalate', speak: '' };
  if (/\b(notify|bhejo|bhej do|alert|request banao|create|haan bhejo|ha bhejo|sos)\b/.test(t) && (slots.bloodGroup || session.lastSlots.bloodGroup) && (slots.area || session.lastSlots.area)) {
    return { action: 'create_request', ...slots, speak: '' };
  }
  if (slots.bloodGroup && slots.area) return { action: 'find_donors', ...slots, speak: '' };
  if (slots.bloodGroup || slots.area) return { action: 'clarify', ...slots, speak: vp.buildReply({ bloodGroup: slots.bloodGroup, area: slots.area }, []) };
  return { action: 'chat', speak: 'Main Blood Network Voice hu - ek simulated Alexa+ demo. Boliye, jaise: O positive chahiye Dilsukhnagar me.' };
}

const normGroup = (g) => { g = String(g || '').toUpperCase().replace(/\s/g, ''); return lib.GROUPS.includes(g) ? g : null; };
const normArea = (a) => {
  if (!a) return null;
  const t = String(a).toLowerCase().trim();
  for (const k of Object.keys(lib.AREAS)) if (k.toLowerCase() === t) return k;
  const alias = vp.AREA_ALIASES[t]; if (alias) return alias;
  for (const k of Object.keys(lib.AREAS)) if (t.includes(k.toLowerCase()) || k.toLowerCase().includes(t)) return k;
  return null;
};
const normComp = (c) => (lib.COMPONENTS.includes(c) ? c : 'Whole blood');

// ---- Tools (also exposed over MCP in mcp.js) ----
const tools = {
  find_donors(args) {
    const bloodGroup = normGroup(args.bloodGroup), area = normArea(args.area);
    if (!bloodGroup || !area) return { error: 'need bloodGroup and area', missing: { bloodGroup: !bloodGroup, area: !area } };
    const component = normComp(args.component), urgency = ['critical', 'urgent', 'normal'].includes(args.urgency) ? args.urgency : 'urgent';
    const req = { bloodGroup, component, urgency, area, coords: lib.AREAS[area], stage: 0 };
    const matches = lib.matchDonors(req, DONORS).slice(0, 5)
      .map((x) => ({ name: x.donor.name, bloodGroup: x.donor.bloodGroup, area: x.donor.area, km: Math.round(x.km * 10) / 10, score: x.score }));
    return { matches, count: matches.length, bloodGroup, area, component, urgency, synthetic: true };
  },
  create_request(args, session) {
    const bloodGroup = normGroup(args.bloodGroup), area = normArea(args.area);
    if (!bloodGroup || !area) return { error: 'need bloodGroup and area', missing: { bloodGroup: !bloodGroup, area: !area } };
    const found = tools.find_donors(args);
    const id = 'REQ-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const req = {
      id, bloodGroup, area, component: found.component, urgency: found.urgency,
      units: Math.max(1, Math.min(10, parseInt(args.units, 10) || 1)),
      patient: String(args.patient || 'Patient').slice(0, 40), hospital: String(args.hospital || '').slice(0, 60) || null,
      notified: found.matches, stage: 0, createdAt: new Date().toISOString(), status: 'Donors notified (simulated)',
    };
    if (session) session.requests.push(req);
    return { request: req, notifiedCount: found.matches.length, synthetic: true, note: 'Demo only - no real message is sent to anyone.' };
  },
  check_cooldown(args) {
    const component = normComp(args.component);
    let donor = null;
    if (args.donorName) donor = DONORS.find((d) => d.name.toLowerCase() === String(args.donorName).toLowerCase().trim());
    if (donor) {
      const left = lib.cooldownLeft(donor, Date.now(), component);
      return { donor: donor.name, bloodGroup: donor.bloodGroup, lastDonation: donor.lastDonation, component, daysLeft: left, eligible: left === 0, synthetic: true };
    }
    if (args.lastDonation && /^\d{4}-\d{2}-\d{2}$/.test(args.lastDonation)) {
      const left = lib.cooldownLeft({ lastDonation: args.lastDonation, available: true }, Date.now(), component);
      return { lastDonation: args.lastDonation, component, daysLeft: left, eligible: left === 0 };
    }
    return { error: 'need donorName (demo donor) or lastDonation (YYYY-MM-DD)' };
  },
  escalate(args, session) {
    const req = session && session.requests[session.requests.length - 1];
    if (!req) return { error: 'no request in this session yet - create one first' };
    req.stage = Math.min(3, (req.stage || 0) + 1);
    const radius = lib.radiusFor(req.urgency, req.stage);
    const banks = lib.BANKS.slice(0, 2 + req.stage).map((b) => b.name);
    return { requestId: req.id, stage: req.stage, newRadiusKm: radius, bloodBanksAlerted: banks, synthetic: true, note: 'Simulated - no real alert is sent.' };
  },
};

// ---- Spoken replies (Hinglish, short, grounded ONLY in tool output) ----
function replyFor(action, d, result, session) {
  const g = d.bloodGroup || (result && result.bloodGroup), area = d.area || (result && result.area);
  if (result && result.error) {
    if (result.missing) {
      if (result.missing.bloodGroup && result.missing.area) return 'Blood group aur area dono bataiye. Jaise: O positive, Dilsukhnagar.';
      if (result.missing.bloodGroup) return `Area ${area} samajh gaya. Blood group bataiye, jaise O positive ya B negative.`;
      return `${g} samajh gaya. Area bataiye, jaise Dilsukhnagar, Kukatpally ya Charminar.`;
    }
    return result.error;
  }
  switch (action) {
    case 'find_donors': {
      if (!result.count) return `${area} ke aas-paas abhi ${g} donor nahi mila. Boliye "escalate karo" to search aur door tak badhaunga.`;
      const top = result.matches.slice(0, 3).map((m) => `${m.name} (${m.km} km)`).join(', ');
      return `${g} ke liye ${area} me ${result.count} donor mile. Sabse kareeb: ${top}. Sab demo donors hain. Notify karna hai to boliye "request bhejo".`;
    }
    case 'create_request': {
      const r = result.request;
      return `Request ${r.id} ban gayi - ${r.bloodGroup}, ${r.area}, ${r.units} unit. ${result.notifiedCount} demo donors ko notification bheja (simulated, kisi ko real message nahi gaya). Agar koi reply nahi karta to boliye "escalate karo".`;
    }
    case 'check_cooldown': {
      if (result.donor) {
        return result.eligible
          ? `${result.donor} abhi ${result.component} de sakte hain - last donation ${result.lastDonation} ko tha.`
          : `${result.donor} ${result.daysLeft} din baad ${result.component} de payenge. Last donation ${result.lastDonation} ko tha. Ye demo data hai.`;
      }
      return result.eligible
        ? `${result.lastDonation} ke hisaab se abhi donate kiya ja sakta hai - ${result.component} ka gap poora ho gaya.`
        : `${result.lastDonation} ke hisaab se ${result.daysLeft} din aur rukna hoga ${result.component} ke liye.`;
    }
    case 'escalate':
      return `Stage ${result.stage}: search radius ab ${result.newRadiusKm} kilometer. ${result.bloodBanksAlerted.length} blood banks ko alert gaya (simulated): ${result.bloodBanksAlerted.join(', ')}.`;
    default:
      return d.speak || 'Boliye, main sun raha hu.';
  }
}

async function turn(text, sessionId) {
  const session = getSession(String(sessionId || 'default').slice(0, 60));
  session.touched = Date.now();
  const clean = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 400);
  const llm = await llmDecide(clean, session);
  const d = llm || decideDeterministic(clean, session);
  const action = tools[d.action] ? d.action : (d.action === 'clarify' || d.action === 'chat' ? d.action : 'chat');

  // Fill missing slots from session context (multi-turn: "aur O positive?" after an area was given)
  const merged = { ...d };
  for (const k of ['bloodGroup', 'area', 'component', 'urgency', 'units']) {
    if (!merged[k] && session.lastSlots[k]) merged[k] = session.lastSlots[k];
  }

  let result = null;
  const actions = [];
  if (tools[action]) {
    result = tools[action](merged, session);
    actions.push({
      tool: action,
      args: Object.fromEntries(Object.entries(merged).filter(([k, v]) => v && !k.startsWith('_') && ['bloodGroup', 'area', 'component', 'urgency', 'units', 'patient', 'hospital', 'donorName', 'lastDonation'].includes(k))),
      summary: result.error ? ('error: ' + result.error)
        : action === 'find_donors' ? result.count + ' donors found'
        : action === 'create_request' ? 'request ' + result.request.id + ' created, ' + result.notifiedCount + ' notified (simulated)'
        : action === 'check_cooldown' ? (result.donor || result.lastDonation) + ': ' + (result.eligible ? 'eligible now' : result.daysLeft + ' days left')
        : 'stage ' + result.stage + ', radius ' + result.newRadiusKm + ' km',
    });
    if (!result.error) {
      session.lastSlots = { bloodGroup: normGroup(merged.bloodGroup) || session.lastSlots.bloodGroup, area: normArea(merged.area) || session.lastSlots.area, component: normComp(merged.component), urgency: merged.urgency || 'urgent', units: merged.units };
    }
  }
  const replyText = replyFor(action, merged, result, session);
  session.history.push({ role: 'user', content: clean }, { role: 'assistant', content: replyText });
  session.history = session.history.slice(-12);

  return {
    transcript: clean,
    action,
    actions,
    replyText,
    matches: result && result.matches ? result.matches : undefined,
    request: result && result.request ? result.request : undefined,
    engine: llm ? ('llm:' + llm._model) : 'deterministic-fallback',
    demo: true,
  };
}

module.exports = { turn, tools, decideDeterministic, replyFor, MODELS };
