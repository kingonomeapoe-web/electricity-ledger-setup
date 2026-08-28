import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const revealInput = z.object({ extractionId: z.string().uuid() });

/**
 * Reveals the stored prepaid token for a receipt. Admin-only, and every reveal
 * writes an audit event. The full token is never sent to list views.
 */
export const revealPaymentToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => revealInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: extraction, error } = await context.supabase
      .from("ocr_extractions")
      .select(
        "id, token_ciphertext, token_last4, payment_submission_id, payment_submissions(property_id)",
      )
      .eq("id", data.extractionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!extraction) throw new Error("Extraction not found or not accessible.");

    const propertyId = (
      extraction as unknown as { payment_submissions: { property_id: string } | null }
    ).payment_submissions?.property_id;
    if (!propertyId) throw new Error("Extraction is not linked to a property.");

    const { data: isAdmin, error: roleError } = await context.supabase.rpc("is_property_admin", {
      p_property_id: propertyId,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Only an administrator of this property may reveal a token.");

    await context.supabase.rpc("log_admin_audit", {
      p_property_id: propertyId,
      p_event_type: "TOKEN_REVEALED",
      p_entity_type: "ocr_extraction",
      p_entity_id: extraction.id,
      p_metadata: { payment_submission_id: extraction.payment_submission_id },
    });

    return {
      token: extraction.token_ciphertext,
      tokenLast4: extraction.token_last4,
    };
  });
