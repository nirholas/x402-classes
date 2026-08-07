# For AI agents

x402-classes is built agent-first: no signup, no API key, no OAuth dance. The
timetable is free to read, so an agent can plan without spending anything; if it
then decides to commit, one $0.05 payment buys a seat and returns the ticket.

## Discovery

Two machine-readable entry points, both free:

1. **`GET /.well-known/x402`** — the x402 manifest: the paid resource, its price,
   both `accepts` rails, output schema, plus every free route. This is the format
   indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and
   [agentic.market](https://agentic.market).
2. **[`skill.md`](https://github.com/nirholas/x402-classes/blob/main/skill.md)**
   (repo root) — a prose+schema skill file (the agentres.dev pattern) an LLM can
   read directly to learn endpoints, prices, request shapes, and error codes.

Recommended agent bootstrap: fetch `/.well-known/x402`, feed `skill.md` into
context, read `GET /schedule` (free), then enroll.

## Protocol version

This service speaks **x402 v1**. Every challenge is
`{ x402Version: 1, error, accepts: [...] }`, and each `accepts[]` entry carries
`outputSchema.input` (how to call the route) and `outputSchema.output` (what
comes back), generated from `openapi.json` so the two can never drift.

Discovery audits flag v1 as the older wire format; that is expected. x402 **v2**
— payment options under `extensions.bazaar.schema` and CAIP-2 network ids — is a
planned upgrade for agentcash compatibility. It is not adopted yet because the
v2 challenge shape would break the v1 `x402-fetch` clients this repo ships as
working examples.

## Class ids

Recurring classes are expanded into sessions. A session's `classId` is
`<templateId>@<YYYY-MM-DD>` — e.g. `vinyasa-am@2026-08-10`. Never construct one
by hand; take it from `/schedule`, which also tells you `seatsLeft` and
`enrollmentOpen`.

## Two payment rails

The paid route answers an unpaid request with a `402` whose `accepts` array holds
**both** rails. Your agent picks whichever it can settle:

| Rail | `network` | Asset | payTo | How the client signs |
|---|---|---|---|---|
| EVM | `base-sepolia` (default) / `base` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | EIP-3009 `transferWithAuthorization` — pure client-side signature |
| Solana | `solana` (default) / `solana-devnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | SPL `transferChecked`, signed as a serialized transaction |

Each rail is verified and settled by its own facilitator — no public
facilitator settles both chains, so the EVM rail defaults to
`https://x402.org/facilitator` and the Solana rail to
`https://facilitator.payai.network` (both overridable). The
`X-PAYMENT-RESPONSE` receipt names the rail the payment actually settled on. Ignore the entry you can't pay; the server
does not care which one you choose.

Settlement is deferred until the handler returns `2xx`, so an enrollment that
fails (`409 CLASS_FULL`) costs your agent nothing.

## Paying

Any x402 client works. With `x402-fetch` (EVM rail):

```ts
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(KEY));
const res = await payFetch(`${BASE}/enroll/${classId}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Agent Ada" }),
});
const ticket = await res.json();                          // seat + pass + ics
const receipt = decodeXPaymentResponse(res.headers.get("x-payment-response")!); // on-chain receipt
```

The client handles the 402 → sign → retry loop automatically. Cap per-call spend
with the `maxValue` argument.

On the **Solana rail**, pick the `accepts[]` entry whose `network` starts with
`solana`, build an SPL `transferChecked` to its `payTo` for `maxAmountRequired`
atomic units of the `asset` mint (USDC, 6 decimals), sign it, and send the base64
x402 envelope in `X-PAYMENT`. Browser agents can reuse the checkout helper this
server mounts at `POST /api/x402-checkout?action=prepare` (build) and
`?action=encode` (wrap) — see
[`examples/agent-client.ts`](https://github.com/nirholas/x402-classes/blob/main/examples/agent-client.ts).

## What you get back (and should persist)

| Field | Why it matters |
|---|---|
| `passId` | canonical reference |
| `pass.token` | **the ticket** — a self-contained signed credential; anyone holding it can enter |
| `pass.qrSvgDataUri` | a QR of `pass.verifyUrl`, ready to render or save; derived from the token |
| `pass.expiresAt` | when the class ends and the pass stops validating |
| `seatNumber` | what the holder should sit in |
| `classDetails` | where and when to show up |
| `ics` | base64 calendar invite — attach to the user's calendar |
| `signature` | studio HMAC over the artifact — keep for dispute evidence |
| `X-PAYMENT-RESPONSE` header | settlement receipt (tx hash/signature + network) — your proof of payment, on either rail |

Treat `pass.token` like a bearer ticket: it grants entry, so don't log it into
shared transcripts.

## Enrollment policy for agents

- `GET /schedule` and `GET /classes/:classId` are free. Read one immediately
  before paying — seat counts move.
- On `409 CLASS_FULL`, choose another session from the schedule rather than
  retrying the same one.
- On `409 ENROLLMENT_CLOSED`, the cutoff has passed; there is no way in.
- Idempotency: enrolling twice buys two seats. Record `passId` before retrying
  network failures.
- **Seats are non-refundable** once the pass is issued — read `passPolicy` from
  the free `/schedule` before spending. This differs from the refundable-hold
  repos elsewhere in the suite.

## MCP integration

Expose the service as Claude tools (`get_schedule`, `enroll_in_class`,
`verify_pass`) with the wrapper in
[`examples/mcp-tool.md`](https://github.com/nirholas/x402-classes/blob/main/examples/mcp-tool.md),
including a `claude_desktop_config.json` snippet. Because the QR is returned as an
SVG data URI, an assistant can display it inline or write it to a file the user
scans at the door.

## Listing your deployment

Running a public instance? Get discovered:

- **x402scan.com** — indexes services exposing `/.well-known/x402`; submit your
  base URL.
- **x402 Bazaar** — the facilitator-side discovery list; keep the manifest's
  resource description and output schema accurate so listings are useful.
- **agentic.market** — agent-service marketplace; list the base URL and point at
  `skill.md`.

Set `PUBLIC_BASE_URL` so pass QR codes resolve to your public origin, and keep the
manifest served over HTTPS — indexers and agents will refuse plaintext payment
endpoints.

## Contact

**nichxbt@gmail.com**
