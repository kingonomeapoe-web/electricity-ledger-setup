import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatKwh, logAudit } from "@/lib/audit";

type Reading = {
  id: string;
  reading_kwh: number;
  previous_reading_kwh: number | null;
  units_consumed_kwh: number | null;
  source: string;
  ocr_value_kwh: number | null;
  ocr_confidence: number | null;
  captured_at: string;
  confirmed_at: string | null;
  notes: string | null;
  evidence_files: {
    storage_path: string;
    original_filename: string | null;
    mime_type: string | null;
  } | null;
  submeters: {
    id: string;
    identifier: string;
    apartments: { id: string; unit_name: string; property_id: string } | null;
  } | null;
};

export function SubmeterReviewPanel({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const readingsQuery = useQuery({
    queryKey: ["review-submeter-readings", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("submeter_readings")
        .select(
          "id, reading_kwh, previous_reading_kwh, units_consumed_kwh, source, ocr_value_kwh, ocr_confidence, captured_at, confirmed_at, notes, evidence_files(storage_path, original_filename, mime_type), submeters!inner(id, identifier, apartments!inner(id, unit_name, property_id))",
        )
        .eq("submeters.apartments.property_id", propertyId)
        .order("captured_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Reading[];
    },
  });

  const residentsQuery = useQuery({
    queryKey: ["review-residents", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_accounts")
        .select("apartment_id, profiles(full_name)")
        .eq("property_id", propertyId)
        .eq("active", true);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of data ?? []) {
        const name = (row as unknown as { profiles: { full_name: string } | null }).profiles
          ?.full_name;
        if (name) map.set(row.apartment_id, name);
      }
      return map;
    },
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["review-submeter-readings"] });
    await queryClient.invalidateQueries({ queryKey: ["review-summary"] });
    await queryClient.invalidateQueries({ queryKey: ["review-ledger"] });
    await queryClient.invalidateQueries({ queryKey: ["review-audit"] });
  }

  async function confirmAndPost(reading: Reading) {
    setBusy(reading.id);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("submeter_readings")
        .update({ confirmed_at: now, confirmed_by: userId, confirmed_value_kwh: reading.reading_kwh })
        .eq("id", reading.id);
      if (error) throw new Error(error.message);

      const { data: txId, error: rpcError } = await supabase.rpc(
        "post_confirmed_submeter_consumption",
        { p_submeter_reading_id: reading.id },
      );
      if (rpcError) throw new Error(rpcError.message);

      await logAudit({
        propertyId,
        eventType: "SUBMETER_READING_CONFIRMED",
        entityType: "submeter_reading",
        entityId: reading.id,
        oldData: { confirmed_at: null },
        newData: {
          confirmed_at: now,
          reading_kwh: reading.reading_kwh,
          units_consumed_kwh: reading.units_consumed_kwh,
        },
        metadata: { ledger_transaction_id: txId },
      });
      toast.success("Reading confirmed and consumption posted to the resident ledger.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not confirm reading");
    } finally {
      setBusy(null);
    }
  }

  async function annotate(reading: Reading, eventType: string, promptText: string) {
    const note = window.prompt(promptText);
    if (!note) return;
    await logAudit({
      propertyId,
      eventType,
      entityType: "submeter_reading",
      entityId: reading.id,
      oldData: { confirmed_at: reading.confirmed_at },
      newData: { outcome: eventType, note },
    });
    toast.success("Recorded in the audit trail.");
    await refresh();
  }

  if (readingsQuery.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  const readings = readingsQuery.data ?? [];
  if (readings.length === 0) {
    return <p className="text-sm text-muted-foreground">No submeter readings captured yet.</p>;
  }

  return (
    <div className="space-y-3">
      {readings.map((r) => {
        const apartment = r.submeters?.apartments;
        const resident = apartment ? residentsQuery.data?.get(apartment.id) : undefined;
        return (
          <div key={r.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {apartment?.unit_name ?? "Apartment"} · {resident ?? "Unassigned"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Submeter {r.submeters?.identifier ?? "—"} · captured {formatDateTime(r.captured_at)}
                </p>
              </div>
              <StatusBadge state={r.confirmed_at ? "confirmed" : "needs_review"} />
            </div>

            <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-2">
              <span>Previous reading: {formatKwh(r.previous_reading_kwh)}</span>
              <span>Current reading: {formatKwh(r.reading_kwh)}</span>
              <span>Consumption: {formatKwh(r.units_consumed_kwh)}</span>
              <span>
                OCR: {r.ocr_value_kwh ?? "—"}
                {r.ocr_confidence !== null ? ` · ${r.ocr_confidence}% confidence` : ""}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {r.evidence_files ? (
                <EvidenceViewer
                  storagePath={r.evidence_files.storage_path}
                  filename={r.evidence_files.original_filename}
                  mimeType={r.evidence_files.mime_type}
                  label="Inspect photograph"
                />
              ) : null}
              {!r.confirmed_at ? (
                <>
                  <Button size="sm" disabled={busy === r.id} onClick={() => void confirmAndPost(r)}>
                    {busy === r.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm &amp; post consumption
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void annotate(r, "SUBMETER_READING_REJECTED", "Reason for rejecting this reading?")}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void annotate(r, "SUBMETER_REREAD_REQUESTED", "What should be re-photographed?")
                    }
                  >
                    Request another reading
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
