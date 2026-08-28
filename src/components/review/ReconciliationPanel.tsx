import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatDateTime, formatKwh, logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";

type Classification = Database["public"]["Enums"]["reconciliation_classification"];

const CLASSIFICATIONS: Array<{ value: Classification; label: string }> = [
  { value: "common_area", label: "Common area" },
  { value: "meter_loss", label: "Meter loss" },
  { value: "timing_difference", label: "Timing difference" },
  { value: "meter_issue", label: "Meter issue" },
  { value: "data_entry_error", label: "Data entry error" },
  { value: "unmetered_load", label: "Unmetered load" },
  { value: "suspected_tampering", label: "Suspected tampering" },
  { value: "other", label: "Other" },
];

type Item = {
  id: string;
  apartment_id: string;
  opening_reading_kwh: number;
  closing_reading_kwh: number;
  consumption_kwh: number;
  apartments: { unit_name: string } | null;
  submeters: { identifier: string } | null;
};

type Reconciliation = {
  id: string;
  period_start: string;
  period_end: string;
  central_balance_start_kwh: number;
  central_balance_end_kwh: number;
  central_consumption_kwh: number;
  submeter_consumption_kwh: number;
  total_credits_kwh: number;
  variance_kwh: number;
  tolerance_kwh: number;
  status: string;
  classification: Classification | null;
  explanation: string | null;
  reviewed_at: string | null;
  reconciliation_items: Item[];
};

const STATUS_STYLE: Record<string, string> = {
  balanced: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  pending: "bg-muted text-muted-foreground",
  variance: "bg-destructive/15 text-destructive border-destructive/40",
  reviewed: "bg-chart-5/20 text-chart-5 border-chart-5/40",
  closed: "bg-secondary text-secondary-foreground",
};

export function ReconciliationPanel({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const [classifyFor, setClassifyFor] = useState<Reconciliation | null>(null);

  const query = useQuery({
    queryKey: ["review-reconciliations", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reconciliations")
        .select(
          "id, period_start, period_end, central_balance_start_kwh, central_balance_end_kwh, central_consumption_kwh, submeter_consumption_kwh, total_credits_kwh, variance_kwh, tolerance_kwh, status, classification, explanation, reviewed_at, reconciliation_items(id, apartment_id, opening_reading_kwh, closing_reading_kwh, consumption_kwh, apartments(unit_name), submeters(identifier))",
        )
        .eq("property_id", propertyId)
        .order("period_end", { ascending: false });
      if (error) throw error;
      return data as unknown as Reconciliation[];
    },
  });

  if (query.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reconciliation periods recorded for this property yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {formatDateTime(r.period_start)} → {formatDateTime(r.period_end)}
              </p>
              {r.classification ? (
                <p className="text-xs text-muted-foreground">
                  Classified as {r.classification.replace(/_/g, " ")}
                  {r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ""}
                </p>
              ) : null}
            </div>
            <Badge
              variant="outline"
              className={cn("uppercase tracking-wide", STATUS_STYLE[r.status] ?? "")}
            >
              {r.status}
            </Badge>
          </div>

          <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <span>Opening balance: {formatKwh(r.central_balance_start_kwh)}</span>
            <span>Ending balance: {formatKwh(r.central_balance_end_kwh)}</span>
            <span>Credits loaded: {formatKwh(r.total_credits_kwh)}</span>
            <span>Central consumption: {formatKwh(r.central_consumption_kwh)}</span>
            <span>Submeter consumption: {formatKwh(r.submeter_consumption_kwh)}</span>
            <span
              className={cn(
                Math.abs(r.variance_kwh) > r.tolerance_kwh ? "font-semibold text-destructive" : "",
              )}
            >
              Variance: {formatKwh(r.variance_kwh)} (tolerance {formatKwh(r.tolerance_kwh)})
            </span>
          </div>

          {r.explanation ? (
            <p className="mt-2 text-xs text-muted-foreground">Explanation: {r.explanation}</p>
          ) : null}

          {r.reconciliation_items?.length ? (
            <div className="mt-3 space-y-1 text-xs">
              <p className="font-medium">Per-apartment items</p>
              {r.reconciliation_items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap justify-between gap-2 rounded-md border border-border/60 px-2 py-1"
                >
                  <span>
                    {item.apartments?.unit_name ?? "Apartment"} · submeter{" "}
                    {item.submeters?.identifier ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {formatKwh(item.opening_reading_kwh)} → {formatKwh(item.closing_reading_kwh)} ={" "}
                    {formatKwh(item.consumption_kwh)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {r.status !== "closed" ? (
            <Button size="sm" className="mt-3" variant="secondary" onClick={() => setClassifyFor(r)}>
              Classify variance
            </Button>
          ) : null}
        </div>
      ))}

      <Dialog open={!!classifyFor} onOpenChange={(o) => !o && setClassifyFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Classify variance</DialogTitle>
            <DialogDescription>
              An explanation is required. The classification is written to the audit trail and cannot
              overwrite ledger history.
            </DialogDescription>
          </DialogHeader>
          {classifyFor ? (
            <ClassifyForm
              reconciliation={classifyFor}
              propertyId={propertyId}
              onDone={async () => {
                setClassifyFor(null);
                await queryClient.invalidateQueries({ queryKey: ["review-reconciliations"] });
                await queryClient.invalidateQueries({ queryKey: ["review-summary"] });
                await queryClient.invalidateQueries({ queryKey: ["review-audit"] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClassifyForm({
  reconciliation,
  propertyId,
  onDone,
}: {
  reconciliation: Reconciliation;
  propertyId: string;
  onDone: () => Promise<void>;
}) {
  const [classification, setClassification] = useState<Classification>(
    reconciliation.classification ?? "common_area",
  );
  const [explanation, setExplanation] = useState(reconciliation.explanation ?? "");
  const [status, setStatus] = useState<Database["public"]["Enums"]["reconciliation_status"]>(
    "reviewed",
  );
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Classification</Label>
        <Select value={classification} onValueChange={(v) => setClassification(v as Classification)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Outcome</Label>
        <Select
          value={status}
          onValueChange={(v) =>
            setStatus(v as Database["public"]["Enums"]["reconciliation_status"])
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="explanation">Explanation (required)</Label>
        <Textarea
          id="explanation"
          rows={4}
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>

      <Button
        disabled={saving || explanation.trim().length < 5}
        onClick={async () => {
          setSaving(true);
          try {
            const { error } = await supabase.rpc("classify_reconciliation_variance", {
              p_reconciliation_id: reconciliation.id,
              p_classification: classification,
              p_explanation: explanation.trim(),
              p_status: status,
            });
            if (error) throw new Error(error.message);
            await logAudit({
              propertyId,
              eventType: "RECONCILIATION_CLASSIFIED",
              entityType: "reconciliation",
              entityId: reconciliation.id,
              oldData: {
                classification: reconciliation.classification,
                status: reconciliation.status,
                explanation: reconciliation.explanation,
              },
              newData: { classification, status, explanation: explanation.trim() },
            });
            toast.success("Variance classified.");
            await onDone();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not classify variance");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save classification
      </Button>
    </div>
  );
}
