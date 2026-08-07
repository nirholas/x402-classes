# x402-classes

**Sell class seats one at a time, to agents and humans** — a self-hosted booking
server for fitness studios, dance schools, and workshop hosts, payable with
[x402](https://x402.org) micropayments. The timetable is **free** to read; $0.05
buys a seat, and the payment returns the whole ticket — seat number, class
details, calendar invite, and a **signed QR pass** the door can scan — in the same
HTTP response.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![x402](https://img.shields.io/badge/payments-x402%20%C2%B7%20USDC-0052ff.svg)](https://x402.org)
[![rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-14f195.svg)](#how-x402-works)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-0052ff.svg)](https://nirholas.github.io/x402-classes/)

## Why x402 for this

Class booking platforms want a monthly fee, a merchant account, and a signup
funnel that no agent can navigate. The unit being sold here is tiny and
discrete — one seat, one class — which is exactly the shape x402 fits: the
transaction *is* the authentication, so any wallet pays $0.05 and walks away with
a ticket, no account and no card on file. Making the schedule free and the seat
paid means agents can plan for nothing and only spend when they commit, and the
studio never handles card data or platform fees.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-classes
cd x402-classes && npm install

# your timetable, capacities and pass policy live in config/classes.json
npm run dev
```

The server ships with the suite's public receive addresses so it runs out of the
box. Set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env`
to receive the payments yourself.

Then, in another terminal, run the full agent flow (schedule → enroll → verify):

```bash
PRIVATE_KEY=0xFundedBaseSepoliaKey npm run client
```

Fund the client wallet with testnet USDC at
[faucet.circle.com](https://faucet.circle.com). Open <http://localhost:4023> for
the human checkout demo.

## API

| Route | Price | What you get back |
|---|---|---|
| `GET /schedule` | free | The class calendar with live seat counts — sessions, instructors, rooms, `seatsLeft`, `enrollmentOpen` |
| `POST /enroll/:classId` | $0.05 | `{passId, seatNumber, classDetails, holder, seatsLeftAfter, pass: {token, verifyUrl, expiresAt, qrSvgDataUri}, ics (base64 invite), signature}` |
| `GET /verify/:token` | free | Pass validation for the door — `valid`, payload, check-in status, session |
| `POST /check-in/:token` | free | Marks a pass used; re-scans report `alreadyCheckedIn` |
| `GET /roster/:classId` | free | Seats sold: seat number, holder name, check-in status |
| `GET /classes/:classId`, `GET /info`, `GET /health`, `GET /.well-known/x402` | free | Session detail / studio profile / liveness / machine-readable payment manifest |

Class ids are `<templateId>@<YYYY-MM-DD>` — e.g. `vinyasa-am@2026-08-10`. Take
them from `/schedule`.

Full reference: [docs/api.md](docs/api.md) · [openapi.json](openapi.json)

## How x402 works

**Pay in USDC on Base or Solana — your client picks the rail.**

1. Client calls the paid route with no payment → server answers **`402 Payment
   Required`** with an `accepts[]` array holding **both rails**: USDC on Base
   (`base-sepolia` by default) and USDC on Solana, each with amount, token
   address, and recipient.
2. Client picks one and signs — EVM: an EIP-3009 `transferWithAuthorization`;
   Solana: an SPL `transferChecked` — then retries with the **`X-PAYMENT`**
   header.
3. The facilitator for that rail **verifies and settles** on the chosen chain —
   x402.org's for Base, PayAI's for Solana (each overridable by env; no public
   facilitator settles both).
4. Server responds **`200`** with the purchased artifact in the body and a
   settlement receipt in **`X-PAYMENT-RESPONSE`**.

Settlement is deliberately last: the payment only settles when the route returns
`2xx`, so a class that filled up between the client's `/schedule` read and its
enrollment returns `409 CLASS_FULL` and never charges the payer.

No API keys, no invoices, no minimums — each request pays for itself. Raw
wire-level walkthrough: [examples/curl.md](examples/curl.md).

## The QR pass

The paid response includes a self-contained ticket:

```
pass.token = base64url(canonical JSON payload) + "." + hex HMAC-SHA256
```

The payload carries `passId`, `classId`, `seatNumber`, `holder`, `startsAt`,
`expiresAt`, and the studio name. Because it is signed rather than looked up, a
**door scanner holding `SIGNING_SECRET` can validate a pass with no network at
all** — useful in a basement studio — and reconcile against
`GET /roster/:classId` later. Everyone else uses the free `GET /verify/:token`.

`pass.qrSvgDataUri` is that verification URL rendered as a QR code, inline as an
SVG data URI: drop it straight into `<img src="…">`, or `base64 -d` it to a file.
Tampering with a single character invalidates the HMAC, and passes stop
validating when the class ends.

## Real backend / configuration

This server sells **real inventory you configure** — there are no fixtures and no
external API keys:

- `config/classes.json` — your studio profile, recurring class templates (days,
  time, duration, capacity, instructor, room), the published schedule window, the
  enrollment cutoff, and the pass policy.
- Enrollments persist to `data/enrollments.json` (file-based, no database). Seats
  are assigned as the lowest free number, so a released seat is reused.
- `SIGNING_SECRET` — **set this before selling anything real.** It mints the QR
  passes; anyone who knows it can forge a ticket. A dev default is baked in so the
  demo runs.
- `PUBLIC_BASE_URL` — set in production so QR codes resolve to your public origin
  rather than `localhost`.
- Payment addresses: `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS`
  (Solana). Both default to the suite's public receive addresses so the demo runs
  unconfigured — the server prints a reminder while the defaults are active.
- Facilitators are per-rail: `FACILITATOR_URL` (EVM, default x402.org) and
  `SOLANA_FACILITATOR_URL` (Solana, default PayAI). No public facilitator settles
  both chains.
- Mainnet: `NETWORK=base` + a production EVM `FACILITATOR_URL`. Solana defaults to
  mainnet; `SOLANA_NETWORK=devnet` switches it. Use a dedicated `SOLANA_RPC_URL`
  in production.

Seats are **non-refundable** once the pass is issued — unlike the refundable-hold
services elsewhere in the suite. The policy text customers see lives in
`passPolicy` and is returned with every schedule and every ticket.

All variables: [.env.example](.env.example)

## Human checkout

`public/index.html` is a studio-style checkout: browse the free timetable, tap a
class with seats left, pay with the drop-in
[`@three-ws/x402-payment-modal`](https://www.npmjs.com/package/@three-ws/x402-payment-modal)
(loaded from CDN), and the QR pass renders on screen with the seat number. The
modal reads the dual-rail 402 and offers **Phantom/Solflare/Backpack on Solana or
MetaMask on Base** automatically. It also brings **SIWX wallet re-entry** (a wallet
that already paid signs back in instead of reconnecting) and **client-side
spending caps** (per-call / hourly / daily), so a regular doesn't re-approve every
class.

The Solana browser path needs one small server route — Phantom signs serialized
transactions, so the SPL transfer has to be built somewhere. `src/checkout.ts`
mounts the package's own Express adapter at `/api/x402-checkout`; if the optional
peer deps aren't installed, that path degrades and the Base path keeps working.
Agent clients build their own transaction and never touch it.

## For AI agents

- **[skill.md](skill.md)** — agent-facing service description (endpoints, prices,
  schemas, both payment rails).
- **[/.well-known/x402](public/.well-known/x402)** — machine-readable manifest
  served by the app; indexable by [x402scan.com](https://x402scan.com), the x402
  Bazaar, and [agentic.market](https://agentic.market). Deploy publicly and
  submit your base URL to be discovered.
- **MCP**: wrap the endpoints as Claude tools in ~70 lines — see
  [examples/mcp-tool.md](examples/mcp-tool.md). The QR arrives as a data URI, so
  an assistant can show it inline.
- **Client**: [examples/agent-client.ts](examples/agent-client.ts) is the
  complete read-enroll-verify loop via `x402-fetch`, including a forged-pass
  rejection, with the Solana alternative documented inline.
- Agent guide: [docs/agents.md](docs/agents.md)

## Docs

Site: **<https://nirholas.github.io/x402-classes/>** · [Tutorial](docs/tutorial.md)
· [API reference](docs/api.md) · [For agents](docs/agents.md)

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, integration help, or a bug report: **nichxbt@gmail.com** — or open an
[issue](https://github.com/nirholas/x402-classes/issues).

## License

[Apache-2.0](LICENSE)
