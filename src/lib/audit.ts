import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

function asJson(value: unknown): Json | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

/**
 * Records an immutable audit event. audit_logs is insert-denied to clients,
 * so this goes through the admin-only log_admin_audit database function.
 */
export async function logAudit(params: {
  propertyId: string;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  metadata?: unknown;
}) {
  const oldData = asJson(params.oldData);
  const newData = asJson(params.newData);
  const { error } = await supabase.rpc("log_admin_audit", {
    p_property_id: params.propertyId,
    p_event_type: params.eventType,
    p_entity_type: params.entityType,
    ...(params.entityId ? { p_entity_id: params.entityId } : {}),
    ...(oldData !== null ? { p_old_data: oldData } : {}),
    ...(newData !== null ? { p_new_data: newData } : {}),
    p_metadata: (asJson(params.metadata) ?? {}) as Json,
  });
  if (error) throw new Error(error.message);
}

/** Tokens are never shown in full in list views. */
export function maskToken(last4: string | null | undefined) {
  if (!last4) return "—";
  return `•••• •••• •••• ${last4}`;
}

export function formatKwh(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })} kWh`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
