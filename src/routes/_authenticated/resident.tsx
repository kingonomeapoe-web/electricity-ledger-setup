import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { EvidenceUploader } from "@/components/EvidenceUploader";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/useAuth";
import type { EvidenceFile } from "@/lib/evidence";

export const Route = createFileRoute("/_authenticated/resident")({
  head: () => ({
    meta: [
      { title: "My receipts — Electricity Ledger" },
      {
        name: "description",
        content: "Upload your prepaid electricity payment receipt and track its review status.",
      },
      { property: "og:title", content: "My receipts — Electricity Ledger" },
      {
        property: "og:description",
        content: "Upload your prepaid electricity payment receipt and track its review status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResidentPage,
});

function ResidentPage() {
  const { user, loading } = useCurrentProfile();
  const queryClient = useQueryClient();

  const accountQuery = useQuery({
    queryKey: ["resident-account", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_accounts")
        .select("id, property_id, apartment_id, apartments(unit_name), properties(name)")
        .eq("resident_id", user!.id)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const account = accountQuery.data;

  const submissionsQuery = useQuery({
    queryKey: ["my-submissions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_submissions")
        .select(
          "id, status, submitted_at, rejection_reason, evidence_files(storage_path, original_filename, mime_type), ocr_extractions(id, status, amount, units_kwh, confidence)",
        )
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function createSubmission(evidence: EvidenceFile) {
    if (!account || !user) return;
    const { error } = await supabase.from("payment_submissions").insert({
      property_id: account.property_id,
      resident_id: user.id,
      apartment_id: account.apartment_id,
      evidence_id: evidence.id,
      status: "uploaded",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Receipt uploaded — pending OCR review.");
    await queryClient.invalidateQueries({ queryKey: ["my-submissions"] });
  }

  if (loading || accountQuery.isLoading) {
    return (
      <AppShell title="My electricity">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AppShell>
    );
  }

  if (!account) {
    return (
      <AppShell title="My electricity">
        <p className="text-sm text-muted-foreground">
          You are not linked to an apartment yet. Ask your building administrator to add you.
        </p>
      </AppShell>
    );
  }

  const apartment = (account as unknown as { apartments: { unit_name: string } | null }).apartments;
  const property = (account as unknown as { properties: { name: string } | null }).properties;

  return (
    <AppShell
      title="My electricity"
      subtitle={`${property?.name ?? "Property"} · ${apartment?.unit_name ?? "Apartment"}`}
    >
      <EvidenceUploader
        propertyId={account.property_id}
        evidenceType="payment_receipt"
        label="Upload payment receipt"
        hint="Photograph or attach the receipt for the electricity payment you made."
        onUploaded={createSubmission}
      />

      <h2 className="mt-8 mb-3 text-sm font-semibold">My submissions</h2>
      {submissionsQuery.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (submissionsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipts submitted yet.</p>
      ) : (
        <ul className="space-y-3">
          {(submissionsQuery.data ?? []).map((submission) => {
            const evidence = submission.evidence_files as unknown as {
              storage_path: string;
              original_filename: string | null;
              mime_type: string | null;
            } | null;
            const ocr = (submission.ocr_extractions as unknown as Array<{
              status: string;
              amount: number | null;
              units_kwh: number | null;
              confidence: number | null;
            }>)?.[0];

            return (
              <li key={submission.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(submission.submitted_at).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {submission.status === "uploaded" ? "Pending OCR" : "Under review"}
                    </p>
                  </div>
                  <StatusBadge state={submission.status} />
                </div>

                {ocr ? (
                  <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-3 text-xs">
                    <span>Amount read: {ocr.amount ?? "—"}</span>
                    <span>Units read: {ocr.units_kwh ?? "—"} kWh</span>
                    <span>
                      OCR confidence: {ocr.confidence !== null ? `${ocr.confidence}%` : "—"} · awaiting
                      administrator confirmation
                    </span>
                  </div>
                ) : null}

                {submission.rejection_reason ? (
                  <p className="mt-2 text-xs text-destructive">{submission.rejection_reason}</p>
                ) : null}

                {evidence ? (
                  <div className="mt-2">
                    <EvidenceViewer
                      storagePath={evidence.storage_path}
                      filename={evidence.original_filename}
                      mimeType={evidence.mime_type}
                      label="View receipt"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
