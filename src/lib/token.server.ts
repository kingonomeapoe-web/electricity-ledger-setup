import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { normalizeToken } from "./token";

const KEY_ENV = "TOKEN_ENCRYPTION_KEY";
const HMAC_ENV = "TOKEN_FINGERPRINT_KEY";

function secret(name: string): Buffer {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for secure token handling.`);
  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length >= 44) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length >= 32) return decoded.subarray(0, 32);
  }
  return createHmac("sha256", `electricity-ledger:${name}`).update(value).digest();
}

export function encryptToken(raw: string | null | undefined): string | null {
  const token = normalizeToken(raw);
  if (!token) return null;
  const key = secret(KEY_ENV);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptToken(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith("v1:")) {
    throw new Error("Stored token is not encrypted with the current token format.");
  }
  const [, ivRaw, tagRaw, encryptedRaw] = ciphertext.split(":");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Stored token payload is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", secret(KEY_ENV), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function tokenHmacFingerprint(raw: string | null | undefined): string | null {
  const token = normalizeToken(raw);
  if (!token) return null;
  return createHmac("sha256", secret(HMAC_ENV)).update(token).digest("hex");
}
