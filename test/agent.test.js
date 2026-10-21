// Deterministic-fallback coverage: these run with no OPENROUTER_API_KEY.
process.env.OPENROUTER_API_KEY = '';
process.env.GNANI_API_KEY = '';
const test = require('node:test');
const assert = require('node:assert');
const agent = require('../agent');
const mcp = require('../mcp');
const lib = require('../lib');
const DONORS = require('../data/donors');

test('full Hinglish request -> find_donors with grounded matches', async () => {
  const r = await agent.turn('O positive chahiye Dilsukhnagar me urgent, 2 units', 'test-1');
  assert.equal(r.action, 'find_donors');
  assert.ok(r.matches.length >= 1);
  for (const m of r.matches) assert.ok(lib.compatible(m.bloodGroup, 'O+', 'Whole blood'));
  assert.match(r.replyText, /O\+/);
  assert.match(r.replyText, /demo/i);
});

test('multi-turn: notify -> create_request -> escalate', async () => {
  await agent.turn('O positive chahiye Dilsukhnagar me', 'test-2');
  const c = await agent.turn('haan request bhejo', 'test-2');
  assert.equal(c.action, 'create_request');
  assert.match(c.replyText, /simulated/i);
  const e = await agent.turn('escalate karo', 'test-2');
  assert.equal(e.action, 'escalate');
  assert.match(e.replyText, /kilometer/);
});

test('cooldown for a recent donor is never eligible', async () => {
  const r = await agent.turn('Sneha kab phir se donate kar sakti hai?', 'test-3');
  assert.equal(r.action, 'check_cooldown');
  assert.match(r.replyText, /din baad/);
});

test('missing area -> clarify, never invented', async () => {
  const r = await agent.turn('B negative chahiye', 'test-4');
  assert.equal(r.action, 'clarify');
  assert.match(r.replyText, /Area bataiye/);
});

test('replies only name real demo donors', async () => {
  const r = await agent.turn('A positive chahiye Banjara Hills me', 'test-5');
  const names = DONORS.map((d) => d.name);
  for (const m of r.matches || []) assert.ok(names.includes(m.name), 'match must be a demo donor');
});

test('dash blood group survives cleaning (B- not mangled)', async () => {
  const r = await agent.turn('B- chahiye Uppal me', 'test-6');
  assert.equal(r.action, 'find_donors');
});

test('MCP: initialize, tools/list, tools/call find_donors', () => {
  const s = { requests: [], lastSlots: {} };
  const init = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' }, agent.tools, s);
  assert.equal(init.result.protocolVersion, '2025-11-25');
  const list = mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, agent.tools, s);
  assert.equal(list.result.tools.length, 4);
  const call = mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_donors', arguments: { bloodGroup: 'O+', area: 'Dilsukhnagar' } } }, agent.tools, s);
  const out = JSON.parse(call.result.content[0].text);
  assert.ok(out.count >= 1);
  assert.equal(out.synthetic, true);
});

test('MCP: unknown tool and bad method are JSON-RPC errors', () => {
  const s = { requests: [], lastSlots: {} };
  const bad = mcp.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nuke', arguments: {} } }, agent.tools, s);
  assert.equal(bad.error.code, -32602);
  const nope = mcp.handle({ jsonrpc: '2.0', id: 10, method: 'resources/read' }, agent.tools, s);
  assert.equal(nope.error.code, -32601);
});
