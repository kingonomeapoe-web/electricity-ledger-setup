import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const submitInput = z.object({ evidenceId: z.string().uuid() });

/**
 * Creates a payment submission for the signed-in resident from an already
 * uploaded receipt. Residents never supply units, tokens or amounts — those
 * come from OCR and are confirmed by an administrator.
 */
export const submitPaymentReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => submitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: evidence, error: evidenceError } = await context.supabase
      .from("evidence_files")
      .select("id, property_id, evidence_type, uploaded_by")
      .eq("id", data.evidenceId)
      .maybeSingle();
    if (evidenceError) throw new Error(evidenceError.message);
    if (!evidence) throw new Error("Receipt evidence not found.");
    if (evidence.uploaded_by !== context.userId) {
      throw new Error("You can only submit receipts that you uploaded.");
    }
    if (evidence.evidence_type !== "payment_receipt") {
      throw new Error("This evidence is not a payment receipt.");
    }

    const { data: account, error: accountError } = await context.supabase
      .from("resident_accounts")
      .select("id, property_id, apartment_id")
      .eq("resident_id", context.userId)
      .eq("property_id", evidence.property_id)
      .eq("active", true)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (!account) throw new Error("You are not linked to an apartment in this property.");

    const { data: submission, error } = await context.supabase
      .from("payment_submissions")
      .insert({
        property_id: account.property_id,
        resident_id: context.userId,
        apartment_id: account.apartment_id,
        evidence_id: evidence.id,
        status: "uploaded",
      })
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      property_id: account.property_id,
      actor_id: context.userId,
      event_type: "RECEIPT_UPLOADED",
      entity_type: "payment_submission",
      entity_id: submission.id,
      new_data: { status: "uploaded", evidence_id: evidence.id },
      metadata: { apartment_id: account.apartment_id } as never,
    });

    return { submissionId: submission.id };
  });
