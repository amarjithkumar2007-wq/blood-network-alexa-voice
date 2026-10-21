// Gnani AI API client (Prisma STT + Timbre TTS). Zero-dependency, Node >= 18.
// Needs GNANI_API_KEY in the environment - never hardcode the key.
// Docs: https://docs.gnani.ai (quick start: /stt/v3 multipart, /api/v1/tts/inference JSON -> wav)
const STT_URL = process.env.GNANI_STT_URL || 'https://api.vachana.ai/stt/v3';
const TTS_URL = process.env.GNANI_TTS_URL || 'https://api.vachana.ai/api/v1/tts/inference';
const KEY = process.env.GNANI_API_KEY;
const STT_LANG = process.env.GNANI_STT_LANG || 'hi-IN'; // Prisma handles Hindi + Hinglish code-mix
const TTS_LANG = process.env.GNANI_TTS_LANG || 'hi-IN';
const TTS_VOICE = process.env.GNANI_TTS_VOICE || 'Nalini';

function configured() { return Boolean(KEY); }

// buffer -> transcript text. mime like 'audio/wav' picks the upload filename extension.
async function stt(buffer, mime = 'audio/wav', lang = STT_LANG) {
  const ext = (mime.split('/')[1] || 'wav').split(';')[0].replace('mpeg', 'mp3').replace('x-wav', 'wav');
  const fd = new FormData();
  fd.append('audio_file', new Blob([buffer], { type: mime }), 'clip.' + ext);
  fd.append('language_code', lang);
  const r = await fetch(STT_URL, { method: 'POST', headers: { 'X-API-Key-ID': KEY }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error('Gnani STT failed: HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  return j.transcript || '';
}

// text -> WAV buffer (Timbre v2.5)
async function tts(text, lang = TTS_LANG, voice = TTS_VOICE) {
  const r = await fetch(TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key-ID': KEY },
    body: JSON.stringify({
      text, voice, model: 'timbre-v2.5', language: lang, speed: 1.0,
      audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' },
    }),
  });
  if (!r.ok) throw new Error('Gnani TTS failed: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { configured, stt, tts, STT_LANG, TTS_LANG, TTS_VOICE };
