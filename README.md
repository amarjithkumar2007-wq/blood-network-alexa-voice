# Blood Network Voice — a simulated Alexa+ experience

Ask for blood in Hinglish ("O positive chahiye Dilsukhnagar me urgent") and a voice
agent finds matching donors, creates a request, checks donation cooldowns and escalates
the search — as a **simulated Alexa+ experience in a web app**.

Built for the **Amazon Developer Hackathon 2026 — Alexa+ track** (the track's rules
explicitly allow a simulated Alexa+ experience built with any agentic tool).

> **Honest labels, on purpose:**
> - This is a *simulation* of an Alexa+ experience, not an integration with a real Alexa device.
> - All 16 donors are **synthetic demo records**. No real people, no real phone numbers.
> - Notifications and blood-bank alerts are **simulated** — no real message is ever sent.

## How it works

```
voice (Hinglish) ──> Gnani Prisma STT ──> Agent (LLM decides the action)
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
              find_donors            create_request / escalate     check_cooldown
              (ABO/Rh rules,         (simulated notify;            (90d blood /
               distance ranking)      radius doubling +             28d plasma /
                                      bank alerts, simulated)       14d platelets)
                                              │
                    reply text (grounded, template-built — the LLM never invents donor data)
                                              │
                                    Gnani Timbre TTS ──> spoken Hinglish reply
```

- **Voice:** Gnani Prisma STT (`hi-IN`, handles Hindi + Hinglish code-mix) and Gnani
  Timbre TTS (`Nalini` voice). A typed-text mode works with no microphone.
- **Agent:** an LLM via OpenRouter (free models, fallback chain) chooses one action per
  turn as JSON; deterministic code executes it. If every model is unavailable, a
  deterministic Hinglish parser takes over, so the demo never breaks.
- **Grounding:** donor matching uses real rules — ABO/Rh compatibility (incl. reverse
  matching for plasma), 90/28/14-day donation cooldowns, haversine distance ranking and
  radius-doubling escalation. Replies are built from templates over tool output.
- **MCP server:** the same four tools are exposed at `POST /mcp` (Streamable HTTP,
  protocol `2025-11-25`) — MCP is the open standard that powers real Alexa+
  integrations, so the repo shows both the simulated experience and the real
  integration surface.

## Run it

```bash
git clone <this repo>
cd blood-network-alexa-voice
export GNANI_API_KEY=...        # voice (optional for text mode)
export OPENROUTER_API_KEY=...   # LLM agent (optional, deterministic fallback without it)
npm start                       # http://localhost:3000
npm test                        # 8 tests, no network or keys needed
```

No dependencies, no build step. Node 18+.

## Try these (demo script)

1. "O positive chahiye Dilsukhnagar me urgent, 2 units" → finds donors
2. "haan request bhejo" → creates the request (simulated notify)
3. "escalate karo" → radius doubles, blood banks alerted (simulated)
4. "Sneha kab phir se donate kar sakti hai?" → cooldown check (Sneha donated recently)
5. "Plasma chahiye Mehdipatnam me" → plasma uses reverse ABO matching (AB is universal plasma donor)

## MCP quick check

```bash
curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d \
  '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_donors","arguments":{"bloodGroup":"O+","area":"Dilsukhnagar"}}}'
```

## What is new in this project

Blood Network began as a general donor-matching web app. **Built during this hackathon
window:** the Alexa+-style simulated voice experience, the LLM agent loop with tool
calling and deterministic fallback, the MCP server, the cooldown/escalation tools as
agent-callable actions, and this repo. The Hinglish voice parsing helpers and the
matching rules were adapted from the existing Blood Network codebase (same author).

## Notes

- Built with AI-assisted coding; all matching/eligibility logic is deterministic and unit-tested.
- Demo deployment runs on a free host that sleeps when idle — first load may take ~30s.
