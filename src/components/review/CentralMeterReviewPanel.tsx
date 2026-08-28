import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatKwh, logAudit } from "@/lib/audit";

type Reading = {
  id: string;
  reading_kwh: number;
  reading_kind: string;
  source: string;
  ocr_value_kwh: number | null;
  ocr_confidence: number | null;
  captured_at: string;
  confirmed_at: string | null;
  evidence_files: {
    storage_path: string;
    original_filename: string | null;
    mime_type: string | null;
  } | null;
};

type Load = {
  id: string;
  units_loaded_kwh: number;
  amount_paid: number;
  central_balance_before_kwh: number;
  central_balance_after_kwh: number;
  loaded_at: string;
  confirmed_at: string | null;
  status: string;
  notes: string | null;
};

export function CentralMeterReviewPanel({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();

  const meterQuery = useQuery({
    queryKey: ["main-meter", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meters")
        .select("id, identifier")
        .eq("property_id", propertyId)
        .eq("meter_type", "prepaid_main")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const meterId = meterQuery.data?.id ?? null;

  const readingsQuery = useQuery({
    queryKey: ["review-central-readings", meterId],
    enabled: !!meterId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("central_meter_readings")
        .select(
          "id, reading_kwh, reading_kind, source, ocr_value_kwh, ocr_confidence, captured_at, confirmed_at, evidence_files(storage_path, original_filename, mime_type)",
        )
        .eq("meter_id", meterId!)
        .order("captured_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Reading[];
    },
  });

  const loadsQuery = useQuery({
    queryKey: ["review-central-loads", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("central_meter_loads")
        .select(
          "id, units_loaded_kwh, amount_paid, central_balance_before_kwh, central_balance_after_kwh, loaded_at, confirmed_at, status, notes",
        )
        .eq("property_id", propertyId)
        .order("loaded_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Load[];
    },
  });

  async function confirmReading(reading: Reading) {
    const { error } = await supabase
      .from("central_meter_readings")
      .update({ confirmed_at: new Date().toISOString(), confirmed_by: userId })
      .eq("id", reading.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      propertyId,
      eventType: "CENTRAL_READING_CONFIRMED",
      entityType: "central_meter_reading",
      entityId: reading.id,
      oldData: { confirmed_at: null },
      newData: { confirmed_at: new Date().toISOString(), reading_kwh: reading.reading_kwh },
    });
    await queryClient.invalidateQueries({ queryKey: ["review-central-readings"] });
    await queryClient.invalidateQueries({ queryKey: ["review-summary"] });
    toast.success("Reading confirmed.");
  }

  if (!meterQuery.isLoading && !meterId) {
    return (
      <p className="text-sm text-muted-foreground">
        No active main prepaid meter configured for this property.
      </p>
    );
  }
  if (readingsQuery.isLoading || loadsQuery.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const readings = readingsQuery.data ?? [];
  const loads = loadsQuery.data ?? [];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-sm font-semibold">Central meter loading events</h3>
        {loads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No token loads recorded yet.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loaded at</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance before</TableHead>
                    <TableHead className="text-right">Balance after</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Confirmed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loads.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{formatDateTime(l.loaded_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatKwh(l.units_loaded_kwh)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.amount_paid}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatKwh(l.central_balance_before_kwh)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatKwh(l.central_balance_after_kwh)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge state={l.status} />
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(l.confirmed_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 md:hidden">
              {loads.map((l) => (
                <div key={l.id} className="rounded-xl border border-border bg-card p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{formatKwh(l.units_loaded_kwh)}</span>
                    <StatusBadge state={l.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(l.loaded_at)} · {formatKwh(l.central_balance_before_kwh)} →{" "}
                    {formatKwh(l.central_balance_after_kwh)}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Central meter readings</h3>
        {readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No central meter readings captured yet.</p>
        ) : (
          <div className="space-y-3">
            {readings.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {formatKwh(r.reading_kwh)} · {r.reading_kind.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Captured {formatDateTime(r.captured_at)} · OCR{" "}
                      {r.ocr_value_kwh ?? "—"} ·{" "}
                      {r.ocr_confidence !== null ? `${r.ocr_confidence}% confidence` : "no confidence"}
                    </p>
                  </div>
                  <StatusBadge state={r.confirmed_at ? "confirmed" : "needs_review"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.evidence_files ? (
                    <EvidenceViewer
                      storagePath={r.evidence_files.storage_path}
                      filename={r.evidence_files.original_filename}
                      mimeType={r.evidence_files.mime_type}
                      label="View photograph"
                    />
                  ) : null}
                  {!r.confirmed_at ? (
                    <Button size="sm" onClick={() => void confirmReading(r)}>
                      Confirm reading
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
