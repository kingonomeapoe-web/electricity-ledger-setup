import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ScanLine, Fuel } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EvidenceUploader } from "@/components/EvidenceUploader";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { ReadingCapture } from "@/components/admin/ReadingCapture";
import { supabase } from "@/integrations/supabase/client";
import { runEvidenceOcr } from "@/lib/ocr.functions";

type Submission = {
  id: string;
  status: string;
  submitted_at: string;
  apartment_id: string;
  evidence_id: string;
  apartments: { unit_name: string } | null;
  profiles: { full_name: string } | null;
  evidence_files: {
    storage_path: string;
    original_filename: string | null;
    mime_type: string | null;
  } | null;
  ocr_extractions: Array<{
    id: string;
    status: string;
    amount: number | null;
    units_kwh: number | null;
    token_last4: string | null;
    meter_number: string | null;
    confidence: number | null;
  }>;
};

export function PaymentsPanel({ propertyId, userId }: { propertyId: string; userId: string }) {
  const queryClient = useQueryClient();
  const ocr = useServerFn(runEvidenceOcr);
  const [processing, setProcessing] = useState<string | null>(null);
  const [loadFor, setLoadFor] = useState<Submission | null>(null);

  const submissionsQuery = useQuery({
    queryKey: ["admin-submissions", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_submissions")
        .select(
          "id, status, submitted_at, apartment_id, evidence_id, apartments(unit_name), profiles(full_name), evidence_files(storage_path, original_filename, mime_type), ocr_extractions(id, status, amount, units_kwh, token_last4, meter_number, confidence)",
        )
        .eq("property_id", propertyId)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Submission[];
    },
  });

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

  async function runOcr(submission: Submission) {
    setProcessing(submission.id);
    try {
      await ocr({
        data: {
          evidenceId: submission.evidence_id,
          kind: "payment_receipt",
          paymentSubmissionId: submission.id,
        },
      });
      toast.success("OCR complete — review the extracted values.");
      await queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OCR failed");
    } finally {
      setProcessing(null);
    }
  }

  async function reject(submission: Submission) {
    const reason = window.prompt("Reason for rejecting this receipt?");
    if (!reason) return;
    const { error } = await supabase
      .from("payment_submissions")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
      })
      .eq("id", submission.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
  }

  if (submissionsQuery.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const submissions = submissionsQuery.data ?? [];

  return (
    <div className="space-y-3">
      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment receipts submitted yet.</p>
      ) : null}

      {submissions.map((submission) => {
        const extraction = submission.ocr_extractions?.[0];
        return (
          <div key={submission.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {submission.apartments?.unit_name ?? "Apartment"} ·{" "}
                  {submission.profiles?.full_name ?? "Resident"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(submission.submitted_at).toLocaleString()}
                </p>
              </div>
              <StatusBadge state={submission.status} />
            </div>

            {extraction ? (
              <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-3 text-xs">
                <span>Amount: {extraction.amount ?? "—"}</span>
                <span>Units on receipt: {extraction.units_kwh ?? "—"} kWh</span>
                <span>Meter number: {extraction.meter_number ?? "—"}</span>
                <span>Token last 4: {extraction.token_last4 ?? "—"}</span>
                <span>
                  Confidence: {extraction.confidence !== null ? `${extraction.confidence}%` : "—"} ·{" "}
                  {extraction.status === "needs_review" ? "needs review" : "OCR complete"}
                </span>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {submission.evidence_files ? (
                <EvidenceViewer
                  storagePath={submission.evidence_files.storage_path}
                  filename={submission.evidence_files.original_filename}
                  mimeType={submission.evidence_files.mime_type}
                  label="View receipt"
                />
              ) : null}

              {!extraction ? (
                <Button size="sm" variant="secondary" disabled={processing === submission.id} onClick={() => void runOcr(submission)}>
                  {processing === submission.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="mr-2 h-4 w-4" />
                  )}
                  Run OCR
                </Button>
              ) : null}

              {submission.status !== "rejected" && submission.status !== "credited" ? (
                <>
                  <Button size="sm" onClick={() => setLoadFor(submission)}>
                    <Fuel className="mr-2 h-4 w-4" /> Record token load
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void reject(submission)}>
                    Reject
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      <Dialog open={!!loadFor} onOpenChange={(open) => !open && setLoadFor(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record central meter token load</DialogTitle>
            <DialogDescription>
              Load the token onto the central prepaid meter, then upload the load evidence and a photo
              of the meter display. Nothing is credited until the reading is confirmed.
            </DialogDescription>
          </DialogHeader>

          {loadFor ? (
            <TokenLoadFlow
              propertyId={propertyId}
              userId={userId}
              meterId={meterQuery.data?.id ?? null}
              submissionId={loadFor.id}
              onDone={async () => {
                setLoadFor(null);
                await queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TokenLoadFlow({
  propertyId,
  userId,
  meterId,
  submissionId,
  onDone,
}: {
  propertyId: string;
  userId: string;
  meterId: string | null;
  submissionId: string;
  onDone: () => Promise<void>;
}) {
  const [loadEvidenceId, setLoadEvidenceId] = useState<string | null>(null);
  const [tokenLast4, setTokenLast4] = useState("");

  if (!meterId) {
    return (
      <p className="text-sm text-muted-foreground">
        Add an active main prepaid meter in Property setup before recording token loads.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <EvidenceUploader
        propertyId={propertyId}
        evidenceType="central_meter_load"
        label="Token load evidence"
        hint="Screenshot or photo showing the token being loaded onto the central meter."
        onUploaded={(evidence) => setLoadEvidenceId(evidence.id)}
      />

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="token4">
          Token last 4 digits (optional)
        </label>
        <Input id="token4" maxLength={4} value={tokenLast4} onChange={(e) => setTokenLast4(e.target.value)} />
      </div>

      {loadEvidenceId ? (
        <ReadingCapture
          propertyId={propertyId}
          evidenceType="central_meter_reading"
          label="Central meter display after loading"
          hint="Photograph the meter so the post-load balance is evidenced."
          confirmLabel="Confirm post-load reading"
          onConfirm={async (reading) => {
            const now = new Date().toISOString();
            const { error } = await supabase.from("central_meter_readings").insert({
              meter_id: meterId,
              reading_kwh: reading.readingKwh,
              reading_kind: "post_load",
              source: reading.source,
              evidence_id: reading.evidenceId,
              ocr_value_kwh: reading.ocrValueKwh,
              ocr_confidence: reading.ocrConfidence,
              confirmed_value_kwh: reading.readingKwh,
              captured_at: now,
              confirmed_at: now,
              captured_by: userId,
              confirmed_by: userId,
              notes: tokenLast4 ? `Token ending ${tokenLast4}` : null,
            });
            if (error) throw new Error(error.message);

            const { error: updateError } = await supabase
              .from("payment_submissions")
              .update({ status: "loaded", reviewed_at: now, reviewed_by: userId })
              .eq("id", submissionId);
            if (updateError) throw new Error(updateError.message);

            toast.success("Token load evidenced and post-load reading confirmed.");
            await onDone();
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Upload the load evidence first.</p>
      )}
    </div>
  );
}
