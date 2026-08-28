import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ReadingCapture } from "@/components/admin/ReadingCapture";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

export function SubmeterPanel({ propertyId, userId }: { propertyId: string; userId: string }) {
  const queryClient = useQueryClient();
  const [submeterId, setSubmeterId] = useState<string>("");

  const submetersQuery = useQuery({
    queryKey: ["submeters", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apartments")
        .select("id, unit_name, submeters(id, identifier, active)")
        .eq("property_id", propertyId)
        .eq("active", true)
        .order("unit_name");
      if (error) throw error;
      return data;
    },
  });

  const options = (submetersQuery.data ?? []).flatMap((apartment) =>
    ((apartment as unknown as { submeters: Array<{ id: string; identifier: string; active: boolean }> })
      .submeters ?? [])
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, label: `${apartment.unit_name} · ${s.identifier}` })),
  );

  const readingsQuery = useQuery({
    queryKey: ["submeter-readings", submeterId],
    enabled: !!submeterId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("submeter_readings")
        .select(
          "id, reading_kwh, previous_reading_kwh, units_consumed_kwh, reading_kind, source, ocr_value_kwh, ocr_confidence, confirmed_at, captured_at, evidence_files(storage_path, original_filename, mime_type)",
        )
        .eq("submeter_id", submeterId)
        .order("captured_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const latest = readingsQuery.data?.[0];
  const previous = latest?.reading_kwh ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label>Apartment submeter</Label>
        <Select value={submeterId} onValueChange={setSubmeterId}>
          <SelectTrigger>
            <SelectValue placeholder="Select an apartment submeter" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.length === 0 && !submetersQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">
            No submeters yet. Add apartments and submeters in Property setup.
          </p>
        ) : null}
      </div>

      {submeterId ? (
        <>
          <p className="text-sm text-muted-foreground">
            Previous confirmed reading: <span className="font-medium text-foreground">{previous ?? "none"}</span>
            {previous !== null ? " kWh" : ""}
          </p>

          <ReadingCapture
            key={submeterId}
            propertyId={propertyId}
            evidenceType="submeter_reading"
            label="Photograph the apartment submeter"
            hint="Capture the submeter display for this apartment."
            confirmLabel="Confirm submeter reading"
            extra={(value) => (
              <div className="rounded-lg bg-muted/50 p-3 text-xs">
                Consumption since last reading:{" "}
                <span className="font-medium text-foreground">
                  {value !== null && previous !== null
                    ? `${Math.round((value - previous) * 1000) / 1000} kWh`
                    : previous === null
                      ? "opening reading (no consumption)"
                      : "—"}
                </span>
                {value !== null && previous !== null && value < previous ? (
                  <span className="ml-2 text-destructive">Reading cannot be lower than the previous one.</span>
                ) : null}
              </div>
            )}
            onConfirm={async (reading) => {
              const { error } = await supabase.from("submeter_readings").insert({
                submeter_id: submeterId,
                reading_kind: previous === null ? "opening" : "snapshot",
                reading_kwh: reading.readingKwh,
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
              toast.success("Submeter reading confirmed.");
              await queryClient.invalidateQueries({ queryKey: ["submeter-readings"] });
            }}
          />

          <div>
            <h3 className="mb-3 text-sm font-semibold">Reading history</h3>
            {readingsQuery.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (readingsQuery.data ?? []).length === 0 ? (
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
                        <p className="font-medium">
                          {reading.reading_kwh} kWh · consumed {reading.units_consumed_kwh ?? 0} kWh
                        </p>
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
        </>
      ) : null}
    </div>
  );
}
