import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Zap, Receipt, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { EvidenceUploader } from "@/components/EvidenceUploader";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/useAuth";
import { submitPaymentReceipt } from "@/lib/payments.functions";
import { runEvidenceOcr } from "@/lib/ocr.functions";
import { maskedToken } from "@/lib/token";
import type { EvidenceFile } from "@/lib/evidence";

export const Route = createFileRoute("/_authenticated/resident")({
  head: () => ({
    meta: [
      { title: "My electricity — Electricity Ledger" },
      {
        name: "description",
        content:
          "See your confirmed electricity balance, upload a prepaid payment receipt and follow it through review to credit.",
      },
      { property: "og:title", content: "My electricity — Electricity Ledger" },
      {
        property: "og:description",
        content:
          "Confirmed kWh balance, receipt uploads and the live status of every payment you submitted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResidentPage,
});

const STATUS_COPY: Record<string, string> = {
  uploaded: "Uploaded — reading your receipt",
  ocr_processed: "Receipt read — awaiting administrator review",
  pending_approval: "Pending administrator approval",
  approved_for_loading: "Approved — token will be loaded onto the building meter",
  loaded: "Token loaded — awaiting meter confirmation",
  credited: "Credited to your balance",
  rejected: "Rejected",
  duplicate: "Flagged as a duplicate receipt",
  disputed: "Under dispute",
  correction_required: "Correction required",
};

function ResidentPage() {
  const { user, loading } = useCurrentProfile();
  const queryClient = useQueryClient();
  const submit = useServerFn(submitPaymentReceipt);
  const ocr = useServerFn(runEvidenceOcr);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

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

  const ledgerQuery = useQuery({
    queryKey: ["resident-ledger", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_transactions")
        .select("id, transaction_type, units_kwh, balance_after_kwh, description, created_at")
        .eq("resident_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data;
    },
  });

  const meterQuery = useQuery({
    queryKey: ["resident-main-meter", account?.property_id],
    enabled: !!account?.property_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meters")
        .select("identifier, meter_number, provider")
        .eq("property_id", account!.property_id)
        .eq("meter_type", "prepaid_main")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const submissionsQuery = useQuery({
    queryKey: ["my-submissions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_submissions")
        .select(
          "id, status, submitted_at, rejection_reason, evidence_files(storage_path, original_filename, mime_type), ocr_extractions(id, status, amount, units_kwh, token_last4, confidence)",
        )
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function handleUploaded(evidence: EvidenceFile) {
    setWorking("Recording your receipt…");
    try {
      const { submissionId } = await submit({ data: { evidenceId: evidence.id } });
      await queryClient.invalidateQueries({ queryKey: ["my-submissions"] });
      setWorking("Reading your receipt…");
      try {
        await ocr({
          data: {
            evidenceId: evidence.id,
            kind: "payment_receipt",
            paymentSubmissionId: submissionId,
          },
        });
        toast.success("Receipt received — an administrator will review and load your token.");
      } catch (error) {
        toast.warning(
          error instanceof Error
            ? `Receipt stored, but automatic reading failed: ${error.message}`
            : "Receipt stored — an administrator will read it manually.",
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["my-submissions"] });
      setUploadOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the receipt");
    } finally {
      setWorking(null);
    }
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
  const ledger = ledgerQuery.data ?? [];
  const balance = ledger[0]?.balance_after_kwh ?? 0;
  const lastCredit = ledger.find((row) => row.transaction_type === "credit");

  return (
    <AppShell
      title="My electricity"
      subtitle={`${property?.name ?? "Property"} · ${apartment?.unit_name ?? "Apartment"}`}
    >
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary" /> Confirmed balance
            </p>
            <p className="mt-2 text-4xl font-semibold tabular-nums text-foreground">
              {Number(balance).toFixed(3)}
              <span className="ml-2 text-base font-normal text-muted-foreground">kWh</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every unit here comes from a confirmed token load on the building's prepaid meter.
            </p>
          </div>
          <StatusBadge state="confirmed" />
        </div>

        {meterQuery.data ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Building prepaid meter:{" "}
            <span className="font-medium text-foreground">
              {meterQuery.data.meter_number ?? meterQuery.data.identifier}
            </span>
            {meterQuery.data.provider ? ` · ${meterQuery.data.provider}` : ""}
          </p>
        ) : null}

        {lastCredit ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-chart-2" />
            <span>
              Last credit: {Number(lastCredit.units_kwh).toFixed(3)} kWh on{" "}
              {new Date(lastCredit.created_at).toLocaleString()} — balance became{" "}
              {Number(lastCredit.balance_after_kwh).toFixed(3)} kWh.
            </span>
          </div>
        ) : null}

        <div className="mt-5">
          {uploadOpen ? (
            <div className="space-y-3">
              <EvidenceUploader
                propertyId={account.property_id}
                evidenceType="payment_receipt"
                label="Upload your payment receipt"
                hint="JPG, PNG, WEBP or PDF. Take a photo of the receipt or attach the file you were sent."
                disabled={!!working}
                onUploaded={handleUploaded}
              />
              {working ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {working}
                </p>
              ) : null}
              <Button variant="ghost" size="sm" disabled={!!working} onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full sm:w-auto" onClick={() => setUploadOpen(true)}>
              <Receipt className="mr-2 h-4 w-4" /> Buy electricity / upload receipt
            </Button>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          You cannot enter units or tokens yourself. Your receipt is read automatically, then an
          administrator loads the token onto the building meter and confirms the reading before your
          balance changes.
        </p>
      </section>

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
            const ocrRow = (submission.ocr_extractions as unknown as Array<{
              status: string;
              amount: number | null;
              units_kwh: number | null;
              token_last4: string | null;
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
                      {STATUS_COPY[submission.status] ?? "Under review"}
                    </p>
                  </div>
                  <StatusBadge state={submission.status} />
                </div>

                {ocrRow ? (
                  <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-3 text-xs">
                    <span>Amount read: {ocrRow.amount ?? "—"}</span>
                    <span>Units read: {ocrRow.units_kwh ?? "—"} kWh</span>
                    <span>Token: {maskedToken(ocrRow.token_last4)}</span>
                    <span>
                      Reading confidence:{" "}
                      {ocrRow.confidence !== null ? `${ocrRow.confidence}%` : "—"} ·{" "}
                      {submission.status === "credited"
                        ? "confirmed and credited"
                        : "awaiting administrator confirmation"}
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

      <h2 className="mt-8 mb-3 text-sm font-semibold">Balance history</h2>
      {ledger.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
      ) : (
        <ul className="space-y-2">
          {ledger.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium capitalize">
                  {row.transaction_type.replace(/_/g, " ")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.description ?? "—"} · {new Date(row.created_at).toLocaleString()}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className={Number(row.units_kwh) < 0 ? "text-destructive" : "text-chart-2"}>
                  {Number(row.units_kwh) > 0 ? "+" : ""}
                  {Number(row.units_kwh).toFixed(3)} kWh
                </p>
                <p className="text-xs text-muted-foreground">
                  {Number(row.balance_after_kwh).toFixed(3)} kWh
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold">My profile</h2>
      <ProfileCard
        propertyName={property?.name ?? "Property"}
        unitName={apartment?.unit_name ?? "Apartment"}
      />
    </AppShell>
  );
}

function ProfileCard({ propertyName, unitName }: { propertyName: string; unitName: string }) {
  const { profile, user, refetch } = useCurrentProfile();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone: phone || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Profile updated.");
    await refetch();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pfname">Full name</Label>
          <Input id="pfname" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pfphone">Phone</Label>
          <Input id="pfphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {profile?.email ?? user?.email} · {propertyName} · {unitName}
      </p>
      <Button className="mt-4" size="sm" disabled={saving || fullName.trim().length < 2} onClick={() => void save()}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save profile
      </Button>
    </section>
  );
}

