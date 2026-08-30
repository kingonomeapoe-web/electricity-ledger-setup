# Electricity Ledger Engineering Audit & Implementation Plan

## A. Architecture Summary

Electricity Ledger is a TanStack Start + React + Supabase application for managing electricity payments, central prepaid-meter loads, apartment submeter readings, resident credit balances, reconciliation, and audit history.

The current architecture has the right high-level components:

- Supabase Auth for users and sessions.
- Profiles, roles, property memberships, apartments, meters, submeters in Postgres.
- Evidence storage in a private Supabase Storage bucket plus `evidence_files` metadata.
- Payment submissions linked to resident, property, apartment, and evidence.
- OCR extraction through a server function calling Lovable AI / Gemini.
- Authoritative ledger functions in Postgres:
  - `confirm_central_meter_credit`
  - `post_confirmed_submeter_consumption`
  - `create_ledger_adjustment`
- RLS policies for most tables.
- Append-only triggers for key audit/ledger/reading/load tables.
- Admin review UI for payments, central meter readings, submeter readings, reconciliation, ledger, and audit.
- Resident dashboard for uploading receipt evidence and viewing ledger activity.

The schema clearly separates the three required accounting concepts:

1. Central meter balance — `central_meter_readings` and `central_meter_loads`.
2. Resident electricity credit balance — `ledger_accounts` and `ledger_transactions`.
3. Physical submeter reading — `submeter_readings`.

That separation is present in the schema and partially respected in the UI and server functions. The most important remaining issue is that several workflows still perform direct frontend writes to business-critical tables before or outside the authoritative database functions.

## B. Current Implementation Map

### 1. Database Schema / Migrations

Core entities are implemented in Supabase migrations:

- `profiles`, `properties`, `property_members`, `apartments`, `resident_accounts`.
- `meters` and `submeters`.
- `central_meter_readings` for central prepaid-meter readings.
- `submeter_readings` for apartment submeter snapshots and calculated deltas.
- `evidence_files` for immutable evidence metadata.
- `payment_submissions` for resident receipt submissions.
- `ocr_extractions` for OCR results, including amount, units, meter number, token, transaction reference, provider, date, and confidence.
- `central_meter_loads` for confirmed token-load events.
- `ledger_accounts` and append-only `ledger_transactions`.
- `reconciliations` and `reconciliation_items`.
- `audit_logs`.

The schema captures evidence metadata including bucket, storage path, file metadata, and SHA-256 hash.

Payment submissions and OCR extractions are modeled separately, which is correct.

Central meter loads are modeled as separate events and have a unique `payment_submission_id`, which is an important protection against double-crediting the same payment through the central load table.

### 2. Supabase Client

The browser Supabase client uses the publishable key and persists sessions.

The server Supabase admin client uses `SUPABASE_SERVICE_ROLE_KEY` and explicitly documents that it bypasses RLS. This is appropriate only for trusted server functions.

### 3. Authentication and Role Handling

Authenticated routes call `supabase.auth.getUser()` and redirect unauthenticated users to `/auth`.

Role checks are mostly done using database functions:

- `is_admin()`
- `is_property_admin(property_id)`
- `is_property_resident(property_id)`

Those functions read authenticated user identity via `auth.uid()` and check `profiles` and/or `property_members`.

### 4. Evidence Upload / Viewing

Evidence upload is implemented client-side through `uploadEvidence`. It:

- Gets the current authenticated user.
- Computes a SHA-256 hash where browser crypto is available.
- Creates a unique storage path under `{propertyId}/{evidenceType}/{uuid}-{filename}`.
- Uploads to `electricity-evidence` with `upsert: false`.
- Inserts metadata into `evidence_files`.
- Removes the storage object if metadata insertion fails.

Evidence viewing uses short-lived signed URLs.

### 5. OCR Implementation

OCR is operational, not merely mocked. `runVisionOcr` calls `https://ai.gateway.lovable.dev/v1/chat/completions` with model `google/gemini-2.5-flash`. It requires `LOVABLE_API_KEY`; without that key, OCR fails with “AI is not configured for this project.”

The OCR prompt requests amount, amount paid, units, meter number, token, transaction reference, provider, date, time, tariff information, and field confidences.

Meter OCR is also implemented and asks for `reading_kwh`, `meter_number`, raw text, and confidence.

Payment OCR persists extracted fields to `ocr_extractions` and moves the submission to `pending_approval`.

### 6. Payment Submission Flow

Resident payment submission is server-side:

- Resident uploads evidence.
- Server function verifies evidence belongs to caller and is `payment_receipt`.
- Server function verifies the resident has an active resident account in that property.
- It inserts a `payment_submissions` row with status `uploaded`.
- It inserts an audit log using service role.

This is mostly correct.

### 7. Payment Review Flow

Payment review is partially implemented in frontend components.

Admins can set statuses through direct client updates to `payment_submissions`. This is protected by RLS to property admins, but it is not authoritative workflow enforcement. It allows status transitions outside an explicit state machine.

### 8. Central Meter Credit Flow

The authoritative database function `confirm_central_meter_credit` exists and is close to the right model:

- Requires admin.
- Locks the payment row with `FOR UPDATE`.
- Rejects already `credited` or `duplicate` payments.
- Checks property-admin access.
- Finds active main prepaid meter.
- Verifies `before + units = after`.
- Locks the resident ledger account.
- Inserts `central_meter_loads`.
- Inserts a credit ledger transaction.
- Updates payment status to `credited`.
- Inserts an audit log.

The review UI uses this RPC for the final credit step.

However, the UI first inserts a `central_meter_readings` row before calling the authoritative function. If the RPC then fails, the central meter reading remains inserted, creating partial state.

There is also an older/admin panel flow that records a token load by inserting a central reading and then merely updates the payment status to `loaded` without posting a ledger credit.

### 9. Submeter Flow

Submeter readings are insert-only and their deltas are calculated by a trigger that compares the new reading to the latest prior reading. It prevents decreasing readings and calculates `units_consumed_kwh`.

The authoritative consumption posting function exists:

- Requires admin.
- Requires the submeter reading to be confirmed.
- Finds the resident account and ledger account.
- Rejects duplicate posting for the same reading.
- Checks resident credit is sufficient.
- Inserts a negative ledger transaction.
- Inserts an audit log.

But the review UI first attempts to update the immutable `submeter_readings` row to set confirmation fields, then calls the posting RPC.

Because `submeter_readings` has an immutable update/delete trigger, this frontend update will fail.

So the submeter confirmation/posting flow is currently broken.

### 10. Reconciliation Flow

The reconciliation tables and review/classification function exist, but no audited, authoritative reconciliation creation function was found. The panel only reads existing reconciliations and classifies variances.

There is no complete server-side calculation flow that:

- Selects period start/end.
- Computes central start/end.
- Computes total credits loaded.
- Computes central consumption.
- Computes submeter consumption.
- Inserts reconciliation and items atomically.
- Audits the reconciliation run.

### 11. Audit Logging

`audit_logs` exists and has append-only update/delete protection.

But although the migration header says “AUDIT HASHING,” no trigger or function actually computes `previous_hash` or `event_hash`. The columns exist but are not populated by the shown database logic.

## C. Security Findings

## CRITICAL

### C1. Full prepaid token is stored in plaintext despite being named `token_ciphertext`

The OCR code stores the normalized full token directly into `ocr_extractions.token_ciphertext`. No encryption is performed.

The database column is called `token_ciphertext`, but the frontend/server code treats it as plaintext. The reveal function returns this value as the token.

**Impact:** If an admin account, service role key, database dump, or backend logs are compromised, full prepaid tokens are exposed. The name is misleading and may cause operators to assume encryption exists.

**Fix:** Implement real encryption or remove full-token persistence entirely after loading. Prefer storing only a salted/HMAC fingerprint and last four digits, and requiring admin to read the original receipt for the token.

### C2. Storage object RLS allows every resident of a property to read every storage object in that property

The storage select policy allows access to any object whose first path segment is a property ID where the user is either admin or resident.

This means resident A can potentially read resident B’s receipt storage object if they know or obtain the path, because the storage policy is property-wide. The `evidence_files` table policy is stricter, but signed URL creation/download depends on storage policies too.

**Impact:** Violates “residents must never access another resident’s evidence.”

**Fix:** Storage paths should include user/account/evidence ownership and storage policies should check against `evidence_files.uploaded_by` or admin membership, not just property membership.

### C3. Residents can insert storage objects under admin evidence-type folders

The storage insert policy only checks that the first path segment is a property for which the user is resident/admin. It does not enforce that residents can only insert `payment_receipt` paths.

The `evidence_files` insert policy limits resident evidence metadata to `payment_receipt`, but the storage object can still be created first.

**Impact:** Residents can pollute private storage with objects under `central_meter_reading`, `central_meter_load`, or `submeter_reading` paths even if they cannot create matching metadata rows.

**Fix:** Enforce path segment 2 equals allowed evidence type based on role. Better: perform all evidence upload through a server function that creates a signed upload URL after authorization.

### C4. Submeter confirmation flow attempts direct update on an immutable table and therefore cannot work

`submeter_readings` has an update/delete prevention trigger.

But the review UI confirms a submeter reading by updating the row before calling the posting RPC.

**Impact:** Admin cannot complete the required submeter consumption flow through this UI. Consumption posting requires `confirmed_at` to be non-null, so the RPC will not be reached or will fail.

**Fix:** Move confirmation and posting into one authoritative database function or make readings pending in a mutable staging table and append confirmed readings only once.

## HIGH

### H1. Direct frontend payment status updates bypass an explicit authoritative state machine

The review panel directly updates `payment_submissions.status`, `reviewed_at`, and `reviewed_by` from the browser.

RLS restricts this to property admins, but the business state machine is not enforced. Admin clients can set statuses out of order, skip OCR, mark receipts rejected/approved without required audit metadata, or create inconsistent lifecycle states.

**Fix:** Replace direct status updates with RPC functions:

- `admin_approve_payment_for_loading`
- `admin_reject_payment`
- `admin_mark_duplicate_payment`
- `admin_dispute_payment`
- `confirm_central_meter_credit`

Each should validate legal prior statuses and write audit logs atomically.

### H2. Central meter credit flow can leave orphaned post-load readings when credit RPC fails

The payment review panel inserts a central meter reading before calling `confirm_central_meter_credit`.

If `confirm_central_meter_credit` fails because of duplicate payment, missing ledger account, status race, insufficient state, or DB constraint, the reading remains inserted and immutable.

**Impact:** Central meter history can show a post-load reading even though no central load and no resident credit were recorded.

**Fix:** Make `confirm_central_meter_credit` insert the central meter reading itself, or create a single RPC that accepts OCR/manual confirmed reading data and evidence IDs and writes all related rows atomically.

### H3. Older admin payment panel has incomplete load flow and can mark payment `loaded` without credit

`src/components/admin/PaymentsPanel.tsx` inserts a central meter reading and updates the payment status to `loaded`, but it does not call `confirm_central_meter_credit` and does not create a `central_meter_loads` row or ledger credit.

**Impact:** Payment can be stuck as `loaded` with no resident credit. This violates the required flow that resident credit happens only after central meter load confirmation.

**Fix:** Remove this older flow or route it through the same authoritative credit RPC.

### H4. Token duplicate protections are incomplete and inconsistent

The schema has a unique index on `ocr_extractions.token_ciphertext`, meaning plaintext full token uniqueness is global if present.

The `central_meter_loads` table has `token_fingerprint`, but `confirm_central_meter_credit` does not populate it.

OCR duplicate detection checks `structured_data.token_fingerprint`, but this is advisory and only runs during OCR.

**Impact:** Duplicate detection is not enforced at the authoritative credit point except through the unique payment submission constraint. If OCR misses or token is absent, duplicate controls are weak. If two different transaction references point to the same token but token extraction fails, double-credit is possible after human approval.

**Fix:** At credit confirmation, enforce transaction reference, token fingerprint, evidence hash, and payment status constraints inside the database function. Store token fingerprint in `central_meter_loads`.

### H5. `normalizeToken` accepts any 8+ digit value, not only production STS token shape

The helper says tokens are 20-digit STS tokens, but the implementation accepts any digit string of length at least 8.

**Impact:** Meter numbers, references, phone fragments, or other numeric values can become token fingerprints/last-four values, making token extraction and duplicate detection unreliable.

**Fix:** Require 20 digits for STS credit tokens unless an explicit provider-specific exception is implemented.

### H6. Audit hashes are declared but not implemented

The audit table contains `previous_hash` and `event_hash`, but the shown migration only prevents updates/deletes and does not compute a hash chain.

**Impact:** Audit logs are append-only against normal updates/deletes, but not cryptographically tamper-evident.

**Fix:** Add an insert trigger that computes `previous_hash` and `event_hash`, or use a separate audit-chain table with deterministic canonical JSON hashing.

## MEDIUM

### M1. OCR failure does not update payment submission status

On OCR failure, a failed extraction and audit event are inserted, but the payment submission status is not moved to `correction_required`, `disputed`, or another failure state.

**Impact:** UI may leave submissions ambiguous after OCR failure.

**Fix:** Update payment status in the same failure path and expose retry/correction UX.

### M2. Payment submission allows repeated submissions of the same evidence

There is no unique constraint on `payment_submissions.evidence_id`. The same evidence file can potentially be submitted multiple times by the same resident if the UI/server path is called repeatedly.

**Impact:** Duplicate review noise and potential race/double-credit attempts.

**Fix:** Add `unique(evidence_id)` to `payment_submissions` or enforce in a server function.

### M3. `confirm_central_meter_credit` allows crediting statuses other than `approved_for_loading` / ready states

The function only rejects `credited` and `duplicate`.

**Impact:** An admin can credit a rejected, disputed, uploaded, OCR-failed, or correction-required payment if they call the RPC with plausible values.

**Fix:** Require status to be exactly `approved_for_loading` or a narrow accepted state.

### M4. Central balance verification trusts caller-supplied “before” balance

`confirm_central_meter_credit` verifies `p_central_balance_before_kwh + p_units_loaded_kwh = p_central_balance_after_kwh`, but it does not independently derive the previous confirmed central balance from `central_meter_readings` / `central_meter_loads`.

**Impact:** A caller can provide an internally consistent but historically incorrect before/after pair.

**Fix:** Derive `before` inside the function from the latest confirmed central reading/load for the property, and lock the relevant meter/property row.

### M5. Submeter delta trigger uses latest inserted/captured reading without locking per submeter

The trigger calculates previous reading by selecting the latest prior reading.

**Impact:** Concurrent inserts for the same submeter can calculate wrong deltas.

**Fix:** Lock the submeter row or serialize inserts through an RPC with advisory locks.

### M6. Evidence immutability is incomplete

Storage upload uses `upsert: false`, which prevents overwriting that exact path.

However, no storage delete policy is shown, and metadata rows are insert-only by grant/RLS, but service-role code can still remove/update unless operational controls exist. The design is good but not fully WORM/immutable.

**Fix:** Deny client delete/update storage policies explicitly, add service-role operational discipline, and consider object retention or external archival for production evidence.

## LOW

### L1. Build uses deprecated TanStack server function API

Build warns that `createServerFn().inputValidator()` is deprecated and should become `.validator()`.

### L2. Package has no test script

`package.json` includes dev/build/preview/lint/format scripts, but no test script.

### L3. Large client chunks

The production build succeeds but warns about chunks larger than 500 kB. This is not a correctness issue, but worth optimizing before heavy production usage.

## D. Business-Logic Findings

### Correct / Mostly Correct

- Schema separates central meter balances, resident credit balances, and physical submeter readings.
- Resident receipt submission does not accept resident-supplied amount/units/token; it only submits evidence.
- OCR output is advisory and persisted for admin review.
- Ledger transactions are append-only and clients have no direct insert policy.
- Central meter crediting is done through a server-side database function that inserts both load event and credit ledger transaction.
- Submeter consumption posting has a server-side database function that prevents duplicate ledger posting for the same reading.

### Partially Implemented / Problematic

- Payment status transitions are direct frontend updates, not a strict state machine.
- Central meter post-load reading and crediting are not fully atomic because UI inserts reading first.
- Submeter flow is currently blocked by immutability vs direct update conflict.
- Reconciliation lacks authoritative creation/calculation logic.
- Audit logs are append-only but not hash-chained.
- Duplicate token/reference detection exists during OCR but is not authoritative at final credit.

### Violates Business Rules

- Evidence privacy is not strict enough because storage object access is property-wide for residents.
- Full token storage is not safely encrypted despite the column name.
- Resident access to storage could expose other residents’ receipts.
- Admin payment panel can mark token load complete without ledger credit.
- Submeter confirmation flow cannot complete as designed.

## E. Missing Functionality

1. Authoritative payment state-machine RPCs
   - Approve for loading.
   - Reject.
   - Mark duplicate.
   - Request correction.
   - Dispute.
   - All with legal prior-state checks and audit.

2. Atomic central meter credit workflow
   - Upload/load evidence.
   - Confirm post-load central reading.
   - Verify previous central balance + units.
   - Insert central reading.
   - Insert central load.
   - Insert ledger credit.
   - Update payment status.
   - Audit.
   - All in one transaction.

3. Atomic submeter confirmation/posting workflow
   - Insert pending capture or confirmed immutable reading correctly.
   - Confirm reading.
   - Calculate consumption.
   - Post ledger consumption.
   - Audit.
   - All in one RPC or immutable staging/confirmed model.

4. Reconciliation generation
   - Period selection.
   - Central start/end derivation.
   - Loaded credits.
   - Central consumption.
   - Submeter consumption.
   - Variance calculation.
   - Reconciliation items.
   - Audit event.

5. Production-grade token handling
   - 20-digit validation.
   - Encryption or non-persistence of full token.
   - HMAC/fingerprint duplicate detection.
   - Token uniqueness enforced at final credit.

6. Storage privacy hardening
   - Resident object read limited to own evidence only.
   - Storage path ownership checks.
   - No resident write to admin evidence folders.

7. Audit hash chain
   - Compute `previous_hash` / `event_hash`.
   - Verification function.
   - Tamper-evidence test.

8. Tests
   - Database/RLS tests.
   - RPC atomicity tests.
   - OCR parser/token tests.
   - Playwright or integration flow tests.

## F. Database / Schema Findings

### Strengths

- Comprehensive schema exists.
- Key ledger and audit tables are append-only through triggers.
- Ledger writes are intended to happen through `SECURITY DEFINER` functions.
- `central_meter_loads.payment_submission_id` is unique.
- Submeter readings prevent negative deltas.
- RLS is enabled on all listed public tables.

### Issues

1. `ocr_extractions.token_ciphertext` is plaintext.
2. Global unique index on `ocr_extractions.transaction_reference` may be too broad if different providers can reuse references, but it is helpful for duplicate detection.
3. `central_meter_loads.token_fingerprint` exists but is not populated by the credit RPC.
4. `payment_submissions.evidence_id` is not unique.
5. Audit hash columns exist but are not computed.
6. Confirmation fields on immutable readings create a design contradiction if readings are inserted unconfirmed and later updated.
7. `confirm_central_meter_credit` does not require a specific payment status before crediting.
8. `confirm_central_meter_credit` trusts caller-supplied previous central balance.
9. `post_confirmed_submeter_consumption` reads confirmed status but cannot itself confirm under current immutable design.

## G. OCR Findings

### Operational

OCR is real and calls Lovable AI / Gemini, not a local mock.

### Good

- Prompt asks for relevant payment fields.
- Prompt highlights token extraction.
- Field confidence exists.
- Duplicate checks include reference, token fingerprint, and evidence hash.
- Full token is deleted from `structured_data` before persistence.

### Not Production-Ready

- Full token is still stored in plaintext in `token_ciphertext`.
- Token normalization accepts 8+ digits rather than requiring 20 digits.
- OCR duplicate detection is advisory and not enforced by final credit function.
- OCR failure does not move payment to a clear status.
- `transaction_time` is requested by the prompt but not persisted in the OCR insert shown.
- Token extraction depends heavily on LLM behavior; no deterministic post-processing exists to validate or extract 20-digit STS candidates from raw OCR text.
- No test corpus of Nigerian provider receipts exists.

## H. Testing Gaps

There is no `test` script in `package.json`.

Missing tests should include:

1. Database/RLS tests
   - Resident cannot select another resident’s evidence metadata.
   - Resident cannot create central/submeter evidence metadata.
   - Resident cannot update payment status.
   - Resident cannot insert ledger transaction.
   - Resident cannot call admin RPCs successfully.
   - Resident cannot read another resident’s storage object.

2. RPC tests
   - `confirm_central_meter_credit` credits exactly once.
   - Duplicate calls fail.
   - Rejected/disputed/uploaded payments cannot be credited.
   - Incorrect central before/after fails.
   - Ledger account locking prevents concurrent double-credit.
   - `post_confirmed_submeter_consumption` posts once.
   - Concurrent submeter postings do not double-post.

3. OCR tests
   - Token extraction accepts 20-digit grouped/un-grouped tokens.
   - Rejects meter/reference/phone as token.
   - Duplicate reference detection.
   - Duplicate token fingerprint detection.
   - Low-confidence path.
   - OCR API failure path.

4. Integration tests
   - Resident upload → OCR → admin review → central load → credit.
   - Admin submeter capture → confirm → consumption debit.
   - Reconciliation generation and variance classification.

5. UI tests
   - Resident cannot see admin review route content.
   - Admin cannot complete credit without load evidence and post-load reading.
   - OCR failure surfaces actionable state.

## I. Recommended Implementation Sequence

### Phase 1 — Stop Inconsistent and Insecure Writes

1. Remove or disable incomplete `src/components/admin/PaymentsPanel.tsx` token-load flow that sets `loaded` without credit.
2. Replace direct payment status updates with RPC calls.
3. Replace submeter confirmation direct update with a database-backed confirmation/posting flow.
4. Move central post-load reading insert inside the credit RPC.

### Phase 2 — Harden Evidence and Token Security

5. Redesign storage paths and policies so residents can only read/write their own evidence.
6. Add strict storage policy checks against `evidence_files` ownership or server-generated upload URLs.
7. Stop storing full token plaintext; store HMAC fingerprint and last four only, or encrypt using a proper key-management plan.
8. Enforce 20-digit STS token normalization unless provider-specific exceptions are added.

### Phase 3 — Make Database Functions Authoritative

9. Add `admin_review_payment` / `transition_payment_status` RPC with legal transitions.
10. Update `confirm_central_meter_credit` to:
    - Require `approved_for_loading`.
    - Derive previous central balance.
    - Insert central reading internally.
    - Populate token fingerprint.
    - Enforce duplicate reference/token/evidence checks.
11. Update submeter flow to:
    - Use pending table or all-in-one confirm/post RPC.
    - Lock submeter row during delta calculation.
    - Prevent concurrent insert races.

### Phase 4 — Reconciliation

12. Implement `create_reconciliation_period` RPC.
13. Add UI to generate reconciliation periods.
14. Add reconciliation math tests.

### Phase 5 — Audit and Testing

15. Add hash-chain trigger for audit logs.
16. Add audit verification RPC.
17. Add database/RLS tests.
18. Add unit tests for OCR/token helpers.
19. Add end-to-end flow tests.

## J. Prioritized Codex Backlog

### P0 — Critical Security / Correctness

1. Harden storage evidence privacy
   - Update storage policies so resident can only access own evidence objects.
   - Add tests for cross-resident storage access denial.

2. Remove plaintext token persistence
   - Replace `token_ciphertext` behavior with encrypted token or fingerprint-only storage.
   - Update reveal flow accordingly.

3. Fix broken submeter confirmation flow
   - Implement atomic `confirm_and_post_submeter_reading` RPC or staging table.
   - Update UI to call RPC.
   - Add duplicate/concurrent posting tests.

4. Make central credit atomic
   - Move central reading insert into `confirm_central_meter_credit`.
   - Update UI to call one RPC.
   - Add failure atomicity test.

5. Delete or rewire incomplete admin token-load flow
   - Ensure no UI can set `loaded` without creating central load and ledger credit.

### P1 — High-Value Business Logic

6. Add payment status state-machine RPC
   - Legal transitions only.
   - Audit every transition.
   - Replace direct frontend updates.

7. Strengthen duplicate detection at credit confirmation
   - Enforce transaction reference, token fingerprint, evidence hash, and payment uniqueness inside DB transaction.

8. Require creditable status in `confirm_central_meter_credit`
   - Only `approved_for_loading` or equivalent can be credited.

9. Derive central before balance server-side
   - Do not trust client-supplied previous balance.

10. Strict token normalization
    - Require 20-digit token.
    - Add tests for grouped and ungrouped tokens.

### P2 — Reconciliation and Audit

11. Implement reconciliation generation RPC
    - Compute central consumption and submeter totals.
    - Insert reconciliation and items atomically.

12. Add audit hash chain
    - Compute `previous_hash` and `event_hash`.
    - Add verification function/test.

13. Add ledger adjustment tests
    - Positive adjustment.
    - Negative adjustment.
    - Reversal.
    - Cannot drive balance negative.

### P3 — Production Readiness

14. Add automated test framework
    - Vitest for unit tests.
    - Supabase local DB tests or pgTAP-style SQL tests.
    - Playwright for critical flows.

15. Add OCR receipt fixture corpus
    - Representative provider receipts.
    - Low-quality photos.
    - Screenshots.
    - Missing/ambiguous token.

16. Handle OCR failure status explicitly
    - Move payment to `correction_required` or `ocr_failed`.
    - Allow retry.
    - Audit retry.

17. Clean deprecated TanStack server function API
    - Replace `.inputValidator()` with `.validator()`.

18. Bundle optimization
    - Code-split review/admin panels.
    - Reduce large chunks.

## Build / Checks from Audit

- `npm run build` — production build completed successfully.
- `git status --short` — confirmed no repository changes were made before this document was requested.
