import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const evidenceOcrInput = z.object({
  evidenceId: z.string().uuid(),
  kind: z.enum(["payment_receipt", "meter_reading"]),
  paymentSubmissionId: z.string().uuid().nullable().optional(),
});

/**
 * Runs OCR on an already-stored evidence file. OCR output is advisory only:
 * nothing is confirmed, credited or posted here.
 */
export const runEvidenceOcr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => evidenceOcrInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runVisionOcr, toBase64, num, str } = await import("./ocr.server");

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
    const result = await runVisionOcr({
      base64: toBase64(bytes),
      mimeType: evidence.mime_type ?? "image/jpeg",
      kind: data.kind,
    });

    if (data.kind === "meter_reading") {
      return {
        reading_kwh: num(result.data["reading_kwh"]),
        meter_number: str(result.data["meter_number"]),
        confidence: result.confidence,
        raw_text: result.raw_text,
      };
    }

    // Payment receipt: persist the extraction against the submission.
    let extractionId: string | null = null;
    if (data.paymentSubmissionId) {
      const { data: submission, error: submissionError } = await context.supabase
        .from("payment_submissions")
        .select("id, property_id, status")
        .eq("id", data.paymentSubmissionId)
        .maybeSingle();
      if (submissionError) throw new Error(submissionError.message);
      if (!submission) throw new Error("Payment submission not found or not accessible.");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const confidence = result.confidence;
      const needsReview = confidence === null || confidence < 80;

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("ocr_extractions")
        .insert({
          evidence_id: evidence.id,
          payment_submission_id: submission.id,
          status: needsReview ? "needs_review" : "completed",
          provider: "lovable-ai",
          model: "google/gemini-2.5-flash",
          raw_text: result.raw_text,
          structured_data: result.data as never,
          amount: num(result.data["amount"]),
          amount_paid: num(result.data["amount_paid"]) ?? num(result.data["amount"]),
          units_kwh: num(result.data["units_kwh"]),
          meter_number: str(result.data["meter_number"]),
          beneficiary_id: str(result.data["beneficiary_id"]),
          token_last4: str(result.data["token_last4"]),
          transaction_reference: str(result.data["transaction_reference"]),
          transaction_number: str(result.data["transaction_number"]),
          customer_name: str(result.data["customer_name"]),
          service_address: str(result.data["service_address"]),
          transaction_date: str(result.data["transaction_date"]),
          tariff_class: str(result.data["tariff_class"]),
          tariff_rate: num(result.data["tariff_rate"]),
          confidence,
          field_confidence: {} as never,
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      extractionId = inserted.id;

      if (submission.status === "uploaded") {
        await supabaseAdmin
          .from("payment_submissions")
          .update({ status: "ocr_processed" })
          .eq("id", submission.id);
      }
    }

    return {
      extractionId,
      confidence: result.confidence,
      amount: num(result.data["amount"]),
      units_kwh: num(result.data["units_kwh"]),
      meter_number: str(result.data["meter_number"]),
      raw_text: result.raw_text,
    };
  });
