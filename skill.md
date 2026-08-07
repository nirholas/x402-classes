# x402-classes

Self-hosted class and session booking server payable with x402 micropayments (USDC) — a fitness studio, dance school, or workshop host runs it themselves and sells seats one class at a time, to AI agents and humans alike. The schedule is **free** to read (it is the shop window); a seat costs $0.05 and the payment returns the whole ticket in the 200 body: the assigned seat number, full class details, a base64 ICS calendar invite, and a **signed QR pass** the door can scan. Passes are HMAC-signed and self-contained, so they can be validated offline or through this server's free `/verify` endpoint.

**Base URL**: `https://YOUR-DEPLOYMENT.example.com` (self-hosted — each studio runs its own instance)

**Machine-readable manifest**: `GET /.well-known/x402` (free)

## Class ids

A recurring class in `config/classes.json` (e.g. `vinyasa-am`, running Mon/Wed/Fri) is expanded into concrete sessions. A session's `classId` is `<templateId>@<YYYY-MM-DD>`, for example `vinyasa-am@2026-08-10`. That is the id you enroll against.

## Endpoints

### GET /schedule — free

The class calendar with live seat counts.

Query params (all optional):
- `class` — template id, restrict to one class
- `date` — `YYYY-MM-DD`, restrict to one day
- `days` — integer, scan window (max = configured `scheduleWindowDays`)

Response:
```json
{
  "studio": { "name": "Studio 402", "timezone": "America/New_York", "address": "…" },
  "passPolicy": { "seatPrice": "$0.05", "description": "…" },
  "enrollmentClosesMinutes": 15,
  "generatedAt": "2026-08-07T18:00:00.000Z",
  "classes": [{ "id": "vinyasa-am", "name": "Morning Vinyasa", "instructor": "Ada Iyengar", "days": ["monday","wednesday","friday"], "time": "07:00", "durationMinutes": 60, "capacity": 18, "room": "Studio A" }],
  "sessions": [
    {
      "classId": "vinyasa-am@2026-08-10",
      "templateId": "vinyasa-am",
      "name": "Morning Vinyasa",
      "instructor": "Ada Iyengar",
      "room": "Studio A",
      "date": "2026-08-10", "time": "07:00", "endsAt": "08:00",
      "durationMinutes": 60,
      "capacity": 18, "seatsTaken": 3, "seatsLeft": 15,
      "enrollmentOpen": true,
      "startsAt": "2026-08-10T07:00:00.000Z"
    }
  ]
}
```

Errors: `404 UNKNOWN_CLASS`.

### POST /enroll/:classId — $0.05

Body:
```json
{ "name": "Ada Lovelace", "email": "ada@example.com" }
```

Response (the purchased artifact — the `pass` is the ticket):
```json
{
  "passId": "pass_1a2b3c4d5e6f",
  "seatNumber": 4,
  "classDetails": {
    "classId": "vinyasa-am@2026-08-10",
    "name": "Morning Vinyasa",
    "instructor": "Ada Iyengar",
    "description": "60 minutes of breath-led flow…",
    "room": "Studio A",
    "date": "2026-08-10", "time": "07:00", "endsAt": "08:00",
    "durationMinutes": 60,
    "startsAt": "2026-08-10T07:00:00.000Z",
    "studio": "Studio 402",
    "address": "402 Payment Ave, Studio 2, New York, NY 10001"
  },
  "holder": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "seatsLeftAfter": 14,
  "passPolicy": { "seatPrice": "$0.05", "description": "…" },
  "pass": {
    "token": "<base64url payload>.<hex HMAC>",
    "verifyUrl": "https://YOUR-DEPLOYMENT.example.com/verify/<token>",
    "verifyEndpoint": "GET /verify/<token>",
    "expiresAt": "2026-08-10T08:00:00.000Z",
    "qrSvgDataUri": "data:image/svg+xml;base64,… (scan or embed in <img src>)"
  },
  "ics": "QkVHSU46VkNBTEVOREFS… (base64 .ics file)",
  "issuedAt": "2026-08-07T18:00:01.000Z",
  "signature": "hex HMAC-SHA256 over the canonical artifact JSON"
}
```

Seats are assigned as the lowest free number, so a released seat is reused.

Errors: `400 INVALID_NAME`, `404 UNKNOWN_CLASS`, `409 CLASS_FULL|CLASS_STARTED|ENROLLMENT_CLOSED`.

### GET /verify/:token — free

Validate a pass at the door. Returns `200` with `{ valid: true, payload, status, session }`, or `400` with `{ valid: false, reason }` for a forged, altered, expired, or unknown pass.

### POST /check-in/:token — free

Same validation, then marks the pass `checked-in` and records `checkedInAt`. Re-scanning returns `alreadyCheckedIn: true` so double entry is visible rather than silent.

### Free routes

- `GET /schedule` — the calendar (above)
- `GET /classes/:classId` — one session with live seat counts
- `GET /roster/:classId` — seats sold: seat number, holder name, check-in status
- `GET /info` — studio profile, pass policy, prices, payment rails
- `GET /health` — liveness
- `GET /.well-known/x402` — this service's payment manifest

## Payment

**Pay in USDC on Base or Solana — your client picks the rail.** The paid route
answers an unpaid request with a `402` whose `accepts` array carries both rails;
choose the one your wallet can settle and ignore the other.

- Protocol: [x402](https://x402.org) (HTTP 402 Payment Required), `x402Version: 1`, scheme `exact`
- **EVM rail** — network `base-sepolia` (default; `NETWORK=base` for mainnet), asset USDC
  (`0x036CbD53842c5426634e7929541eC2318f3dCF7e` on base-sepolia), payTo
  `0x40252CFDF8B20Ed757D61ff157719F33Ec332402`
- **Solana rail** — network `solana` (`SOLANA_NETWORK=devnet` for `solana-devnet`), asset USDC
  (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`), payTo
  `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`
- Facilitators (one per rail — no public facilitator settles both chains):
  EVM `https://x402.org/facilitator` (`FACILITATOR_URL`), Solana
  `https://facilitator.payai.network` (`SOLANA_FACILITATOR_URL`)
- Flow: call the route → receive `402` + `accepts[]` → sign the USDC payment for one rail
  (EVM: EIP-3009 `transferWithAuthorization`; Solana: SPL `transferChecked`) → retry with the
  `X-PAYMENT` header → receive `200` + the artifact in the body + an
  `X-PAYMENT-RESPONSE` settlement receipt naming the rail and transaction.
- Clients: `x402-fetch` (EVM), `@three-ws/x402-payment-modal` (browser, both rails),
  or any x402-compatible client.
- Settlement happens only when the route returns `2xx`. A class that filled up between
  your `/schedule` read and your enrollment returns `409 CLASS_FULL` and costs you nothing.

Example 402 body:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "50000",
      "resource": "https://YOUR-DEPLOYMENT.example.com/enroll/vinyasa-am@2026-08-10",
      "mimeType": "application/json", "maxTimeoutSeconds": 300, "description": "Enroll in one class session…" },
    { "scheme": "exact", "network": "solana", "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "50000",
      "resource": "https://YOUR-DEPLOYMENT.example.com/enroll/vinyasa-am@2026-08-10",
      "mimeType": "application/json", "maxTimeoutSeconds": 300, "description": "Enroll in one class session…" }
  ]
}
```

## Enrollment guidance for agents

- `GET /schedule` is free — read it (or `GET /classes/:classId`) immediately before enrolling to see `seatsLeft` and `enrollmentOpen`.
- On `409 CLASS_FULL`, pick another session from the schedule rather than retrying.
- Enrollment is **not idempotent**: two `POST /enroll` calls buy two seats. Record `passId` before retrying a network failure.
- The seat is non-refundable once the pass is issued (see `passPolicy`). Read the policy from `/schedule` or `/info` before spending.
- Keep `pass.token` — it is the ticket. `qrSvgDataUri` is a rendering of `verifyUrl`, so the token alone is sufficient.

## Verifying signatures

`signature` fields and the pass token's trailing HMAC are HMAC-SHA256 (hex) over canonical JSON (sorted keys) using the server's `SIGNING_SECRET`. A pass token is `base64url(canonical payload) + "." + signature`, so a door scanner holding the secret can validate it with no network access. Without the secret, use `GET /verify/:token`.

## Contact

Questions, integration help, or a bug: **nichxbt@gmail.com** ·
[github.com/nirholas/x402-classes](https://github.com/nirholas/x402-classes)
