import "server-only";
import { createPublicKey, verify } from "node:crypto";

const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

export function verifyTelnyxWebhook(rawBody: string, timestamp: string | null, signature: string | null) {
  const configuredKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!configuredKey || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300)
    return false;

  try {
    const publicKey = configuredKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(configuredKey)
      : createPublicKey({
          key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(configuredKey, "base64")]),
          format: "der",
          type: "spki",
        });
    return verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`, "utf8"),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
