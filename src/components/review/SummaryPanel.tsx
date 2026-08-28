import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ClipboardCheck,
  Fuel,
  Gauge,
  Loader2,
  Receipt,
  ScanLine,
  Scale,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

export type SummaryCounts = {
  pendingPayments: number;
  awaitingOcr: number;
  awaitingApproval: number;
  loadsAwaitingConfirmation: number;
  centralReadingsAwaiting: number;
  submeterReadingsAwaiting: number;
  reconciliationExceptions: number;
  openAdjustments: number;
};

export function useReviewSummary(propertyId: string) {
  return useQuery({
    queryKey: ["review-summary", propertyId],
    enabled: !!propertyId,
    queryFn: async (): Promise<SummaryCounts> => {
      const pendingStatuses: Database["public"]["Enums"]["payment_status"][] = [
        "uploaded",
        "ocr_processed",
        "pending_approval",
        "approved_for_loading",
        "loaded",
        "correction_required",
        "disputed",
      ];

      const [
        pending,
        awaitingOcr,
        awaitingApproval,
        loads,
        centralReadings,
        submeterReadings,
        exceptions,
        adjustments,
      ] = await Promise.all([
        supabase
          .from("payment_submissions")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .in("status", pendingStatuses),
        supabase
          .from("payment_submissions")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .eq("status", "uploaded"),
        supabase
          .from("payment_submissions")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .in("status", ["ocr_processed", "pending_approval"]),
        supabase
          .from("central_meter_loads")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .is("confirmed_at", null),
        supabase
          .from("central_meter_readings")
          .select("id, meters!inner(property_id)", { count: "exact", head: true })
          .eq("meters.property_id", propertyId)
          .is("confirmed_at", null),
        supabase
          .from("submeter_readings")
          .select("id, submeters!inner(apartments!inner(property_id))", {
            count: "exact",
            head: true,
          })
          .eq("submeters.apartments.property_id", propertyId)
          .is("confirmed_at", null),
        supabase
          .from("reconciliations")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .in("status", ["variance", "pending"]),
        supabase
          .from("ledger_transactions")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .in("transaction_type", ["adjustment", "correction", "reversal"]),
      ]);

      return {
        pendingPayments: pending.count ?? 0,
        awaitingOcr: awaitingOcr.count ?? 0,
        awaitingApproval: awaitingApproval.count ?? 0,
        loadsAwaitingConfirmation: loads.count ?? 0,
        centralReadingsAwaiting: centralReadings.count ?? 0,
        submeterReadingsAwaiting: submeterReadings.count ?? 0,
        reconciliationExceptions: exceptions.count ?? 0,
        openAdjustments: adjustments.count ?? 0,
      };
    },
  });
}

export function SummaryPanel({ propertyId }: { propertyId: string }) {
  const summary = useReviewSummary(propertyId);

  if (summary.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (summary.error) {
    return <p className="text-sm text-destructive">{(summary.error as Error).message}</p>;
  }

  const s = summary.data!;
  const tiles: Array<{ label: string; value: number; icon: LucideIcon; tone?: "warn" | "alert" }> = [
    { label: "Pending payments", value: s.pendingPayments, icon: Receipt },
    { label: "Awaiting OCR", value: s.awaitingOcr, icon: ScanLine },
    { label: "Awaiting approval", value: s.awaitingApproval, icon: ClipboardCheck, tone: "warn" },
    { label: "Loads awaiting confirmation", value: s.loadsAwaitingConfirmation, icon: Fuel, tone: "warn" },
    { label: "Central readings to confirm", value: s.centralReadingsAwaiting, icon: Gauge },
    { label: "Submeter readings to confirm", value: s.submeterReadingsAwaiting, icon: Gauge },
    {
      label: "Reconciliation exceptions",
      value: s.reconciliationExceptions,
      icon: Scale,
      tone: "alert",
    },
    { label: "Adjustments posted", value: s.openAdjustments, icon: SlidersHorizontal },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        const active = tile.value > 0;
        return (
          <div
            key={tile.label}
            className={cn(
              "rounded-xl border border-border bg-card p-4",
              active && tile.tone === "alert" && "border-destructive/40 bg-destructive/5",
              active && tile.tone === "warn" && "border-chart-5/40 bg-chart-5/5",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{tile.value}</p>
          </div>
        );
      })}
      {s.reconciliationExceptions > 0 ? (
        <div className="sm:col-span-2 lg:col-span-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <span>
            {s.reconciliationExceptions} reconciliation period(s) need a variance classification and
            explanation.
          </span>
        </div>
      ) : null}
    </div>
  );
}
