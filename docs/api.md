# API reference

Base URL: your deployment (default `http://localhost:4023`). Machine-readable
spec: [`openapi.json`](https://github.com/nirholas/x402-classes/blob/main/openapi.json).
Only one route is paid — the seat. Everything else, including the whole
timetable, is free. The paid route returns `402 Payment Required` until called
with a valid `X-PAYMENT` header, and its successful response carries an
`X-PAYMENT-RESPONSE` settlement receipt header.

## Class ids

Recurring templates in `config/classes.json` are expanded into concrete
sessions. A session's `classId` is `<templateId>@<YYYY-MM-DD>`, e.g.
`vinyasa-am@2026-08-10`.

---

## GET /schedule — free

The class calendar with live seat counts.

| Param | Type | Notes |
|---|---|---|
| `class` | string | Template id (e.g. `vinyasa-am`). Omit for every class. |
| `date` | `YYYY-MM-DD` | Restrict to one day. |
| `days` | integer | Days to scan when no `date` is given. Capped at `scheduleWindowDays`. |

**200**

```json
{
  "studio": { "name": "Studio 402", "timezone": "America/New_York", "address": "402 Payment Ave, Studio 2" },
  "passPolicy": { "seatPrice": "$0.05", "description": "…" },
  "enrollmentClosesMinutes": 15,
  "generatedAt": "2026-08-07T18:00:00.000Z",
  "classes": [
    { "id": "vinyasa-am", "name": "Morning Vinyasa", "instructor": "Ada Iyengar", "days": ["monday","wednesday","friday"], "time": "07:00", "durationMinutes": 60, "capacity": 18, "room": "Studio A" }
  ],
  "sessions": [
    {
      "classId": "vinyasa-am@2026-08-10",
      "templateId": "vinyasa-am",
      "name": "Morning Vinyasa",
      "instructor": "Ada Iyengar",
      "description": "60 minutes of breath-led flow…",
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

`enrollmentOpen` is `false` once the class is full or the
`enrollmentClosesMinutes` cutoff has passed.

**Errors**: `404 UNKNOWN_CLASS`.

---

## POST /enroll/:classId — $0.05

Assigns the lowest free seat and returns the ticket in the same response.

**Body**

```json
{ "name": "Ada Lovelace", "email": "ada@example.com" }
```

`name` is required; `email` is optional. The payer wallet comes from the settled
payment (or the `X-Payer-Address` header) and is recorded on the enrollment.

**200 — the purchased artifact**

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
    "verifyUrl": "https://studio.example.com/verify/<token>",
    "verifyEndpoint": "GET /verify/<token>",
    "expiresAt": "2026-08-10T08:00:00.000Z",
    "qrSvgDataUri": "data:image/svg+xml;base64,PD94bWw…"
  },
  "ics": "QkVHSU46VkNBTEVOREFS… (base64 .ics)",
  "issuedAt": "2026-08-07T18:00:01.000Z",
  "signature": "hex HMAC-SHA256"
}
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_NAME` | `name` missing or not a string |
| 402 | — | payment missing/invalid |
| 404 | `UNKNOWN_CLASS` | no such session — check `/schedule` |
| 409 | `CLASS_FULL` | every seat is sold |
| 409 | `CLASS_STARTED` | the class has already begun |
| 409 | `ENROLLMENT_CLOSED` | inside the `enrollmentClosesMinutes` cutoff |

None of the `4xx` cases charge the caller: settlement is deferred until the
handler returns `2xx`.

---

## GET /verify/:token — free

What the door does when it scans the QR.

**200** — valid pass:

```json
{
  "valid": true,
  "payload": { "passId": "pass_…", "classId": "vinyasa-am@2026-08-10", "seatNumber": 4, "holder": "Ada Lovelace", "startsAt": "…", "expiresAt": "…", "studio": "Studio 402" },
  "status": "valid",
  "session": { "classId": "…", "seatsLeft": 14, "…": "…" },
  "checkedAt": "2026-08-10T06:58:00.000Z"
}
```

**400** — rejected, with the reason:

| `reason` | Cause |
|---|---|
| `malformed token` | not `payload.signature` |
| `payload is not valid JSON` | corrupt token |
| `signature does not match — pass was altered or forged` | HMAC mismatch |
| `pass expired` | past `expiresAt` (the class has ended) |
| `signature is good but this pass is not on the roster…` | valid HMAC, no enrollment record |

## POST /check-in/:token — free

Same validation, then marks the pass `checked-in` and records `checkedInAt`.
A second scan returns `alreadyCheckedIn: true`, so double entry is visible rather
than silent.

---

## Free routes

| Route | Returns |
|---|---|
| `GET /schedule` | the calendar with live seat counts |
| `GET /classes/:classId` | one session with capacity, `seatsTaken`, `seatsLeft`, `enrollmentOpen` |
| `GET /roster/:classId` | seats sold: seat number, holder name, check-in status |
| `GET /verify/:token` | pass validation |
| `POST /check-in/:token` | pass validation + mark used |
| `GET /info` | studio profile, pass policy, prices, payment rails |
| `GET /health` | liveness |
| `GET /.well-known/x402` | x402 discovery manifest (resources, prices, schemas, both rails) |

---

## 402 response shape

The paid route answers an unpaid request with a `402` whose `accepts` array
carries **both payment rails**. Pick one, sign it, retry with `X-PAYMENT`.

```json
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
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "maxTimeoutSeconds": 300,
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
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxTimeoutSeconds": 300,
      "extra": { "rpcUrl": "https://api.mainnet-beta.solana.com" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `network` | `base-sepolia`/`base` = EVM rail; `solana`/`solana-devnet` = SVM rail |
| `maxAmountRequired` | price in atomic USDC units (6 decimals) — `50000` = $0.05 |
| `asset` | USDC contract address (EVM) or SPL mint (Solana) |
| `payTo` | merchant receive address on that network |
| `extra` | EVM: the EIP-712 domain to sign against. Solana: the RPC to build against. |

Configure the rails with `NETWORK` / `PAY_TO_ADDRESS` / `FACILITATOR_URL` (EVM)
and `SOLANA_NETWORK` / `SOLANA_PAY_TO_ADDRESS` / `SOLANA_RPC_URL` /
`SOLANA_FACILITATOR_URL` (Solana). Each rail settles through its own facilitator
because no public one handles both chains. Drop an address and that rail is
omitted from every challenge.

## Settlement receipt

A successful paid call returns `X-PAYMENT-RESPONSE`: base64 JSON of
`{ success, transaction, network, payer }`. `network` tells you which rail
settled. Settlement is deferred until the handler returns `2xx` — an error
response (e.g. `409 CLASS_FULL`) never moves funds.

## Contact

**nichxbt@gmail.com** · [issues](https://github.com/nirholas/x402-classes/issues)
