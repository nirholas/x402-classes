# Raw HTTP walkthrough: 402 → pay → 200

x402 is plain HTTP. Here is the exact wire flow with `curl` against a local
server (`npm run dev` — it ships with working default receive addresses).

## 1. The schedule is free

```bash
curl -s "http://localhost:4023/schedule?days=7" | jq '.sessions[] | {classId, name, time, seatsLeft}'
curl -s http://localhost:4023/.well-known/x402 | jq
```

The timetable is the shop window, so it costs nothing. Only the seat is paid.
Grab a `classId` — they look like `vinyasa-am@2026-08-10`.

## 2. Calling the paid route without payment → HTTP 402

```bash
curl -si -X POST "http://localhost:4023/enroll/vinyasa-am@2026-08-10" \
  -H 'content-type: application/json' -d '{"name":"Ada"}'
```

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "50000",
      "resource": "http://localhost:4023/enroll/vinyasa-am@2026-08-10",
      "description": "Enroll in one class session…",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 300,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "50000",
      "resource": "http://localhost:4023/enroll/vinyasa-am@2026-08-10",
      "description": "Enroll in one class session…",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 300,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "rpcUrl": "https://api.mainnet-beta.solana.com" }
    }
  ]
}
```

Two entries, two rails: **USDC on Base** and **USDC on Solana**. `50000` is
0.05 USDC in atomic units (6 decimals). Pick one, ignore the other.

```bash
# just the rails:
curl -s -X POST "http://localhost:4023/enroll/vinyasa-am@2026-08-10" \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 3. Pay: sign the requirement, retry with X-PAYMENT

**Base rail:** the client signs an EIP-3009 `transferWithAuthorization` for the
amount in the `base-sepolia` entry and base64-encodes the signed payload into one
header.

**Solana rail:** the client builds an SPL `transferChecked` of `50000` USDC atomic
units to the `solana` entry's `payTo`, signs the serialized transaction, and
base64-encodes that envelope into the same header.

Either way it is one header. Doing it by hand is miserable — use the client
instead:

```bash
PRIVATE_KEY=0x... npm run client        # runs examples/agent-client.ts
```

Under the hood it retries:

```
POST /enroll/vinyasa-am@2026-08-10
X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLC...
Content-Type: application/json

{"name":"Ada Lovelace","email":"ada@example.com"}
```

## 4. 200 + the ticket + settlement receipt

```
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4YWJjLi4uIiwibmV0d29yayI6ImJhc2Utc2Vwb2xpYSJ9
Content-Type: application/json

{
  "passId": "pass_1a2b3c4d5e6f",
  "seatNumber": 4,
  "classDetails": { "name": "Morning Vinyasa", "room": "Studio A", "date": "2026-08-10", "time": "07:00", ... },
  "pass": {
    "token": "eyJjbGFzc0lkIjoi….a91f…",
    "verifyUrl": "http://localhost:4023/verify/eyJjbGFzc0lkIjoi….a91f…",
    "expiresAt": "2026-08-10T08:00:00.000Z",
    "qrSvgDataUri": "data:image/svg+xml;base64,PD94bWw…"
  },
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "signature": "…"
}
```

`X-PAYMENT-RESPONSE` base64-decodes to the settlement result — `{ success,
transaction, network, payer }`. The `network` field tells you which rail actually
settled. That is your on-chain receipt.

Settlement runs *after* the handler succeeds: if the class filled up in the
meantime you get `409 CLASS_FULL` and no money moves.

## 5. Use the pass

```bash
# what the door does when it scans the QR (free):
curl -s "http://localhost:4023/verify/$TOKEN" | jq

# mark it used (free):
curl -s -X POST "http://localhost:4023/check-in/$TOKEN" | jq '.status, .checkedInAt'

# who is coming (free):
curl -s "http://localhost:4023/roster/vinyasa-am@2026-08-10" | jq
```

Tampering is detectable without any server call — the token is
`base64url(payload).hexHMAC`, so a scanner holding `SIGNING_SECRET` validates it
offline. Flip one character and `/verify` answers
`{"valid":false,"reason":"signature does not match — pass was altered or forged"}`.

## 6. Save the artifacts

```bash
jq -r .ics ticket.json | base64 -d > class.ics
jq -r '.pass.qrSvgDataUri | split(",")[1]' ticket.json | base64 -d > pass.svg
```
