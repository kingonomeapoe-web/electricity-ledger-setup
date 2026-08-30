import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260830000000_phase1_security_integrity.sql",
  "utf8",
);
const ocr = readFileSync("src/lib/ocr.functions.ts", "utf8");
const tokenServer = readFileSync("src/lib/token.server.ts", "utf8");
const paymentsPanel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
const paymentReview = readFileSync("src/components/review/PaymentReviewPanel.tsx", "utf8");
const submeterReview = readFileSync("src/components/review/SubmeterReviewPanel.tsx", "utf8");
const token = readFileSync("src/lib/token.ts", "utf8");

assert.match(token, /digits\.length === 20/, "token normalization must require 20 digits");
assert.match(tokenServer, /aes-256-gcm/, "full token must use authenticated encryption");
assert.match(tokenServer, /createHmac\("sha256"/, "duplicate token matching must use HMAC");
assert.match(
  ocr,
  /token_ciphertext: encryptedToken/,
  "OCR must store encrypted token payloads only",
);
assert.doesNotMatch(ocr, /token_ciphertext: fullToken/, "OCR must not store plaintext full tokens");
assert.match(
  migration,
  /storage_electricity_evidence_select[\s\S]*evidence_files/,
  "storage reads must authorize via evidence metadata",
);
assert.match(
  migration,
  /storage_electricity_evidence_insert[\s\S]*payment_receipt/,
  "storage writes must restrict resident evidence type",
);
assert.match(
  migration,
  /admin_transition_payment_status/,
  "authoritative payment transition RPC must exist",
);
assert.match(
  migration,
  /confirm_and_post_submeter_consumption/,
  "atomic submeter confirmation/posting RPC must exist",
);
assert.match(migration, /hash_audit_event/, "audit hash trigger must exist");
assert.match(migration, /adjustment_requests/, "controlled adjustment request table must exist");
assert.doesNotMatch(
  paymentsPanel,
  /status:\s*"loaded"/,
  "legacy admin panel must not set loaded status directly",
);
assert.doesNotMatch(
  paymentsPanel,
  /central_meter_readings"\)\.insert/,
  "legacy admin panel must not insert post-load readings",
);
assert.match(
  paymentReview,
  /confirm_central_meter_credit/,
  "payment review must use authoritative central credit RPC",
);
assert.doesNotMatch(
  paymentReview,
  /from\("central_meter_readings"\)[\s\S]{0,80}\.insert/,
  "payment review must not pre-insert central readings",
);
assert.match(
  submeterReview,
  /confirm_and_post_submeter_consumption/,
  "submeter review must use atomic posting RPC",
);
assert.doesNotMatch(
  submeterReview,
  /from\("submeter_readings"\)[\s\S]{0,80}\.update/,
  "submeter review must not update immutable readings directly",
);

console.log("Phase 1 security integrity checks passed.");
