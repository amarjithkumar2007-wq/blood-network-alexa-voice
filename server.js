// Blood Network Voice - a simulated Alexa+ experience (web app).
// Zero-dependency Node server: static UI + agent API + MCP endpoint.
// Voice: Gnani Prisma STT (Hinglish) -> agent -> Gnani Timbre TTS.
const http = require('http');
const fs = require('fs');
const path = require('path');
const gnani = require('./gnani');
const agent = require('./agent');
const mcp = require('./mcp');

const PORT = process.env.PORT || 3000;
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
};

function send(res, code, obj, headers = {}) {
  const body = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': Buffer.isBuffer(obj) ? 'application/octet-stream' : (headers['Content-Type'] || 'application/json; charset=utf-8'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}
function body(req, max = 12e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// Voice turns are heavier (STT + LLM + TTS), so cap concurrency to be kind to the free tier.
let inFlight = 0;
async function gated(fn) {
  if (inFlight >= 4) throw Object.assign(new Error('Server busy - try again in a few seconds'), { status: 429 });
  inFlight++;
  try { return await fn(); } finally { inFlight--; }
}

async function route(req, res, url) {
  const m = req.method, p = url.pathname;

  if (m === 'GET' && STATIC[p]) {
    const [file, type] = STATIC[p];
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', file)), { 'Content-Type': type });
  }
  if (m === 'GET' && p === '/api/status') {
    return send(res, 200, {
      live: gnani.configured(), llm: Boolean(process.env.OPENROUTER_API_KEY),
      sttLang: gnani.STT_LANG, ttsLang: gnani.TTS_LANG, voice: gnani.TTS_VOICE,
      mcp: { endpoint: '/mcp', protocol: mcp.PROTOCOL, tools: mcp.TOOL_DEFS.map((t) => t.name) },
      simulated: true, demo: true,
    });
  }
  if (m === 'POST' && p === '/api/agent/text') {
    const b = await body(req);
    const text = String(b.text || '').replace(/[\u0000-\u001f]/g, ' ').trim();
    if (!text) return send(res, 400, { error: 'Type or say something first' });
    const out = await gated(() => agent.turn(text, b.sessionId));
    return send(res, 200, out);
  }
  if (m === 'POST' && p === '/api/agent/voice') {
    if (!gnani.configured()) return send(res, 503, { error: 'Voice not configured - set GNANI_API_KEY on the server' });
    const b = await body(req);
    const audio = Buffer.from(String(b.audioBase64 || ''), 'base64');
    if (!audio.length) return send(res, 400, { error: 'audioBase64 is required' });
    if (audio.length > 8e6) return send(res, 400, { error: 'Audio too large (max ~6 MB)' });
    const mime = /^audio\/(wav|x-wav|mpeg|mp3|ogg|flac|aac|m4a|mp4|webm)(;.*)?$/.test(b.mimeType || '') ? b.mimeType : 'audio/wav';
    try {
      return await gated(async () => {
        const transcript = await gnani.stt(audio, mime, b.language || undefined);
        if (!transcript.trim()) return send(res, 200, { transcript: '', replyText: 'Awaz samajh nahi aayi - phir se boliye.', actions: [], demo: true });
        const out = await agent.turn(transcript, b.sessionId);
        let replyAudioBase64 = null;
        try { replyAudioBase64 = (await gnani.tts(out.replyText, b.language || undefined)).toString('base64'); }
        catch (e) { console.error('Gnani TTS:', e.message); }
        return send(res, 200, { ...out, replyAudioBase64 });
      });
    } catch (e) {
      console.error('voice pipeline:', e.message);
      return send(res, e.status || 502, { error: 'Voice pipeline failed - please type instead' });
    }
  }
  // MCP Streamable HTTP endpoint
  if (p === '/mcp') {
    if (m !== 'POST') return send(res, 405, { error: 'POST JSON-RPC 2.0 to this endpoint' });
    const rpc = await body(req, 1e6);
    const sessionId = 'mcp-' + String((rpc.params && rpc.params._session) || 'default').slice(0, 40);
    const reply = mcp.handle(rpc, agent.tools, { requests: [], lastSlots: {} });
    if (reply === null) return send(res, 202, '');
    return send(res, 200, reply, { 'MCP-Protocol-Version': mcp.PROTOCOL });
  }
  if (m === 'GET' && p === '/health') return send(res, 200, { ok: true });
  send(res, 404, { error: 'Not found' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  route(req, res, url).catch((e) => { console.error(e); send(res, 500, { error: 'Internal error' }); });
}).listen(PORT, () => console.log('Blood Network Voice (simulated Alexa+) on :' + PORT));
