import "dotenv/config";
import express from "express";
import { CHECKOUT_PATH, mountSolanaCheckout } from "./checkout.js";
import {
  EVM_NETWORK,
  EVM_PAY_TO,
  SOLANA_NETWORK,
  SOLANA_PAY_TO,
  USING_DEFAULT_PAY_TO,
  paywall,
  railSummary,
  type RouteMap,
} from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import {
  ClassError,
  checkIn,
  config,
  enroll,
  getSchedule,
  getSession,
  releaseSeat,
  roster,
  verifyPass,
} from "./service.js";

const PORT = Number(process.env.PORT || 4023);

export const PRICES = {
  enroll: "$0.05",
} as const;

/** Paid routes. Anything not listed here is free — /schedule included. */
const routes: RouteMap = {
  "POST /enroll/:classId": {
    price: PRICES.enroll,
    description:
      "Enroll in one class session. Returns the seat number, full class details, a base64 ICS calendar invite and a signed QR pass usable at the door",
    // Request/response schemas mirror openapi.json — see src/schemas.ts.
    ...ROUTE_SCHEMAS["POST /enroll/:classId"],
  },
};

const app = express();
app.use(express.json());
// Solana browser checkout for public/index.html (EVM needs no server help).
const solanaCheckout = await mountSolanaCheckout(app);
app.use(paywall(routes, { baseUrl: process.env.PUBLIC_BASE_URL }));
app.use(
  express.static("public", {
    setHeaders: (res, p) => {
      if (p.endsWith("/.well-known/x402")) res.setHeader("Content-Type", "application/json");
    },
  }),
);

function origin(req: express.Request): string {
  return (
    process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get("host") ?? `localhost:${PORT}`}`
  );
}

// ---- free routes -----------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x402-classes", studio: config.studio.name });
});

/** Free by design (spec): the calendar is the shop window, the seat is the product. */
app.get("/schedule", (req, res) => {
  try {
    res.json(
      getSchedule({
        class: typeof req.query.class === "string" ? req.query.class : undefined,
        date: typeof req.query.date === "string" ? req.query.date : undefined,
        days: req.query.days ? Number(req.query.days) : undefined,
      }),
    );
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/classes/:classId", (req, res) => {
  const session = getSession(req.params.classId);
  if (!session) {
    res.status(404).json({ error: "UNKNOWN_CLASS", message: `no session ${req.params.classId}` });
    return;
  }
  res.json(session);
});

app.get("/roster/:classId", (req, res) => {
  try {
    res.json(roster(req.params.classId));
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/verify/:token", (req, res) => {
  const result = verifyPass(req.params.token);
  res.status(result.valid ? 200 : 400).json(result);
});

app.post("/check-in/:token", (req, res) => {
  const result = checkIn(req.params.token);
  res.status(result.valid ? 200 : 400).json(result);
});

app.get("/info", (_req, res) => {
  res.json({
    studio: config.studio,
    passPolicy: config.passPolicy,
    prices: PRICES,
    payment: {
      rails: [
        { rail: "evm", network: EVM_NETWORK, asset: "USDC", payTo: EVM_PAY_TO },
        { rail: "solana", network: SOLANA_NETWORK, asset: "USDC", payTo: SOLANA_PAY_TO },
      ],
    },
  });
});

// ---- paid route (payment enforced by the paywall above) -------------------

app.post("/enroll/:classId", async (req, res) => {
  try {
    const payer = req.header("x-payer-address") ?? res.locals.x402?.payer ?? req.body?.payerWallet;
    const artifact = await enroll(req.params.classId, {
      name: req.body?.name,
      email: req.body?.email,
      payerWallet: payer,
      baseUrl: origin(req),
    });
    // If settlement fails after this point, give the seat back.
    res.locals.x402Rollback = () => releaseSeat(artifact.passId);
    res.json(artifact);
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: express.Response): void {
  if (err instanceof ClassError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "INTERNAL", message: "unexpected error" });
}

app.listen(PORT, () => {
  console.log(`\n  x402-classes — ${config.studio.name}`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log("  Paid route — pay in USDC on Base or Solana, your client picks the rail:");
  console.log(`    POST /enroll/:classId   ${PRICES.enroll}  (seat + signed QR pass)`);
  console.log("  Free routes:");
  console.log("    GET  /schedule  /classes/:id  /roster/:id  /info  /health");
  console.log("    GET  /verify/:token     POST /check-in/:token");
  console.log("");
  for (const line of railSummary()) console.log(`  ${line}`);
  console.log(
    `  Solana browser checkout: ${solanaCheckout ? `mounted at ${CHECKOUT_PATH}` : "disabled"}`,
  );
  if (USING_DEFAULT_PAY_TO) {
    console.log(
      "  NOTE: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself",
    );
  }
  console.log(`  Manifest: http://localhost:${PORT}/.well-known/x402`);
  console.log(`  Demo:     http://localhost:${PORT}/\n`);
});
