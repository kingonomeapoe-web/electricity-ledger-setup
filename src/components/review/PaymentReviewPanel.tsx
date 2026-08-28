import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Eye, Fuel, Loader2, ScanLine, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { EvidenceUploader } from "@/components/EvidenceUploader";
import { EvidencePreview } from "@/components/review/EvidencePreview";
import { ReadingCapture } from "@/components/admin/ReadingCapture";
import { supabase } from "@/integrations/supabase/client";
import { runEvidenceOcr } from "@/lib/ocr.functions";
import { revealPaymentToken } from "@/lib/review.functions";
import { formatDateTime, logAudit, maskToken } from "@/lib/audit";
import { groupToken } from "@/lib/token";

type Extraction = {
  id: string;
  status: string;
  amount: number | null;
  amount_paid: number | null;
  units_kwh: number | null;
  meter_number: string | null;
  beneficiary_id: string | null;
  token_last4: string | null;
  token_ciphertext: string | null;
  transaction_reference: string | null;
  transaction_number: string | null;
  customer_name: string | null;
  service_address: string | null;
  transaction_date: string | null;
  transaction_time: string | null;
  tariff_class: string | null;
  tariff_rate: number | null;
  provider: string | null;
  confidence: number | null;
  session_id: string | null;
  error_message: string | null;
  field_confidence: Record<string, number> | null;
  structured_data: Record<string, unknown> | null;
};


type ValidationCheck = { key: string; label: string; level: "pass" | "warn" | "fail"; detail: string };

function validationOf(e: Extraction | undefined): ValidationCheck[] {
  const raw = e?.structured_data?.["validation"];
  return Array.isArray(raw) ? (raw as ValidationCheck[]) : [];
}

type Submission = {
  id: string;
  status: string;
  submitted_at: string;
  rejection_reason: string | null;
  resident_id: string;
  apartment_id: string;
  evidence_id: string;
  apartments: { unit_name: string } | null;
  profiles: { full_name: string } | null;
  evidence_files: {
    storage_path: string;
    original_filename: string | null;
    mime_type: string | null;
    sha256_hash: string | null;
    captured_at: string | null;
  } | null;
  ocr_extractions: Extraction[];
};

const SELECT =
  "id, status, submitted_at, rejection_reason, resident_id, apartment_id, evidence_id, apartments(unit_name), profiles(full_name), evidence_files(storage_path, original_filename, mime_type, sha256_hash, captured_at), ocr_extractions(id, status, amount, amount_paid, units_kwh, meter_number, beneficiary_id, token_last4, token_ciphertext, transaction_reference, transaction_number, customer_name, service_address, transaction_date, transaction_time, tariff_class, tariff_rate, provider, confidence, session_id, error_message, field_confidence, structured_data)";


function useDuplicates(submissions: Submission[]) {
  return useMemo(() => {
    const refCount = new Map<string, number>();
    const tokenCount = new Map<string, number>();
    const hashCount = new Map<string, number>();

    for (const s of submissions) {
      const e = s.ocr_extractions?.[0];
      const ref = e?.transaction_reference ?? e?.transaction_number;
      if (ref) refCount.set(ref, (refCount.get(ref) ?? 0) + 1);
      const fp = (e?.structured_data?.["token_fingerprint"] as string | undefined) ?? e?.token_last4;
      if (fp) tokenCount.set(fp, (tokenCount.get(fp) ?? 0) + 1);
      const hash = s.evidence_files?.sha256_hash;
      if (hash) hashCount.set(hash, (hashCount.get(hash) ?? 0) + 1);
    }

    return (s: Submission) => {
      const e = s.ocr_extractions?.[0];
      const ref = e?.transaction_reference ?? e?.transaction_number;
      const flags: string[] = [];
      if (ref && (refCount.get(ref) ?? 0) > 1) flags.push("Duplicate reference");
      const fp = (e?.structured_data?.["token_fingerprint"] as string | undefined) ?? e?.token_last4;
      if (fp && (tokenCount.get(fp) ?? 0) > 1) flags.push("Duplicate token");
      const hash = s.evidence_files?.sha256_hash;
      if (hash && (hashCount.get(hash) ?? 0) > 1) flags.push("Duplicate evidence hash");
      return flags;
    };
  }, [submissions]);
}

export function PaymentReviewPanel({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const ocr = useServerFn(runEvidenceOcr);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creditFor, setCreditFor] = useState<Submission | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const submissionsQuery = useQuery({
    queryKey: ["review-payments", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_submissions")
        .select(SELECT)
        .eq("property_id", propertyId)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Submission[];
    },
  });

  const submissions = submissionsQuery.data ?? [];
  const duplicateFlags = useDuplicates(submissions);
  const open = submissions.find((s) => s.id === openId) ?? null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["review-payments"] });
    await queryClient.invalidateQueries({ queryKey: ["review-summary"] });
    await queryClient.invalidateQueries({ queryKey: ["review-audit"] });
  }

  async function runOcr(submission: Submission) {
    setBusy(submission.id);
    try {
      await ocr({
        data: {
          evidenceId: submission.evidence_id,
          kind: "payment_receipt",
          paymentSubmissionId: submission.id,
        },
      });
      await logAudit({
        propertyId,
        eventType: "OCR_COMPLETED",
        entityType: "payment_submission",
        entityId: submission.id,
        oldData: { status: submission.status },
        newData: { status: "ocr_processed" },
      });
      toast.success("OCR complete — review the extracted values.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OCR failed");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(
    submission: Submission,
    status: string,
    eventType: string,
    extra?: Record<string, unknown>,
  ) {
    const { error } = await supabase
      .from("payment_submissions")
      .update({
        status: status as never,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        ...(extra ?? {}),
      })
      .eq("id", submission.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      propertyId,
      eventType,
      entityType: "payment_submission",
      entityId: submission.id,
      oldData: { status: submission.status },
      newData: { status, ...(extra ?? {}) },
    });
    await refresh();
  }

  if (submissionsQuery.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">No payment receipts submitted yet.</p>;
  }

  const pendingCount = submissions.filter((s) =>
    ["uploaded", "ocr_processed", "pending_approval"].includes(s.status),
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Pending payments</h3>
        <Badge variant={pendingCount ? "default" : "outline"}>{pendingCount}</Badge>
        <span className="text-xs text-muted-foreground">awaiting administrative review</span>
      </div>
      {/* Desktop data table */}

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Resident</TableHead>
              <TableHead>Apartment</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead>Meter no.</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Receipt date</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">OCR</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((s) => {
              const e = s.ocr_extractions?.[0];
              const flags = duplicateFlags(s);
              return (
                <TableRow key={s.id} className={flags.length ? "bg-destructive/5" : undefined}>
                  <TableCell className="font-medium">{s.profiles?.full_name ?? "Resident"}</TableCell>
                  <TableCell>{s.apartments?.unit_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e?.amount ?? e?.amount_paid ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e?.units_kwh ?? "—"}</TableCell>
                  <TableCell>{e?.meter_number ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {maskToken(e?.token_last4)}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs">
                    {e?.transaction_reference ?? e?.transaction_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{e?.transaction_date ?? "—"}</TableCell>
                  <TableCell className="text-xs">{formatDateTime(s.submitted_at)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {e?.confidence !== null && e?.confidence !== undefined ? `${e.confidence}%` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge state={s.status} />
                      {flags.map((f) => (
                        <Badge key={f} variant="outline" className="border-destructive/40 text-destructive">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(s.id)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-3 md:hidden">
        {submissions.map((s) => {
          const e = s.ocr_extractions?.[0];
          const flags = duplicateFlags(s);
          return (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {s.profiles?.full_name ?? "Resident"} · {s.apartments?.unit_name ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(s.submitted_at)}</p>
                </div>
                <StatusBadge state={s.status} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span>Amount: {e?.amount ?? "—"}</span>
                <span>Units: {e?.units_kwh ?? "—"}</span>
                <span>Meter: {e?.meter_number ?? "—"}</span>
                <span>OCR: {e?.confidence !== null && e?.confidence !== undefined ? `${e.confidence}%` : "—"}</span>
                <span className="col-span-2">Token: {maskToken(e?.token_last4)}</span>
              </div>
              {flags.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {flags.map((f) => (
                    <Badge key={f} variant="outline" className="border-destructive/40 text-destructive">
                      {f}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Button size="sm" className="mt-3 w-full" onClick={() => setOpenId(s.id)}>
                Review
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {open ? (
            <SubmissionDetail
              submission={open}
              propertyId={propertyId}
              flags={duplicateFlags(open)}
              busy={busy === open.id}
              onRunOcr={() => void runOcr(open)}
              onApprove={() =>
                void setStatus(open, "approved_for_loading", "PAYMENT_APPROVED_FOR_LOADING")
              }
              onReject={async () => {
                const reason = window.prompt("Reason for rejecting this receipt?");
                if (!reason) return;
                await setStatus(open, "rejected", "PAYMENT_REJECTED", {
                  rejection_reason: reason,
                });
                setOpenId(null);
              }}
              onMarkDuplicate={async () => {
                await setStatus(open, "duplicate", "PAYMENT_MARKED_DUPLICATE");
                setOpenId(null);
              }}
              onCredit={() => {
                setCreditFor(open);
                setOpenId(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!creditFor} onOpenChange={(o) => !o && setCreditFor(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Load token and credit resident</DialogTitle>
            <DialogDescription>
              Load the token onto the central prepaid meter, evidence it, then confirm the units and
              meter balances. The credit is created only by the ledger's confirmation routine.
            </DialogDescription>
          </DialogHeader>
          {creditFor ? (
            <CreditFlow
              propertyId={propertyId}
              userId={userId}
              submission={creditFor}
              onDone={async () => {
                setCreditFor(null);
                await refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  confidence,
}: {
  label: string;
  value: React.ReactNode;
  confidence?: number | null | undefined;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-right font-medium">
        <span>{value ?? "—"}</span>
        {confidence !== null && confidence !== undefined ? (
          <span
            className={
              confidence >= 80
                ? "text-xs tabular-nums text-muted-foreground"
                : "text-xs tabular-nums text-chart-5"
            }
          >
            {confidence}%
          </span>
        ) : null}
      </span>
    </div>
  );
}


function SubmissionDetail({
  submission,
  propertyId,
  flags,
  busy,
  onRunOcr,
  onApprove,
  onReject,
  onMarkDuplicate,
  onCredit,
}: {
  submission: Submission;
  propertyId: string;
  flags: string[];
  busy: boolean;
  onRunOcr: () => void;
  onApprove: () => void;
  onReject: () => void;
  onMarkDuplicate: () => void;
  onCredit: () => void;
}) {
  const e = submission.ocr_extractions?.[0];
  const reveal = useServerFn(revealPaymentToken);
  const [token, setToken] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const terminal = submission.status === "credited" || submission.status === "rejected";

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {submission.profiles?.full_name ?? "Resident"} · {submission.apartments?.unit_name ?? "—"}
        </DialogTitle>
        <DialogDescription>
          Uploaded {formatDateTime(submission.submitted_at)} · OCR is advisory only and must be
          confirmed by you.
        </DialogDescription>
      </DialogHeader>

      {flags.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
          <span>Possible duplicate: {flags.join(", ")}.</span>
        </div>
      ) : null}

      {validationOf(e).length ? (
        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 text-sm font-semibold">Automatic validation</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {validationOf(e).map((check) => (
              <li key={check.key} className="flex items-start gap-2 text-xs">
                <span
                  className={
                    check.level === "pass"
                      ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-chart-2"
                      : check.level === "warn"
                        ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-chart-5"
                        : "mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive"
                  }
                />
                <span>
                  <span className="font-medium text-foreground">{check.label}: </span>
                  <span className="text-muted-foreground">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <EvidencePreview
          storagePath={submission.evidence_files?.storage_path}
          mimeType={submission.evidence_files?.mime_type}
          filename={submission.evidence_files?.original_filename}
        />

        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Structured OCR extraction</p>
            <StatusBadge state={e?.status ?? submission.status} />
          </div>
          {e ? (
            <div>
              <Field label="Amount" value={e.amount ?? e.amount_paid} />
              <Field label="Units" value={e.units_kwh} />
              <Field label="Meter number" value={e.meter_number} />
              <Field
                label="Token"
                value={
                  <span className="flex items-center justify-end gap-2">
                    <span className="font-mono text-xs">{token ?? maskToken(e.token_last4)}</span>
                    {token ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => {
                          void navigator.clipboard.writeText(token);
                          toast.success("Token copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={revealing}
                        onClick={async () => {
                          setRevealing(true);
                          try {
                            const result = await reveal({ data: { extractionId: e.id } });
                            const value = (result as { token: string | null }).token;
                            if (!value) {
                              toast.info("No full token was stored for this receipt.");
                            } else {
                              setToken(value);
                            }
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Reveal failed");
                          } finally {
                            setRevealing(false);
                          }
                        }}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                }
              />
              <Field label="Transaction reference" value={e.transaction_reference} />
              <Field label="Session ID" value={e.session_id} />
              <Field label="Transaction number" value={e.transaction_number} />
              <Field label="Customer name" value={e.customer_name} />
              <Field label="Service address" value={e.service_address} />
              <Field label="Receipt date" value={e.transaction_date} />
              <Field label="Receipt time" value={formatDateTime(e.transaction_time)} />
              <Field label="Provider / beneficiary" value={e.beneficiary_id ?? e.provider} />
              <Field label="Tariff" value={e.tariff_class ?? e.tariff_rate} />
              <Field
                label="OCR confidence"
                value={e.confidence !== null ? `${e.confidence}%` : "—"}
              />
              <Field label="Evidence hash" value={
                <span className="font-mono text-[10px] break-all">
                  {submission.evidence_files?.sha256_hash ?? "—"}
                </span>
              } />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">No OCR extraction yet.</p>
              <Button size="sm" disabled={busy} onClick={onRunOcr}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="mr-2 h-4 w-4" />
                )}
                Run OCR
              </Button>
            </div>
          )}
        </div>
      </div>

      {submission.rejection_reason ? (
        <p className="text-sm text-destructive">Rejected: {submission.rejection_reason}</p>
      ) : null}

      {!terminal ? (
        <div className="flex flex-wrap gap-2">
          {e && submission.status !== "approved_for_loading" && submission.status !== "loaded" ? (
            <Button size="sm" variant="secondary" onClick={onApprove}>
              Approve for loading
            </Button>
          ) : null}
          {submission.status === "approved_for_loading" || submission.status === "loaded" ? (
            <Button size="sm" onClick={onCredit}>
              <Fuel className="mr-2 h-4 w-4" /> Load token &amp; credit
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onMarkDuplicate}>
            Mark duplicate
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onReject}>
            Reject
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This submission is closed. Corrections must be posted as a new audited adjustment.
        </p>
      )}
      <input type="hidden" value={propertyId} readOnly />
    </div>
  );
}

function CreditFlow({
  propertyId,
  userId,
  submission,
  onDone,
}: {
  propertyId: string;
  userId: string;
  submission: Submission;
  onDone: () => Promise<void>;
}) {
  const extraction = submission.ocr_extractions?.[0];
  const [loadEvidenceId, setLoadEvidenceId] = useState<string | null>(null);
  const [unitsLoaded, setUnitsLoaded] = useState<string>(
    extraction?.units_kwh !== null && extraction?.units_kwh !== undefined
      ? String(extraction.units_kwh)
      : "",
  );
  const [balanceBefore, setBalanceBefore] = useState("");
  const [notes, setNotes] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const reveal = useServerFn(revealPaymentToken);

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

  const units = Number(unitsLoaded);
  const before = Number(balanceBefore);
  const expected = Math.round((before + units) * 1000) / 1000;
  const ready =
    !!loadEvidenceId &&
    Number.isFinite(units) &&
    units > 0 &&
    Number.isFinite(before) &&
    before >= 0;

  if (!meterQuery.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Add an active main prepaid meter in Property setup before crediting residents.
      </p>
    );
  }
  const meterId = meterQuery.data.id;

  return (
    <div className="space-y-4">
      <EvidencePreview
        storagePath={submission.evidence_files?.storage_path}
        mimeType={submission.evidence_files?.mime_type}
        filename={submission.evidence_files?.original_filename}
        className="max-h-56 overflow-hidden"
      />

      <div className="rounded-xl border border-border p-3 text-sm">
        <p className="font-semibold">Token to load</p>
        <p className="mt-1 flex items-center gap-2 font-mono text-xs">
          {token ? groupToken(token) : maskToken(extraction?.token_last4)}
          {token ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => {
                void navigator.clipboard.writeText(token);
                toast.success("Token copied");
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          ) : extraction ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={revealing}
              onClick={async () => {
                setRevealing(true);
                try {
                  const result = await reveal({ data: { extractionId: extraction.id } });
                  const value = (result as { token: string | null }).token;
                  if (!value) toast.info("No full token was stored for this receipt.");
                  else setToken(value);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Reveal failed");
                } finally {
                  setRevealing(false);
                }
              }}
            >
              <Eye className="h-3 w-3" />
            </Button>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Load this token onto the central prepaid meter now, then evidence it below.
        </p>
      </div>

      <EvidenceUploader
        propertyId={propertyId}
        evidenceType="central_meter_load"
        label="Central meter load evidence"
        hint="Photo or screenshot of the token being loaded onto the central prepaid meter."
        onUploaded={(evidence) => setLoadEvidenceId(evidence.id)}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="units">Actual units loaded (kWh)</Label>
          <Input
            id="units"
            inputMode="decimal"
            value={unitsLoaded}
            onChange={(event) => setUnitsLoaded(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="before">Central meter balance before (kWh)</Label>
          <Input
            id="before"
            inputMode="decimal"
            value={balanceBefore}
            onChange={(event) => setBalanceBefore(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {ready ? (
        <>
          <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-xs">
            <span>Balance before loading: {before.toFixed(3)} kWh</span>
            <span>Units being loaded: {units.toFixed(3)} kWh</span>
            <span className="font-medium text-foreground">
              Expected balance after loading: {expected.toFixed(3)} kWh
            </span>
            <span>
              The photographed post-load reading must match this figure within 0.5 kWh, otherwise the
              variance must be explained before the resident is credited.
            </span>
          </div>
          <ReadingCapture
            propertyId={propertyId}
            evidenceType="central_meter_reading"
            label="Central meter display after loading"
            hint="Photograph the meter so the post-load balance is evidenced."
            confirmLabel="Confirm reading and credit resident"
            extra={(value) =>
              value === null ? null : (
                <div
                  className={
                    Math.abs(value - expected) <= 0.5
                      ? "rounded-lg border border-chart-2/40 bg-chart-2/10 p-3 text-xs"
                      : "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs"
                  }
                >
                  Expected {expected.toFixed(3)} kWh · detected {value.toFixed(3)} kWh · difference{" "}
                  {(value - expected).toFixed(3)} kWh —{" "}
                  {Math.abs(value - expected) <= 0.5
                    ? "reconciles"
                    : "does not reconcile; explain it in the notes above before confirming"}
                </div>
              )
            }
            onConfirm={async (reading) => {
              const drift = Math.abs(reading.readingKwh - expected);
              if (drift > 0.5 && !notes.trim()) {
                throw new Error(
                  `Post-load reading ${reading.readingKwh} kWh differs from the expected ${expected} kWh by ${drift.toFixed(3)} kWh. Add an explanation in the notes, or re-photograph the meter.`,
                );
              }
              const now = new Date().toISOString();
              const { data: inserted, error } = await supabase
                .from("central_meter_readings")
                .insert({
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
                  notes: notes || null,
                })
                .select("id")
                .single();
              if (error) throw new Error(error.message);

              const { data: txId, error: rpcError } = await supabase.rpc(
                "confirm_central_meter_credit",
                {
                  p_payment_submission_id: submission.id,
                  p_units_loaded_kwh: units,
                  p_central_balance_before_kwh: before,
                  p_central_balance_after_kwh: reading.readingKwh,
                  p_reading_evidence_id: reading.evidenceId,
                  p_load_evidence_id: loadEvidenceId!,
                  ...(notes ? { p_notes: notes } : {}),
                },
              );
              if (rpcError) throw new Error(rpcError.message);

              await logAudit({
                propertyId,
                eventType: "CENTRAL_LOAD_CONFIRMED",
                entityType: "payment_submission",
                entityId: submission.id,
                oldData: { status: submission.status },
                newData: { status: "credited", units_loaded_kwh: units },
                metadata: {
                  ledger_transaction_id: txId,
                  central_meter_reading_id: inserted.id,
                  balance_before_kwh: before,
                  balance_after_kwh: reading.readingKwh,
                },
              });

              toast.success("Resident credited from the confirmed central meter load.");
              await onDone();
            }}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Upload the load evidence and enter the units loaded plus the balance before loading to
          continue.
        </p>
      )}
    </div>
  );
}
