---
name: class-booking-api
description: Read a class schedule for free and buy a seat with a signed pass through a self-hosted x402-classes server. Use when an agent enrolls a person in a fitness, dance or workshop session.
---

# x402-classes

A studio runs this itself. Classes come from `config/classes.json`
(`CLASSES_CONFIG`) and recurring templates expand to concrete sessions whose id
is `<templateId>@<YYYY-MM-DD>`, for example `vinyasa-am@2026-08-10`. Data lives
under `DATA_DIR` and `SIGNING_SECRET` signs passes.

## Run the server

It is a self-hosted Node server (Express, Node 18 or newer). Run it from a clone:

```bash
git clone https://github.com/nirholas/x402-classes && cd x402-classes
npm install
cp .env.example .env     # then adjust; see the comments in the file
npm run dev              # tsx src/server.ts, listens on PORT (default 4023)
```

`npm run build` then `npm start` runs the compiled server. `npm run client`
runs `examples/agent-client.ts`, a reference paying client. Set `PAY_TO_ADDRESS`
and `SOLANA_PAY_TO_ADDRESS` to your own wallets to be paid yourself.

## Routes

| Route | Price | Notes |
| --- | --- | --- |
| `GET /schedule` | free | optional `class`, `date`, `days` |
| `GET /classes/:classId` | free | one session with live seat counts |
| `GET /roster/:classId` | free | seats sold and check-in status |
| `POST /enroll/:classId` | $0.05 | body `name`, `email`; returns the signed pass |
| `GET /verify/:token` | free | verify a pass |
| `POST /check-in/:token` | free | mark a pass checked in |
| `GET /info` | free | studio profile, pass policy, prices, rails |
| `GET /health`, `GET /.well-known/x402` | free | |

The enroll response holds `passId`, `seatNumber`, `classDetails`, a base64 ICS
invite and a signed QR pass. If settlement fails after a seat is assigned, the
seat is released.

Read `GET /schedule` or `GET /classes/:classId` immediately before enrolling to
check `seatsLeft` and `enrollmentOpen`.

## Example

```bash
curl -s "http://localhost:4023/schedule?days=7"
curl -i -X POST http://localhost:4023/enroll/vinyasa-am@2026-08-10 -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}'   # 402 first, then pay and retry
```

## Paying (x402)

Paid routes follow the x402 protocol. An unpaid call returns HTTP 402 with an
`accepts` array listing USDC on Base and USDC on Solana. Sign for one rail,
retry with the base64 payload in the `X-PAYMENT` header, and the 200 body
carries the result; the settlement receipt is in the `X-PAYMENT-RESPONSE`
header. Clients: `x402-fetch` (EVM), `@three-ws/x402-payment-modal` (browser,
both rails), or any x402 client. The rail networks are chosen by `NETWORK`
(EVM, `base-sepolia` by default) and `SOLANA_NETWORK` in `.env`; see
`.env.example`. Settlement moves real USDC on the chosen network: show the user
the recipient, amount and network and get an explicit yes before every paid call.
