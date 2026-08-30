import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";

type UntypedRpcClient = {
  rpc: (
    fn: string,
    args?: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
import { runEvidenceOcr } from "@/lib/ocr.functions";

type Submission = {
  id: string;
  status: string;
  submitted_at: string;
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

export function PaymentsPanel({ propertyId }: { propertyId: string; userId: string }) {
  const queryClient = useQueryClient();
  const ocr = useServerFn(runEvidenceOcr);
  const [processing, setProcessing] = useState<string | null>(null);

  const submissionsQuery = useQuery({
    queryKey: ["admin-submissions", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_submissions")
        .select(
          "id, status, submitted_at, evidence_id, apartments(unit_name), profiles(full_name), evidence_files(storage_path, original_filename, mime_type), ocr_extractions(id, status, amount, units_kwh, token_last4, meter_number, confidence)",
        )
        .eq("property_id", propertyId)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Submission[];
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
      toast.success("OCR complete — review the extracted values in Review & reconciliation.");
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
    const { error } = await (supabase as unknown as UntypedRpcClient).rpc(
      "admin_transition_payment_status",
      {
        p_payment_submission_id: submission.id,
        p_new_status: "rejected" as never,
        p_reason: reason,
      } as never,
    );
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
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Payment loading and resident crediting now use one authoritative workflow in Review &
        reconciliation. This panel is limited to receipt viewing, OCR, and rejection.
      </p>
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
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={processing === submission.id}
                  onClick={() => void runOcr(submission)}
                >
                  {processing === submission.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="mr-2 h-4 w-4" />
                  )}
                  Run OCR
                </Button>
              ) : null}

              {submission.status !== "rejected" && submission.status !== "credited" ? (
                <Button size="sm" variant="ghost" onClick={() => void reject(submission)}>
                  Reject
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
