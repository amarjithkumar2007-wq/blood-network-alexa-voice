// Minimal MCP server (Streamable HTTP transport, protocol version 2025-11-25).
// Exposes the same 4 agent tools over JSON-RPC 2.0, so the project also shows the
// real Alexa+ integration surface (MCP is the open standard powering Alexa+ integrations).
// No external deps: POST JSON-RPC in, JSON out. GET (SSE listen stream) is not needed
// for request/response tools and returns 405, which compliant clients tolerate.
const PROTOCOL = '2025-11-25';

const TOOL_DEFS = [
  {
    name: 'find_donors',
    description: 'Search matching blood donors near a Hyderabad area (synthetic demo data). Applies ABO/Rh compatibility, donation cooldowns and distance ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        bloodGroup: { type: 'string', enum: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'], description: 'Patient blood group' },
        area: { type: 'string', description: 'Hyderabad area, e.g. Dilsukhnagar' },
        component: { type: 'string', enum: ['Whole blood', 'Platelets', 'Plasma'] },
        urgency: { type: 'string', enum: ['critical', 'urgent', 'normal'] },
      },
      required: ['bloodGroup', 'area'],
    },
  },
  {
    name: 'create_request',
    description: 'Create an SOS blood request and notify matching donors (SIMULATED - no real message is sent).',
    inputSchema: {
      type: 'object',
      properties: {
        bloodGroup: { type: 'string', enum: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] },
        area: { type: 'string' },
        units: { type: 'integer', minimum: 1, maximum: 10 },
        urgency: { type: 'string', enum: ['critical', 'urgent', 'normal'] },
        patient: { type: 'string' },
        hospital: { type: 'string' },
      },
      required: ['bloodGroup', 'area'],
    },
  },
  {
    name: 'check_cooldown',
    description: 'Check when a donor can donate again (90d whole blood / 28d plasma / 14d platelets). Pass a demo donor name or a lastDonation date.',
    inputSchema: {
      type: 'object',
      properties: {
        donorName: { type: 'string', description: 'Demo donor name, e.g. Sneha' },
        lastDonation: { type: 'string', description: 'YYYY-MM-DD' },
        component: { type: 'string', enum: ['Whole blood', 'Platelets', 'Plasma'] },
      },
    },
  },
  {
    name: 'escalate',
    description: 'Escalate the session\'s latest request: widen the search radius (2x per stage, max 3) and alert blood banks (SIMULATED).',
    inputSchema: { type: 'object', properties: {} },
  },
];

function result(id, value) { return { jsonrpc: '2.0', id, result: value }; }
function error(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// agent.tools is injected so MCP and the web agent share one implementation.
function handle(rpc, tools, session) {
  if (!rpc || rpc.jsonrpc !== '2.0') return error(rpc && rpc.id != null ? rpc.id : null, -32600, 'Invalid Request');
  const { id, method, params } = rpc;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'blood-network-voice', version: '1.0.0', title: 'Blood Network Voice (demo)' },
        instructions: 'Synthetic demo data only. create_request and escalate are simulated - no real messages are sent.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // 202 Accepted, no body
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOL_DEFS });
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const tool = tools[name];
      if (!tool) return error(id, -32602, 'Unknown tool: ' + name);
      try {
        const out = tool(args, session);
        return result(id, { ...text(out), isError: Boolean(out && out.error) });
      } catch (e) {
        return result(id, { content: [{ type: 'text', text: 'tool error: ' + e.message }], isError: true });
      }
    }
    default:
      return error(id == null ? null : id, -32601, 'Method not found: ' + method);
  }
}

module.exports = { handle, TOOL_DEFS, PROTOCOL };
