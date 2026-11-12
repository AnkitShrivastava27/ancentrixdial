import "server-only";
import { createPublicKey, verify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export type TelnyxWebhookVerification =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_public_key"
        | "missing_signature_headers"
        | "invalid_timestamp"
        | "stale_timestamp"
        | "invalid_public_key"
        | "invalid_signature_format"
        | "signature_mismatch";
    };

function cleanConfiguredKey(value: string): string {
  let key = value.trim();

  // These two forms are common when copying a value from a .env file into
  // Render's environment-variable editor. Render itself does not need quotes.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  if (key.startsWith("TELNYX_PUBLIC_KEY=")) {
    key = key.slice("TELNYX_PUBLIC_KEY=".length).trim();
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))
    ) {
      key = key.slice(1, -1).trim();
    }
  }

  return key.replace(/\\n/g, "\n");
}

function decodeBase64(value: string): Buffer | null {
  const compact = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  try {
    const decoded = Buffer.from(compact, "base64");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function loadTelnyxPublicKey(configuredValue: string) {
  const value = cleanConfiguredKey(configuredValue);
  if (!value || /^(replace|your|base64-ed25519-public-key)/i.test(value)) {
    throw new Error("placeholder or empty key");
  }

  if (value.includes("-----BEGIN PUBLIC KEY-----")) {
    return createPublicKey(value);
  }

  // Telnyx normally displays the raw 32-byte Ed25519 public key as Base64.
  // Accept a 64-character hex key as a convenience for secret managers too.
  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    const rawKey = Buffer.from(value, "hex");
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
  }

  const decoded = decodeBase64(value);
  if (!decoded) throw new Error("public key is not valid Base64");

  if (decoded.length === 32) {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, decoded]),
      format: "der",
      type: "spki",
    });
  }

  // Also accept a Base64-encoded DER SubjectPublicKeyInfo (SPKI) key.
  if (decoded.length === 44) {
    return createPublicKey({ key: decoded, format: "der", type: "spki" });
  }

  throw new Error(`unexpected Ed25519 public key length: ${decoded.length} bytes`);
}

export function verifyTelnyxWebhook(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): TelnyxWebhookVerification {
  const configuredKey = process.env.TELNYX_PUBLIC_KEY;
  if (!configuredKey?.trim()) return { ok: false, reason: "missing_public_key" };
  if (!timestamp || !signature) {
    return { ok: false, reason: "missing_signature_headers" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  let publicKey;
  try {
    publicKey = loadTelnyxPublicKey(configuredKey);
  } catch (error) {
    // Log only the parsing reason, never the configured key value.
    console.error("TELNYX_PUBLIC_KEY is configured but cannot be parsed:",
      error instanceof Error ? error.message : "unknown key parsing error",
    );
    return { ok: false, reason: "invalid_public_key" };
  }

  const decodedSignature = decodeBase64(signature);
  if (!decodedSignature || decodedSignature.length !== 64) {
    return { ok: false, reason: "invalid_signature_format" };
  }

  try {
    const signedPayload = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    const valid = verify(null, signedPayload, publicKey, decodedSignature);
    return valid ? { ok: true } : { ok: false, reason: "signature_mismatch" };
  } catch {
    return { ok: false, reason: "signature_mismatch" };
  }
}
