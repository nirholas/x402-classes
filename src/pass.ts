/**
 * Signed QR passes.
 *
 * A pass token is `base64url(canonical JSON payload) + "." + hex HMAC`. It is
 * self-contained: a door scanner with the signing secret can validate it
 * offline, and this server exposes a free `GET /verify/:token` for everyone
 * else. The QR image is rendered as an SVG data URI so the whole pass — payload,
 * signature, and scannable image — fits inside the 200 body of the paid call.
 */

import QRCode from "qrcode";
import { canonicalize, sign, verify } from "./sign.js";
import type { PassPayload } from "./types.js";

/** Encode a payload + signature into a compact, URL-safe token. */
export function encodePass(payload: PassPayload): string {
  const body = Buffer.from(canonicalize(payload), "utf8").toString("base64url");
  return `${body}.${sign(payload)}`;
}

export interface DecodedPass {
  valid: boolean;
  reason?: string;
  payload?: PassPayload;
}

/** Decode and authenticate a pass token. Never throws. */
export function decodePass(token: string): DecodedPass {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return { valid: false, reason: "malformed token" };
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  let payload: PassPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PassPayload;
  } catch {
    return { valid: false, reason: "payload is not valid JSON" };
  }
  if (!/^[0-9a-f]+$/i.test(signature) || !verify(payload, signature)) {
    return { valid: false, reason: "signature does not match — pass was altered or forged" };
  }
  if (Date.parse(payload.expiresAt) < Date.now()) {
    return { valid: false, reason: "pass expired", payload };
  }
  return { valid: true, payload };
}

/**
 * Render the pass as a QR code SVG data URI.
 * The QR encodes the verification URL so any phone camera resolves it.
 */
export async function qrDataUri(verifyUrl: string): Promise<string> {
  const svg = await QRCode.toString(verifyUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
