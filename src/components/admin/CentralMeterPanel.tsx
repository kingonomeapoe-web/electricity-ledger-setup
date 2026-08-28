import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ReadingCapture } from "@/components/admin/ReadingCapture";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";

export function CentralMeterPanel({ propertyId, userId }: { propertyId: string; userId: string }) {
  const queryClient = useQueryClient();

  const meterQuery = useQuery({
    queryKey: ["main-meter", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meters")
        .select("id, identifier, meter_number")
        .eq("property_id", propertyId)
        .eq("meter_type", "prepaid_main")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const meter = meterQuery.data;

  const readingsQuery = useQuery({
    queryKey: ["central-readings", meter?.id],
    enabled: !!meter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("central_meter_readings")
        .select(
          "id, reading_kwh, reading_kind, source, ocr_value_kwh, ocr_confidence, confirmed_at, captured_at, evidence_files(storage_path, original_filename, mime_type)",
        )
        .eq("meter_id", meter!.id)
        .order("captured_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  if (meterQuery.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  if (!meter) {
    return (
      <p className="text-sm text-muted-foreground">
        No active main prepaid meter for this property yet. Add one in Property setup.
      </p>
    );
  }

  const hasReadings = (readingsQuery.data ?? []).length > 0;

  return (
    <div className="space-y-6">
      <ReadingCapture
        propertyId={propertyId}
        evidenceType="central_meter_reading"
        label={`Photograph the central meter (${meter.identifier})`}
        hint="Capture the prepaid meter display so the balance is evidenced."
        confirmLabel="Confirm central meter reading"
        onConfirm={async (reading) => {
          const { error } = await supabase.from("central_meter_readings").insert({
            meter_id: meter.id,
            reading_kwh: reading.readingKwh,
            reading_kind: hasReadings ? "snapshot" : "opening",
            source: reading.source,
            evidence_id: reading.evidenceId,
            ocr_value_kwh: reading.ocrValueKwh,
            ocr_confidence: reading.ocrConfidence,
            confirmed_value_kwh: reading.readingKwh,
            captured_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
            captured_by: userId,
            confirmed_by: userId,
          });
          if (error) throw new Error(error.message);
          toast.success("Central meter reading confirmed.");
          await queryClient.invalidateQueries({ queryKey: ["central-readings"] });
        }}
      />

      <div>
        <h3 className="mb-3 text-sm font-semibold">Recent central meter readings</h3>
        {readingsQuery.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !hasReadings ? (
          <p className="text-sm text-muted-foreground">No readings recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {(readingsQuery.data ?? []).map((reading) => {
              const evidence = reading.evidence_files as unknown as {
                storage_path: string;
                original_filename: string | null;
                mime_type: string | null;
              } | null;
              return (
                <li
                  key={reading.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{reading.reading_kwh} kWh</p>
                    <p className="text-xs text-muted-foreground">
                      {reading.reading_kind} · {new Date(reading.captured_at).toLocaleString()} · OCR{" "}
                      {reading.ocr_value_kwh ?? "—"}
                      {reading.ocr_confidence !== null ? ` (${reading.ocr_confidence}%)` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge state={reading.confirmed_at ? "confirmed" : "needs_review"} />
                    {evidence ? (
                      <EvidenceViewer
                        storagePath={evidence.storage_path}
                        filename={evidence.original_filename}
                        mimeType={evidence.mime_type}
                        label="Photo"
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
