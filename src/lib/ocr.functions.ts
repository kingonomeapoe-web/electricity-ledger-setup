import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const evidenceOcrInput = z.object({
  evidenceId: z.string().uuid(),
  kind: z.enum(["payment_receipt", "meter_reading"]),
  paymentSubmissionId: z.string().uuid().nullable().optional(),
});

export type ValidationCheck = {
  key: string;
  label: string;
  level: "pass" | "warn" | "fail";
  detail: string;
};

/**
 * Runs OCR on an already-stored evidence file. OCR output is advisory only:
 * nothing is confirmed, credited or posted here. For payment receipts the
 * extraction is persisted, automatically validated and the submission moves to
 * `pending_approval` so an administrator can review it.
 *
 * This function intentionally does NOT use the service-role client. All writes
 * go through SECURITY INVOKER RPCs that run under the authenticated resident's
 * own RLS policies, so the upload -> OCR -> review flow works on Cloudflare
 * Workers without exposing the admin key.
 */
export const runEvidenceOcr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => evidenceOcrInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runVisionOcr, toBase64, num, str } = await import("./ocr.server");
    const { normalizeToken, tokenFingerprint, tokenLast4 } = await import("./token");

    // RLS scopes this read to evidence the caller is allowed to see.
    const { data: evidence, error } = await context.supabase
      .from("evidence_files")
      .select("*")
      .eq("id", data.evidenceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!evidence) throw new Error("Evidence not found or not accessible.");

    const download = await context.supabase.storage
      .from(evidence.storage_bucket)
      .download(evidence.storage_path);
    if (download.error || !download.data) {
      throw new Error(`Could not read evidence file: ${download.error?.message ?? "unknown"}`);
    }

    const bytes = new Uint8Array(await download.data.arrayBuffer());

    if (data.kind === "meter_reading") {
      const result = await runVisionOcr({
        base64: toBase64(bytes),
        mimeType: evidence.mime_type ?? "image/jpeg",
        kind: data.kind,
      });
      return {
        reading_kwh: num(result.data["reading_kwh"]),
        meter_number: str(result.data["meter_number"]),
        confidence: result.confidence,
        raw_text: result.raw_text,
      };
    }

    if (!data.paymentSubmissionId) {
      throw new Error("A payment submission is required for receipt OCR.");
    }

    const { data: submission, error: submissionError } = await context.supabase
      .from("payment_submissions")
      .select("id, property_id, resident_id, apartment_id, evidence_id, status")
      .eq("id", data.paymentSubmissionId)
      .maybeSingle();
    if (submissionError) throw new Error(submissionError.message);
    if (!submission) throw new Error("Payment submission not found or not accessible.");

    // Helper for the new SECURITY INVOKER RPCs (not yet in generated types).
    const rpc = (name: string, params: Record<string, unknown>) =>
      (context.supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<unknown>)(name, params);

    await rpc("log_ocr_event", {
      p_payment_submission_id: submission.id,
      p_event_type: "OCR_STARTED",
      p_metadata: { evidence_id: evidence.id, model: "google/gemini-2.5-flash" },
    });

    let result;
    try {
      result = await runVisionOcr({
        base64: toBase64(bytes),
        mimeType: evidence.mime_type ?? "image/jpeg",
        kind: data.kind,
      });
    } catch (ocrError) {
      const message = ocrError instanceof Error ? ocrError.message : "OCR failed";
      await rpc("log_ocr_failure", {
        p_payment_submission_id: submission.id,
        p_evidence_id: evidence.id,
        p_error_message: message,
        p_metadata: { evidence_id: evidence.id },
      });
      throw new Error(message);
    }

    const fieldConfidenceRaw = result.data["field_confidence"];
    const fieldConfidence: Record<string, number> = {};
    if (fieldConfidenceRaw && typeof fieldConfidenceRaw === "object") {
      for (const [key, value] of Object.entries(fieldConfidenceRaw as Record<string, unknown>)) {
        const parsed = num(value);
        if (parsed !== null) fieldConfidence[key] = Math.max(0, Math.min(100, parsed));
      }
    }

    const fullToken = normalizeToken(str(result.data["token"]) ?? str(result.data["token_raw"]));
    const last4 = tokenLast4(fullToken) ?? str(result.data["token_last4"]);
    const fingerprint = await tokenFingerprint(fullToken);
    const meterNumber = str(result.data["meter_number"]);
    const units = num(result.data["units_kwh"]);
    const amount = num(result.data["amount"]);
    const reference =
      str(result.data["transaction_reference"]) ?? str(result.data["transaction_number"]);
    const confidence = result.confidence;

    // ---- Automatic validation (advisory; never auto-credits or auto-rejects)
    const checks: ValidationCheck[] = [];

    const { data: meter } = await context.supabase
      .from("meters")
      .select("identifier, meter_number")
      .eq("property_id", submission.property_id)
      .eq("meter_type", "prepaid_main")
      .eq("active", true)
      .maybeSingle();

    const expectedMeters = [meter?.meter_number, meter?.identifier]
      .filter(Boolean)
      .map((m) => String(m).replace(/\D/g, ""));
    const readMeter = meterNumber ? meterNumber.replace(/\D/g, "") : null;
    if (!readMeter) {
      checks.push({
        key: "meter_match",
        label: "Meter number",
        level: "warn",
        detail: "No meter number could be read from the receipt.",
      });
    } else if (expectedMeters.length === 0) {
      checks.push({
        key: "meter_match",
        label: "Meter number",
        level: "warn",
        detail: "No main prepaid meter number is configured for this property.",
      });
    } else if (expectedMeters.some((m) => m === readMeter || m.endsWith(readMeter) || readMeter.endsWith(m))) {
      checks.push({
        key: "meter_match",
        label: "Meter number",
        level: "pass",
        detail: `Matches the property's main prepaid meter (${meterNumber}).`,
      });
    } else {
      checks.push({
        key: "meter_match",
        label: "Meter number",
        level: "fail",
        detail: `Receipt meter ${meterNumber} does not match the property meter ${meter?.meter_number ?? meter?.identifier}.`,
      });
    }

    checks.push(
      units !== null && units > 0
        ? { key: "units", label: "Units", level: "pass", detail: `${units} kWh read from the receipt.` }
        : { key: "units", label: "Units", level: "warn", detail: "No unit value could be read." },
    );

    checks.push(
      amount !== null && amount > 0
        ? { key: "amount", label: "Amount", level: "pass", detail: `${amount} read from the receipt.` }
        : { key: "amount", label: "Amount", level: "warn", detail: "No amount could be read." },
    );

    checks.push(
      fullToken
        ? { key: "token", label: "Token", level: "pass", detail: `Token ending ${last4} captured.` }
        : {
            key: "token",
            label: "Token",
            level: "warn",
            detail: "No prepaid token was found — confirm this receipt is a token purchase.",
          },
    );

    if (fullToken && (fieldConfidence["token"] ?? 100) < 80) {
      checks.push({
        key: "token_confidence",
        label: "Token confidence",
        level: "warn",
        detail: `Token could not be confidently read (${fieldConfidence["token"]}%). Verify it against the original receipt before loading.`,
      });
    }
    if (units !== null && (fieldConfidence["units_kwh"] ?? 100) < 80) {
      checks.push({
        key: "units_confidence",
        label: "Units confidence",
        level: "warn",
        detail: `Units could not be confidently read (${fieldConfidence["units_kwh"]}%).`,
      });
    }

    checks.push(
      reference
        ? {
            key: "reference",
            label: "Transaction reference",
            level: "pass",
            detail: `Reference ${reference} read from the receipt.`,
          }
        : {
            key: "reference",
            label: "Transaction reference",
            level: "warn",
            detail: "No transaction reference could be read.",
          },
    );

    const { data: residentAccount } = await context.supabase
      .from("resident_accounts")
      .select("id")
      .eq("resident_id", submission.resident_id)
      .eq("property_id", submission.property_id)
      .eq("active", true)
      .maybeSingle();

    checks.push(
      residentAccount
        ? {
            key: "resident_property",
            label: "Resident / property",
            level: "pass",
            detail: "Submission belongs to the resident's assigned property.",
          }
        : {
            key: "resident_property",
            label: "Resident / property",
            level: "fail",
            detail: "This resident has no active account on the property of this submission.",
          },
    );

    checks.push(
      confidence !== null && confidence >= 80
        ? { key: "confidence", label: "OCR confidence", level: "pass", detail: `${confidence}%` }
        : {
            key: "confidence",
            label: "OCR confidence",
            level: "warn",
            detail: `${confidence ?? "unknown"}% — read the original receipt carefully.`,
          },
    );

    // Duplicate detection across this property.
    const { data: siblings } = await context.supabase
      .from("ocr_extractions")
      .select(
        "id, payment_submission_id, transaction_reference, transaction_number, structured_data, payment_submissions!inner(property_id)",
      )
      .eq("payment_submissions.property_id", submission.property_id);

    const others = (siblings ?? []).filter(
      (row) => row.payment_submission_id !== submission.id,
    ) as Array<{
      transaction_reference: string | null;
      transaction_number: string | null;
      structured_data: Record<string, unknown> | null;
    }>;

    const duplicateReference =
      !!reference &&
      others.some((row) => (row.transaction_reference ?? row.transaction_number) === reference);
    const duplicateToken =
      !!fingerprint &&
      others.some((row) => (row.structured_data?.["token_fingerprint"] as string) === fingerprint);

    let duplicateHash = false;
    if (evidence.sha256_hash) {
      const { data: hashMatches } = await context.supabase
        .from("evidence_files")
        .select("id")
        .eq("property_id", submission.property_id)
        .eq("evidence_type", "payment_receipt")
        .eq("sha256_hash", evidence.sha256_hash);
      duplicateHash = (hashMatches ?? []).filter((row) => row.id !== evidence.id).length > 0;
    }

    checks.push(
      duplicateReference || duplicateToken || duplicateHash
        ? {
            key: "duplicate",
            label: "Duplicate check",
            level: "fail",
            detail: [
              duplicateReference ? "reference already used" : null,
              duplicateToken ? "token already submitted" : null,
              duplicateHash ? "identical file already uploaded" : null,
            ]
              .filter(Boolean)
              .join(", "),
          }
        : {
            key: "duplicate",
            label: "Duplicate check",
            level: "pass",
            detail: "No matching reference, token or file hash found.",
          },
    );

    const hasFailure = checks.some((c) => c.level === "fail");
    const needsReview = hasFailure || confidence === null || confidence < 80;

    const structured: Record<string, unknown> = {
      ...result.data,
      token_fingerprint: fingerprint,
      token_label: str(result.data["token_label"]),
      field_confidence: fieldConfidence,
      validation: checks,
    };
    // The full token never lives in structured_data — only in the admin-only column.
    delete structured["token"];
    delete structured["token_raw"];

    const rpcResult = (await rpc("process_receipt_ocr", {
      p_payload: {
        payment_submission_id: submission.id,
        evidence_id: evidence.id,
        status: needsReview ? "needs_review" : "completed",
        provider: str(result.data["provider"]) ?? "lovable-ai",
        model: "google/gemini-2.5-flash",
        raw_text: result.raw_text,
        structured_data: structured,
        amount,
        amount_paid: num(result.data["amount_paid"]) ?? amount,
        units_kwh: units,
        meter_number: meterNumber,
        beneficiary_id: str(result.data["beneficiary_id"]),
        token_ciphertext: fullToken,
        token_last4: last4,
        transaction_reference: str(result.data["transaction_reference"]),
        transaction_number: str(result.data["transaction_number"]),
        session_id: str(result.data["session_id"]),
        customer_name: str(result.data["customer_name"]),
        service_address: str(result.data["service_address"]),
        transaction_date: str(result.data["transaction_date"]),
        transaction_time: str(result.data["transaction_time"]),
        tariff_class: str(result.data["tariff_class"]),
        tariff_rate: num(result.data["tariff_rate"]),
        confidence,
        field_confidence: fieldConfidence,
        processed_at: new Date().toISOString(),
        metadata: {
          resident_id: submission.resident_id,
          apartment_id: submission.apartment_id,
          validation: checks,
        },
      },
    })) as { id: string } | null;

    if (duplicateReference || duplicateToken || duplicateHash) {
      await rpc("log_ocr_event", {
        p_payment_submission_id: submission.id,
        p_event_type: "DUPLICATE_DETECTED",
        p_metadata: {
          duplicate_reference: duplicateReference,
          duplicate_token: duplicateToken,
          duplicate_evidence_hash: duplicateHash,
          transaction_reference: reference,
          token_last4: last4,
        },
      });
    }

    return {
      extractionId: rpcResult?.id ?? null,
      status: needsReview ? "needs_review" : "completed",
      confidence,
      field_confidence: fieldConfidence,
      amount,
      units_kwh: units,
      meter_number: meterNumber,
      token_last4: last4,
      checks,
      raw_text: result.raw_text,
    };
  });
