import "server-only";
import { decrypt } from "@/lib/crypto";

export function normalizeTelnyxApiKey(value: string) {
  let normalized = value.trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    normalized = normalized.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted).trim();
    normalized = normalized
      .replace(/^Authorization\s*:\s*/i, "")
      .replace(/^Bearer\s+/i, "")
      .replace(/^TELNYX_API_KEY\s*=\s*/i, "")
      .trim();
  }
  return normalized;
}

export function decryptTelnyxApiKey(encryptedValue: string) {
  return normalizeTelnyxApiKey(decrypt(encryptedValue));
}
