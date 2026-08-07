/**
 * Full agent flow against x402-classes:
 *   1. read the free manifest + schedule (the timetable costs nothing)
 *   2. pick a session with seats left
 *   3. pay $0.05 to enroll — the seat, ICS invite and signed QR pass come back
 *      in the same 200 response
 *   4. print the artifact + settlement receipt
 *   5. validate the pass through the free /verify endpoint
 *
 * Usage:
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4023 npx tsx examples/agent-client.ts
 *
 * The wallet needs base-sepolia USDC — faucet: https://faucet.circle.com
 *
 * ── Which rail? ────────────────────────────────────────────────────────────
 * Every 402 from this server carries BOTH rails in `accepts`:
 *   [0] network "base-sepolia" | "base"    USDC via EIP-3009 transferWithAuthorization
 *   [1] network "solana" | "solana-devnet" USDC via SPL transferChecked
 * `x402-fetch` (used below) picks the EVM entry automatically. The Solana
 * alternative is at the bottom of this file.
 */
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4023";
const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error("Set PRIVATE_KEY to a funded base-sepolia key (https://faucet.circle.com)");
  process.exit(1);
}

const account = privateKeyToAccount(pk as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

function receipt(res: Response): unknown {
  const header = res.headers.get("x-payment-response");
  return header ? decodeXPaymentResponse(header) : null;
}

// 1. free discovery — no payment needed to see what's on
const manifest = await fetch(`${BASE_URL}/.well-known/x402`).then((r) => r.json());
console.log("Manifest:", manifest.name, "-", manifest.description);
console.log("Rails:", manifest.payment.rails.map((r: { network: string }) => r.network).join(" | "), "\n");

const schedule = await fetch(`${BASE_URL}/schedule?days=7`).then((r) => r.json());
console.log(`${schedule.studio.name} — ${schedule.sessions.length} sessions in the next 7 days`);
console.log(`Seat price: ${schedule.passPolicy.seatPrice}\n`);

// 2. pick the first session that still has room and is still open
const session = schedule.sessions.find(
  (s: { seatsLeft: number; enrollmentOpen: boolean }) => s.seatsLeft > 0 && s.enrollmentOpen,
);
if (!session) throw new Error("nothing bookable in that window — widen the search");
console.log(
  `Enrolling in ${session.name} (${session.classId}) — ${session.date} ${session.time}, ${session.seatsLeft} seats left\n`,
);

// 3. paid enrollment
const res = await payFetch(`${BASE_URL}/enroll/${encodeURIComponent(session.classId)}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payer-address": account.address },
  body: JSON.stringify({ name: "Agent Ada", email: "agent@example.com" }),
});
if (!res.ok) throw new Error(`enrollment failed: ${res.status} ${await res.text()}`);
const ticket = await res.json();

// 4. the purchased artifact
console.log("=== ENROLLMENT ARTIFACT ===");
console.log(
  JSON.stringify(
    {
      ...ticket,
      ics: `${ticket.ics.slice(0, 40)}...`,
      pass: { ...ticket.pass, qrSvgDataUri: `${ticket.pass.qrSvgDataUri.slice(0, 48)}...` },
    },
    null,
    2,
  ),
);
console.log("\nX-PAYMENT-RESPONSE settlement receipt:");
console.log(receipt(res));

console.log(`\nSeat ${ticket.seatNumber} of ${session.capacity}. Pass expires ${ticket.pass.expiresAt}.`);

// Save the two things worth keeping: the calendar invite and the QR image.
writeFileSync(`${ticket.passId}.ics`, Buffer.from(ticket.ics, "base64"));
writeFileSync(
  `${ticket.passId}.svg`,
  Buffer.from(ticket.pass.qrSvgDataUri.split(",")[1], "base64"),
);
console.log(`Wrote ${ticket.passId}.ics and ${ticket.passId}.svg`);

// 5. free verification — what the door does when it scans the QR
const check = await fetch(ticket.pass.verifyUrl).then((r) => r.json());
console.log("\n=== PASS VERIFICATION (free) ===");
console.log(JSON.stringify({ valid: check.valid, status: check.status, payload: check.payload }, null, 2));

// Tampering is detected: flip the last byte of the signature.
const forged = ticket.pass.token.slice(0, -2) + (ticket.pass.token.endsWith("ff") ? "00" : "ff");
const forgedCheck = await fetch(`${BASE_URL}/verify/${forged}`).then((r) => r.json());
console.log("\nForged pass:", forgedCheck.valid, "-", forgedCheck.reason);

// ─────────────────────────────────────────────────────────────────────────────
// Paying on the SOLANA rail instead
// ─────────────────────────────────────────────────────────────────────────────
//
// `x402-fetch` signs the EVM entry. To settle in USDC on Solana, read the same
// 402 body and act on the `solana` entry:
//
//   const res = await fetch(`${BASE_URL}/enroll/${classId}`, { method: "POST" });
//   const { accepts } = await res.json();
//   const sol = accepts.find((a) => a.network.startsWith("solana"));
//   // sol = { scheme: "exact", network: "solana",
//   //         asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",   // USDC mint
//   //         payTo: "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
//   //         maxAmountRequired: "50000",                              // 0.05 USDC, 6dp
//   //         extra: { rpcUrl: "https://api.mainnet-beta.solana.com" } }
//
// Build an SPL `transferChecked` of `maxAmountRequired` units of `asset` to
// `payTo`, sign it with your Solana keypair, then base64 the x402 envelope into
// `X-PAYMENT` and retry. Verification and settlement happen server-side through
// the same x402 facilitator either way.
//
// Browser clients can reuse the checkout helper this server mounts at
// `POST /api/x402-checkout?action=prepare` (build the transaction) and
// `?action=encode` (wrap the signed transaction into the X-PAYMENT envelope).
//
// ── Raw dual-rail 402, for reference ────────────────────────────────────────
//
//   $ curl -s -X POST http://localhost:4023/enroll/vinyasa-am@2026-08-10 \
//       | jq '.accepts[] | {network, payTo, asset}'
//   { "network": "base-sepolia",
//     "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
//     "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }
//   { "network": "solana",
//     "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
//     "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }
