# Electricity Ledger

Evidence-backed prepaid electricity accounting for a property with a central meter and apartment submeters. Residents submit payment receipts; administrators review extracted details, record meter evidence, confirm credits and consumption, and investigate variances. OCR assists review but does not itself credit a resident.

## Contents

- [What the app does](#what-the-app-does)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Database and storage](#database-and-storage)
- [Using the app](#using-the-app)
- [Data and security model](#data-and-security-model)
- [Cloudflare deployment](#cloudflare-deployment)
- [Development and checks](#development-and-checks)
- [Troubleshooting](#troubleshooting)

## What the app does

| Area | Capabilities |
| --- | --- |
| Resident | View confirmed kWh balance and transaction history; photograph, select, or attach a payment receipt; follow its review status; see submeter readings. |
| Property administrator | Set up a property, main meter, apartments, resident memberships and submeters; record opening readings; capture central/submeter evidence. |
| Review | Inspect original receipts beside OCR findings and validation flags; approve for loading or reject with a reason; confirm central meter loads and credits; review submeter consumption, reconciliation, adjustments and audit history. |

The app is a **TanStack Start + React + TypeScript** application. It uses Lovable Cloud for authentication, Postgres and private evidence storage, TanStack Query for data fetching, Tailwind CSS for styling, and a server-side Lovable AI Gateway request for OCR. The server build targets Cloudflare Workers. The installable app manifest is at `public/manifest.webmanifest`.

## Getting started

1. Connect this project to **Lovable Cloud** and ensure the existing backend migrations have been applied. This repository's schema is under [`supabase/migrations/`](supabase/migrations/) (ordered by filename). The old instruction to run `ELECTRICITY-LEDGER-SCHEMA.sql` is obsolete: that standalone file is not in this repository. **Do not reapply the migrations to an already provisioned production database.**
2. Confirm the private `electricity-evidence` storage bucket exists and its authenticated-user access policies are installed. See [Database and storage](#database-and-storage).
3. Ensure the runtime configuration in [Configuration](#configuration) is available. A standalone external deployment needs additional credentials that Lovable Cloud may not expose.
4. Install dependencies and run the app:

   ```bash
   bun install
   bun run dev
   ```

   The equivalent npm commands are `npm install` and `npm run dev`. The repository includes `bun.lock`.
5. Visit `/auth` to create/sign in to an account. On a fresh backend with **no administrator**, the first signed-in user can select **I am setting this system up (claim admin)** on `/dashboard`. This action requires privileged server credentials; do not use a public/shared fresh deployment until its first administrator is secured. Subsequent residents sign up first, then a property administrator links their email to an apartment in **Property setup**.

There are **no demo rows or mock balances**. A newly created account without an apartment shows a setup/assignment message rather than a resident ledger.

## Configuration

The existing Lovable project supplies its managed backend configuration. For a local checkout or an independent deployment, distinguish browser-build settings from server-runtime settings:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser build | Backend API URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser build | Public client key. Never use a privileged key here. |
| `SUPABASE_URL` | Server runtime | Backend API URL for server-side clients. |
| `SUPABASE_PUBLISHABLE_KEY` | Server runtime | Public key for authenticated server functions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server runtime, **privileged operations only** | Required by `claimFirstAdmin`, `createProperty`, and `linkResident` in `src/lib/admin.functions.ts`. Never expose it to the browser or commit it. |
| `LOVABLE_API_KEY` | Server runtime | Authorizes OCR requests to the Lovable AI Gateway. |

The non-secret server URL and publishable key for the **currently connected backend** are already set in `wrangler.jsonc`; browser values are injected by the connected Lovable environment. If building outside Lovable, provide the matching `VITE_*` variables **at build time** and the matching server variables **at runtime**. Keep all values pointed at the same backend. Store private values in a local, ignored environment file for local development and as runtime secrets on your own host; never commit them or put them in `VITE_*` variables.

**Lovable Cloud limitation:** the managed backend's service-role key is not available to export. A separate Cloudflare account cannot complete the first-admin claim, property creation, or resident linking against that managed backend using the current implementation without that key. Resident receipt upload/OCR and user-scoped database operations use the publishable key and authenticated session, but that does **not** make a fresh independently hosted installation fully operational. For full functionality, use the existing Lovable-hosted app or a backend you control with the same schema, storage setup, auth configuration and required server secrets. Do not substitute the publishable key for the service-role key.

## Database and storage

The source of truth is the ordered SQL in `supabase/migrations/`, not the UI. It defines the property structure (`properties`, `apartments`, `meters`, `submeters`, memberships/accounts), evidence and submissions (`evidence_files`, `payment_submissions`, `ocr_extractions`), readings, ledger, reconciliation and audit tables, together with grants, RLS policies and authoritative database functions. Apply migrations in order **only when provisioning a new backend**, using your own backend migration workflow. Verify grants, RLS and function access in the target backend before admitting users. Do not run an old schema file on top of the current database.

The `electricity-evidence` bucket must be **private**. The checked-in SQL includes authenticated object access policies referring to that bucket, but does **not** create the bucket itself; provision it in the backend's storage configuration for a new installation. Evidence uploads preserve the original file and record its filename, MIME type, byte size, uploader, property, type, storage path, timestamp and SHA-256 hash where available. Viewer access uses short-lived signed URLs rather than making the bucket public.

The existing schema stores system roles on `profiles` and property membership roles on `property_members`. Treat these as the current schema when operating this application; changing the role architecture or applying only part of the migrations requires a separate migration/security review.

## Using the app

### 1. Set up a property

Sign in as the system administrator. From **Property setup** (`/setup`), create the property and main prepaid meter, record its opening balance/reading, add apartments and their submeters, and record initial submeter readings. The resident must have signed up before the administrator can link that email to an apartment. **Evidence & readings** (`/admin`) has the property overview, central meter and submeter capture tabs. With multiple properties, select the correct property before making changes.

### 2. Submit a payment receipt

The resident signs in to **My electricity** (`/resident`) and selects **Buy electricity / upload receipt**. On a phone, the uploader supports taking a photo or choosing from the gallery; it also accepts a file. The original goes to private storage, an `evidence_files` record is created, then a `payment_submissions` record is submitted. The resident cannot enter units or credit themselves.

The OCR service reads receipt fields such as amount, purchased kWh, meter number, prepaid token, transaction reference, provider, customer, date/time and tariff where present. Missing or uncertain fields remain unconfirmed. It records confidence and validation checks (including meter match and potential duplicates) for human review; failure is surfaced as an OCR error, not as a credit. The full prepaid token must not appear in the resident view.

### 3. Review and credit

The property administrator opens **Review & reconciliation → Payments** (`/review`). The review shows the original evidence, extracted fields, confidence and warnings, and allows approval for physical token loading or rejection with a reason. **Approval alone does not add electricity.** After loading the token on the main meter, the administrator records load evidence, the pre-load balance and a photographed post-load meter reading, then confirms the credit. The comparison between expected and observed balance is shown before confirmation; a discrepancy requires an explanation. The ledger's `confirm_central_meter_credit()` database routine is the authoritative credit operation. The resident then sees the confirmed transaction and updated balance.

### 4. Record readings and reconcile

Administrators capture central and apartment submeter readings in **Evidence & readings**; review them in the **Central meter** and **Submeters** tabs of **Review & reconciliation**. Confirmed submeter consumption is posted through `post_confirmed_submeter_consumption()`, not by editing a resident balance. Use **Reconciliation** to compare central and submeter consumption and classify variances. **Ledger** lists transactions and provides an audited adjustment action; **Audit** shows critical events. Do not insert or update ledger transactions directly from client code.

## Data and security model

- `/` and `/auth` are public; `/dashboard`, `/resident`, `/setup`, `/admin` and `/review` require sign-in. Property-scoped data access is enforced by backend grants, RLS and permission checks, not by hiding navigation links.
- The private bucket stores receipt and meter evidence. A resident's receipt must belong to their own property/account. Signed links expire; do not share them as permanent public URLs.
- OCR findings are advisory. Payment submission state, confirmed readings and ledger entries have distinct responsibilities; no OCR result by itself changes a balance.
- Resident receipt submission and OCR use authenticated user permissions and the `process_receipt_ocr`, `log_ocr_event` and `log_ocr_failure` database helpers. Administrator-only setup functions use a privileged server client **after** authentication/authorization checks.
- Never put full tokens, service credentials or private evidence URLs in client logs, public pages or documentation. Token reveal is an audited administrator action.
- Refer to the migrations for exact database permissions and transition enforcement; do not assume UI labels alone constitute a security boundary.

## Cloudflare deployment

This is a server-rendered Workers application, **not** a static SPA or Netlify deployment. Keep `vite.config.ts`'s Cloudflare module preset and `wrangler.jsonc`'s `nodejs_compat` setting. The Wrangler dependency is already included.

```bash
bun install
bun run build
bunx wrangler login                 # first deployment on your own account
bunx wrangler deploy                # from the project root, after building
```

For npm, use `npm install`, `npm run build`, `npx wrangler login`, and `npx wrangler deploy`. The build generates Wrangler deployment output/configuration; deploy from the same checkout after a successful build. Do **not** serve only the client assets as a static website.

Before building independently, provide the matching `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The checked-in Wrangler vars provide matching non-secret **server** settings for the connected backend. For OCR on your own Worker, provision a valid Lovable AI Gateway key and set it privately with `bunx wrangler secret put LOVABLE_API_KEY` (or `npx wrangler secret put LOVABLE_API_KEY`). The key in Lovable's managed environment is not automatically copied to another Cloudflare account. Never paste secrets into `wrangler.jsonc`.

**Full independent operation requires an accessible privileged server credential for admin setup.** On Lovable Cloud, `SUPABASE_SERVICE_ROLE_KEY` is managed and cannot be retrieved for a separate Worker. If you instead own the backend and have its corresponding service-role key, set it as `SUPABASE_SERVICE_ROLE_KEY` with `wrangler secret put`, keep it server-only, migrate the database, set up the private bucket and auth, and replace both client and server backend URLs/keys consistently. Deployment by itself does not migrate data or provision storage/auth. See [Configuration](#configuration) for the supported/unsupported split.

## Development and checks

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the local development server. |
| `bun run build` | Produce the production server/client bundle. |
| `bun run preview` | Preview a built app locally. |
| `bun run lint` | Run ESLint. |

No `test` or `typecheck` script is defined in `package.json`. Route files are in `src/routes/`; page-level UI is in `src/components/`; authenticated server functions are in `src/lib/*.functions.ts`; OCR's server-only implementation is in `src/lib/ocr.server.ts`. `src/integrations/supabase/` contains generated connection/auth files that should not be manually edited. Add schema changes as ordered migrations, preserving backend grants and RLS.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| “Missing Supabase environment variable(s)” | Provide browser `VITE_*` settings at **build** time and server settings at **runtime**; rebuild and redeploy. The browser and server must use the same backend. |
| Resident has no electricity page/data | Have them create an account first; an administrator must link that email to the correct property and apartment. |
| Submitted receipt not visible in review | Sign in as an administrator of the **same property**; open `/review` → **Payments**, choose the property if multiple are available, and check for a receipt-loading error. Residents cannot approve their own payments. |
| Upload fails | Confirm sign-in, property membership, private `electricity-evidence` bucket, authenticated storage policies and file acceptance. |
| “AI is not configured for this project” / OCR fails on external Cloudflare | Set a valid server-side `LOVABLE_API_KEY` on that Worker, redeploy and inspect server logs. Upload may succeed even when OCR fails. |
| First-admin claim, property creation or resident linking fails on external Cloudflare | These operations currently need a server-side service-role key. Lovable Cloud does not export that key to independently hosted Workers; use the Lovable-hosted app or a backend you control. |
| Deep links return 404 on another host | Deploy the Workers server build. A static hosting upload of the client directory cannot serve TanStack Start routes. |

Built with [Lovable](https://lovable.dev). Continue editing this project in the [Lovable editor](https://lovable.dev/projects/0b91e737-01f4-4de8-b46d-5541a2f53e0c).