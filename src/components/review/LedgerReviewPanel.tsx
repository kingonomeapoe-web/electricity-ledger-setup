import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, SlidersHorizontal } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatDateTime, formatKwh, logAudit } from "@/lib/audit";

type Tx = {
  id: string;
  transaction_type: string;
  units_kwh: number;
  amount: number | null;
  balance_before_kwh: number;
  balance_after_kwh: number;
  source_type: string;
  description: string | null;
  created_at: string;
  resident_id: string;
  apartments: { unit_name: string } | null;
  profiles: { full_name: string } | null;
};

type AdjustmentType = Extract<
  Database["public"]["Enums"]["ledger_transaction_type"],
  "adjustment" | "correction" | "reversal"
>;

export function LedgerReviewPanel({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const [adjustOpen, setAdjustOpen] = useState(false);

  const txQuery = useQuery({
    queryKey: ["review-ledger", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_transactions")
        .select(
          "id, transaction_type, units_kwh, amount, balance_before_kwh, balance_after_kwh, source_type, description, created_at, resident_id, apartments(unit_name), profiles(full_name)",
        )
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as Tx[];
    },
  });

  if (txQuery.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const rows = txQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Ledger history is immutable. Corrections are posted as new audited adjustment events.
        </p>
        <Button size="sm" onClick={() => setAdjustOpen(true)}>
          <SlidersHorizontal className="mr-2 h-4 w-4" /> New adjustment
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ledger transactions yet.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Apartment</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Balance before</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{formatDateTime(t.created_at)}</TableCell>
                    <TableCell>{t.profiles?.full_name ?? "—"}</TableCell>
                    <TableCell>{t.apartments?.unit_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {t.transaction_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatKwh(t.units_kwh)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwh(t.balance_before_kwh)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKwh(t.balance_after_kwh)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.source_type.replace(/_/g, " ")}
                      {t.description ? ` · ${t.description}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.profiles?.full_name ?? "—"}</span>
                  <Badge variant="outline" className="capitalize">
                    {t.transaction_type}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(t.created_at)} · {t.apartments?.unit_name ?? "—"}
                </p>
                <p className="mt-1 text-xs">
                  {formatKwh(t.units_kwh)} · {formatKwh(t.balance_before_kwh)} →{" "}
                  {formatKwh(t.balance_after_kwh)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Post an audited adjustment</DialogTitle>
            <DialogDescription>
              Historical transactions are never edited. This creates a new, fully audited ledger
              event.
            </DialogDescription>
          </DialogHeader>
          <AdjustmentForm
            propertyId={propertyId}
            transactions={rows}
            onDone={async () => {
              setAdjustOpen(false);
              await queryClient.invalidateQueries({ queryKey: ["review-ledger"] });
              await queryClient.invalidateQueries({ queryKey: ["review-summary"] });
              await queryClient.invalidateQueries({ queryKey: ["review-audit"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdjustmentForm({
  propertyId,
  transactions,
  onDone,
}: {
  propertyId: string;
  transactions: Tx[];
  onDone: () => Promise<void>;
}) {
  const [residentId, setResidentId] = useState("");
  const [type, setType] = useState<AdjustmentType>("adjustment");
  const [units, setUnits] = useState("");
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [originalTx, setOriginalTx] = useState("");
  const [saving, setSaving] = useState(false);

  const residentsQuery = useQuery({
    queryKey: ["review-resident-options", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_accounts")
        .select("resident_id, apartment_id, apartments(unit_name), profiles(full_name)")
        .eq("property_id", propertyId)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as unknown as {
          resident_id: string;
          apartments: { unit_name: string } | null;
          profiles: { full_name: string } | null;
        };
        return {
          id: r.resident_id,
          label: `${r.profiles?.full_name ?? "Resident"} · ${r.apartments?.unit_name ?? "—"}`,
        };
      });
    },
  });

  const unitsValue = Number(units);
  const valid =
    !!residentId &&
    Number.isFinite(unitsValue) &&
    unitsValue !== 0 &&
    reason.trim().length >= 3 &&
    explanation.trim().length >= 5;

  const residentTx = transactions.filter((t) => t.resident_id === residentId);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Affected resident</Label>
        <Select value={residentId} onValueChange={setResidentId}>
          <SelectTrigger>
            <SelectValue placeholder="Select resident" />
          </SelectTrigger>
          <SelectContent>
            {(residentsQuery.data ?? []).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Event type</Label>
          <Select value={type} onValueChange={(v) => setType(v as AdjustmentType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adjustment">Adjustment</SelectItem>
              <SelectItem value="correction">Correction</SelectItem>
              <SelectItem value="reversal">Reversal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adj-units">Units (kWh, negative to debit)</Label>
          <Input
            id="adj-units"
            inputMode="decimal"
            value={units}
            onChange={(event) => setUnits(event.target.value)}
          />
        </div>
      </div>

      {residentTx.length ? (
        <div className="space-y-1.5">
          <Label>Original transaction (optional)</Label>
          <Select value={originalTx} onValueChange={setOriginalTx}>
            <SelectTrigger>
              <SelectValue placeholder="Link the transaction being corrected" />
            </SelectTrigger>
            <SelectContent>
              {residentTx.slice(0, 50).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {formatDateTime(t.created_at)} · {t.transaction_type} · {formatKwh(t.units_kwh)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="adj-reason">Reason</Label>
        <Input id="adj-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="adj-explanation">Explanation</Label>
        <Textarea
          id="adj-explanation"
          rows={4}
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>

      <Button
        disabled={!valid || saving}
        onClick={async () => {
          setSaving(true);
          try {
            const { data: newTxId, error } = await supabase.rpc("create_ledger_adjustment", {
              p_property_id: propertyId,
              p_resident_id: residentId,
              p_units_kwh: unitsValue,
              p_reason: reason.trim(),
              p_explanation: explanation.trim(),
              p_transaction_type: type,
              ...(originalTx ? { p_original_transaction_id: originalTx } : {}),
            });
            if (error) throw new Error(error.message);
            await logAudit({
              propertyId,
              eventType: "LEDGER_ADJUSTMENT_POSTED",
              entityType: "ledger_transaction",
              entityId: newTxId as unknown as string,
              oldData: originalTx ? { original_transaction_id: originalTx } : null,
              newData: {
                transaction_type: type,
                units_kwh: unitsValue,
                reason: reason.trim(),
                explanation: explanation.trim(),
                resident_id: residentId,
              },
            });
            toast.success("Adjustment posted and audited.");
            await onDone();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not post adjustment");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Post adjustment
      </Button>
    </div>
  );
}
