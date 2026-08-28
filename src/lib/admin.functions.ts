import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Bootstrap: the very first signed-in user of a fresh deployment can claim the
 * administrator role. Once any administrator exists this is a no-op.
 */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) throw new Error("An administrator already exists for this system.");

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", context.userId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });

const createPropertyInput = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(300).optional().nullable(),
});

/** Creates a property and makes the caller its owner-admin member. */
export const createProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createPropertyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("is_admin");
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Only an administrator can create a property.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: property, error } = await supabaseAdmin
      .from("properties")
      .insert({
        name: data.name,
        address: data.address ?? null,
        created_by: context.userId,
        activated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { error: memberError } = await supabaseAdmin.from("property_members").insert({
      property_id: property.id,
      user_id: context.userId,
      role: "owner_admin",
    });
    if (memberError) throw new Error(memberError.message);

    return property;
  });

const linkResidentInput = z.object({
  propertyId: z.string().uuid(),
  apartmentId: z.string().uuid(),
  email: z.string().email(),
});

/** Links an existing signed-up user to an apartment as a resident. */
export const linkResident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkResidentInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isPropertyAdmin, error: roleError } = await context.supabase.rpc(
      "is_property_admin",
      { p_property_id: data.propertyId },
    );
    if (roleError) throw new Error(roleError.message);
    if (!isPropertyAdmin) throw new Error("You do not administer this property.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("No account found with that email. Ask them to sign up first.");

    const { error: memberError } = await supabaseAdmin.from("property_members").upsert(
      {
        property_id: data.propertyId,
        user_id: profile.id,
        role: "resident",
        apartment_id: data.apartmentId,
        active: true,
      },
      { onConflict: "property_id,user_id,role" },
    );
    if (memberError) throw new Error(memberError.message);

    const { data: account, error: accountError } = await supabaseAdmin
      .from("resident_accounts")
      .upsert(
        {
          resident_id: profile.id,
          property_id: data.propertyId,
          apartment_id: data.apartmentId,
          active: true,
        },
        { onConflict: "apartment_id,resident_id" },
      )
      .select("id")
      .single();
    if (accountError) throw new Error(accountError.message);

    const { data: ledger } = await supabaseAdmin
      .from("ledger_accounts")
      .select("id")
      .eq("resident_account_id", account.id)
      .maybeSingle();
    if (!ledger) {
      const { error: ledgerError } = await supabaseAdmin
        .from("ledger_accounts")
        .insert({ resident_account_id: account.id });
      if (ledgerError) throw new Error(ledgerError.message);
    }

    return { ok: true };
  });
