/**
 * Prepaid token helpers. Tokens are 20-digit STS credit tokens printed in
 * groups of four. Normalisation strips every non-digit so that the same token
 * printed differently on two receipts still collides in duplicate detection.
 */

export function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** Deterministic, non-reversible fingerprint used only for duplicate matching. */
export async function tokenFingerprint(raw: string | null | undefined): Promise<string | null> {
  const normalized = normalizeToken(raw);
  if (!normalized) return null;
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(`electricity-ledger:token:${normalized}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function tokenLast4(raw: string | null | undefined): string | null {
  const normalized = normalizeToken(raw);
  return normalized ? normalized.slice(-4) : null;
}

/** Residents and unauthorised views never see more than the last four digits. */
export function maskedToken(last4: string | null | undefined): string {
  return last4 ? `•••• •••• •••• ${last4}` : "—";
}

export function groupToken(raw: string | null | undefined): string {
  const normalized = normalizeToken(raw);
  if (!normalized) return "—";
  return normalized.replace(/(.{4})/g, "$1 ").trim();
}
