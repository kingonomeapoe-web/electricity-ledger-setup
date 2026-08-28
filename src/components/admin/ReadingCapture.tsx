import { useState } from "react";
import { Loader2, ScanLine, CheckCircle2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EvidenceUploader } from "@/components/EvidenceUploader";
import { StatusBadge } from "@/components/StatusBadge";
import { runEvidenceOcr } from "@/lib/ocr.functions";
import type { EvidenceFile, EvidenceType } from "@/lib/evidence";

export type ConfirmedReading = {
  evidenceId: string;
  readingKwh: number;
  ocrValueKwh: number | null;
  ocrConfidence: number | null;
  source: "manual" | "ocr_confirmed";
};

/**
 * Upload a meter photo, run assistive OCR, then require an explicit human
 * confirmation of the value before anything is written to the ledger tables.
 */
export function ReadingCapture({
  propertyId,
  evidenceType,
  label,
  hint,
  confirmLabel = "Confirm reading",
  extra,
  onConfirm,
  onEvidence,
}: {
  propertyId: string;
  evidenceType: EvidenceType;
  label: string;
  hint?: string;
  confirmLabel?: string;
  extra?: (readingKwh: number | null) => React.ReactNode;
  onConfirm: (reading: ConfirmedReading) => Promise<void>;
  onEvidence?: (evidence: EvidenceFile) => void;
}) {
  const ocr = useServerFn(runEvidenceOcr);

  const [evidence, setEvidence] = useState<EvidenceFile | null>(null);
  const [state, setState] = useState<
    "idle" | "uploaded" | "processing" | "ocr_complete" | "needs_review" | "confirmed" | "failed"
  >("idle");
  const [ocrValue, setOcrValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function handleUploaded(file: EvidenceFile) {
    setEvidence(file);
    setState("uploaded");
    onEvidence?.(file);
    setState("processing");
    try {
      const result = await ocr({ data: { evidenceId: file.id, kind: "meter_reading" } });
      const reading = (result as { reading_kwh: number | null }).reading_kwh;
      const conf = (result as { confidence: number | null }).confidence;
      setOcrValue(reading);
      setConfidence(conf);
      if (reading !== null) setValue(String(reading));
      setState(reading === null || conf === null || conf < 80 ? "needs_review" : "ocr_complete");
    } catch (error) {
      setState("needs_review");
      toast.error(
        error instanceof Error ? `OCR unavailable: ${error.message}` : "OCR unavailable — enter the reading manually",
      );
    }
  }

  const parsed = value === "" ? null : Number(value);

  async function confirm() {
    if (!evidence) return;
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
      toast.error("Enter a valid meter reading in kWh.");
      return;
    }
    setSaving(true);
    try {
      await onConfirm({
        evidenceId: evidence.id,
        readingKwh: parsed,
        ocrValueKwh: ocrValue,
        ocrConfidence: confidence,
        source: ocrValue !== null && ocrValue === parsed ? "ocr_confirmed" : "manual",
      });
      setState("confirmed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the reading");
    } finally {
      setSaving(false);
    }
  }

  if (state === "confirmed") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm">
        <CheckCircle2 className="h-4 w-4 text-chart-2" />
        Reading confirmed and recorded.
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEvidence(null);
            setState("idle");
            setValue("");
            setOcrValue(null);
            setConfidence(null);
          }}
        >
          Capture another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <EvidenceUploader
        propertyId={propertyId}
        evidenceType={evidenceType}
        label={label}
        hint={hint}
        onUploaded={handleUploaded}
      />

      {evidence ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ScanLine className="h-4 w-4 text-primary" /> OCR result
            </p>
            <StatusBadge state={state} />
          </div>

          {state === "processing" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the meter display…
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Suggested reading: <span className="font-medium text-foreground">{ocrValue ?? "—"}</span> kWh ·
                confidence {confidence !== null ? `${confidence}%` : "unavailable"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                OCR is advisory. Check the photo and correct the value before confirming.
              </p>

              <div className="mt-3 space-y-1.5">
                <Label htmlFor="reading">Reading (kWh)</Label>
                <Input
                  id="reading"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g. 12345.678"
                />
              </div>

              {extra ? <div className="mt-3">{extra(parsed)}</div> : null}

              <Button className="mt-4" disabled={saving} onClick={() => void confirm()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {confirmLabel}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
