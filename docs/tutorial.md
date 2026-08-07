# Tutorial — from zero to a scanned QR pass

This walkthrough takes you from clone to a paid class seat with a working QR
pass, using real x402 payments — **USDC on Base Sepolia or on Solana**, your
choice.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-classes
cd x402-classes
npm install
```

Requirements: Node 18+.

## 2. Configure

The server runs unconfigured — `.env.example` ships with the suite's public
receive addresses on both rails, and the startup banner reminds you they're the
defaults. To take the money yourself, copy the template and set both:

```bash
cp .env.example .env
# edit .env →
#   PAY_TO_ADDRESS=0xYourBaseAddress            (EVM rail)
#   SOLANA_PAY_TO_ADDRESS=YourSolanaAddress     (Solana rail)
```

You can also run one rail only: drop an address and that rail is omitted from
every 402 (the server logs which one it skipped).

Describe your real timetable in `config/classes.json`:

- `studio` — name, description, timezone, address, phone
- `classes` — recurring templates: `id`, `name`, `instructor`, `description`,
  the `days` it runs on, `time`, `durationMinutes`, `capacity`, `room`
- `scheduleWindowDays` — how far ahead the calendar is published
- `enrollmentClosesMinutes` — how long before a class starts enrollment shuts
- `passPolicy` — seat price and the wording customers see

Each template is expanded into concrete sessions. A session's `classId` is
`<templateId>@<YYYY-MM-DD>` — e.g. `vinyasa-am@2026-08-10`. That is what you
enroll against.

**Set `SIGNING_SECRET` before you sell anything real.** It signs the QR passes;
anyone who knows it can mint valid passes, and anyone who has it can validate
passes offline at the door.

## 3. Run the server

```bash
npm run dev
```

You'll see the banner with the paid route, its price, and both rails. Sanity
checks:

```bash
curl -s http://localhost:4023/health | jq
curl -s "http://localhost:4023/schedule?days=3" | jq '.sessions[] | {classId, name, time, seatsLeft}'
curl -s http://localhost:4023/.well-known/x402 | jq
```

Note that `/schedule` needs no payment. The calendar is the shop window.

## 4. Your first 402

Call the paid route without paying:

```bash
curl -si -X POST "http://localhost:4023/enroll/vinyasa-am@2026-08-10" \
  -H 'content-type: application/json' -d '{"name":"Ada"}' | head -20
```

You get `HTTP/1.1 402 Payment Required` and a JSON body whose `accepts[]` array
has **two entries** — one per rail:

```bash
curl -s -X POST "http://localhost:4023/enroll/vinyasa-am@2026-08-10" \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

```json
{ "network": "base-sepolia", "payTo": "0x40252CFD…", "asset": "0x036CbD53…", "maxAmountRequired": "50000" }
{ "network": "solana",       "payTo": "WwwuGbqH…",  "asset": "EPjFWdd5…",  "maxAmountRequired": "50000" }
```

Each entry states the exact amount (atomic USDC units, 6 decimals), the token
address, the recipient, and the network. This is the whole protocol: the 402 *is*
the price list, and it quotes in two currencies of the same dollar.

## 5. Fund a client wallet

**Base rail (what the bundled client uses):** create a throwaway key (e.g.
`openssl rand -hex 32` prefixed with `0x`, or export one from a test wallet) and
fund it with **Base Sepolia USDC** from <https://faucet.circle.com>. A few cents'
worth is plenty.

**Solana rail:** any wallet holding USDC works — Phantom in the browser demo, or
a keypair in an agent. Set `SOLANA_NETWORK=devnet` to test against devnet USDC
instead of mainnet.

## 6. Buy a seat

```bash
PRIVATE_KEY=0xYourFundedKey npm run client
```

`examples/agent-client.ts` will:

1. read the free manifest and schedule,
2. pick the first session with seats left and enrollment still open,
3. pay **$0.05** for `POST /enroll/:classId`,
4. print the artifact — seat number, class details, pass token, verification URL
   — plus the decoded `X-PAYMENT-RESPONSE` settlement receipt, which names the
   rail and the transaction,
5. write `<passId>.ics` and `<passId>.svg` to disk,
6. validate the pass through the free `/verify` endpoint — then flip one
   character of the signature and show the forgery being rejected.

## 7. Reading the artifact

Everything you paid for is in the 200 body:

- `seatNumber` — assigned as the lowest free seat, so released seats are reused.
- `classDetails` — everything needed to show up: name, instructor, room, date,
  time, duration, studio address.
- `pass.token` — **the ticket**. `base64url(canonical payload) + "." + hex HMAC`.
- `pass.qrSvgDataUri` — a QR of `pass.verifyUrl`, ready to drop into
  `<img src="…">` or save as an `.svg`.
- `pass.expiresAt` — when the class ends; `/verify` refuses the pass after that.
- `ics` — base64 `.ics`; `Buffer.from(ics, "base64")` and save to import into any
  calendar.
- `signature` — HMAC-SHA256 over the canonical artifact JSON; tamper-evidence for
  disputes.

## 8. Working the door

```bash
TOKEN=$(jq -r .pass.token ticket.json)

# scan → validate
curl -s "http://localhost:4023/verify/$TOKEN" | jq '{valid, status, payload}'

# admit → mark used
curl -s -X POST "http://localhost:4023/check-in/$TOKEN" | jq '{status, checkedInAt}'

# re-scan the same pass
curl -s -X POST "http://localhost:4023/check-in/$TOKEN" | jq '.alreadyCheckedIn'
```

A door scanner that holds `SIGNING_SECRET` doesn't need the network at all: the
token carries its own signed payload, so it can be validated offline and
reconciled later against `GET /roster/:classId`.

## 9. The human checkout

Open <http://localhost:4023> — a studio-style page using the drop-in
`@three-ws/x402-payment-modal`. Browse the free timetable, tap a class with seats
left, pay from a browser wallet — **Phantom / Solflare / Backpack on Solana, or
MetaMask on Base** — and the QR pass renders on screen with the seat number.
The modal reads the dual-rail 402 and offers the wallets it detects; SIWX
re-entry means a regular signs in instead of reconnecting, and spending caps
bound what the page can charge.

The Solana browser path needs one server route (Phantom signs serialized
transactions, so the SPL transfer has to be built server-side). `src/checkout.ts`
mounts it at `/api/x402-checkout`; if its optional peer deps are missing the
banner says `Solana browser checkout: disabled` and the Base path still works.
Agent clients paying on Solana never touch that route — they build their own
transaction, and verification/settlement go through the rail's facilitator
either way.

## 10. Going to mainnet

1. Set `NETWORK=base` (the Solana rail already defaults to mainnet — set
   `SOLANA_NETWORK=devnet` if you want it on devnet instead).
2. Point `FACILITATOR_URL` at a production facilitator for Base (e.g. Coinbase
   Developer Platform's x402 facilitator). The Solana rail settles through
   `SOLANA_FACILITATOR_URL`, which defaults to PayAI's
   (`https://facilitator.payai.network`) — no public facilitator handles both
   chains.
3. Replace the public Solana RPC: set `SOLANA_RPC_URL` to a dedicated endpoint
   (Helius / Triton / QuickNode). The default is rate-limited and will fail
   under load.
4. Set a strong `SIGNING_SECRET` — this one matters more here than anywhere else
   in the suite, because it mints tickets.
5. Set `PUBLIC_BASE_URL` so the QR codes point at your real origin, not
   `localhost`.
6. Use real merchant wallets for `PAY_TO_ADDRESS` **and**
   `SOLANA_PAY_TO_ADDRESS`.
7. Deploy behind HTTPS (agents will refuse to pay plaintext endpoints) and keep
   `data/` on a persistent volume.

Prices stay in dollar strings (`$0.05`) — the paywall converts to atomic USDC on
whichever network the client picks.
