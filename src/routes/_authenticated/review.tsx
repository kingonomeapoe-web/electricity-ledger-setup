import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SummaryPanel } from "@/components/review/SummaryPanel";
import { PaymentReviewPanel } from "@/components/review/PaymentReviewPanel";
import { CentralMeterReviewPanel } from "@/components/review/CentralMeterReviewPanel";
import { SubmeterReviewPanel } from "@/components/review/SubmeterReviewPanel";
import { ReconciliationPanel } from "@/components/review/ReconciliationPanel";
import { LedgerReviewPanel } from "@/components/review/LedgerReviewPanel";
import { AuditLogPanel } from "@/components/review/AuditLogPanel";
import { useCurrentProfile } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "Review & reconciliation — Electricity Ledger" },
      {
        name: "description",
        content:
          "Administrator centre for payment review, central meter loads, submeter confirmations, reconciliation variances, ledger adjustments and audit history.",
      },
      { property: "og:title", content: "Review & reconciliation — Electricity Ledger" },
      {
        property: "og:description",
        content:
          "Review receipts and OCR, confirm meter readings, classify variances and inspect the immutable audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { user, loading, adminMemberships } = useCurrentProfile();
  const [propertyId, setPropertyId] = useState<string>("");

  if (loading) {
    return (
      <AppShell title="Review & reconciliation" wide>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AppShell>
    );
  }

  if (adminMemberships.length === 0) {
    return (
      <AppShell title="Review & reconciliation" wide>
        <p className="text-sm text-muted-foreground">
          This area is restricted to property administrators.
        </p>
      </AppShell>
    );
  }

  const active = propertyId || adminMemberships[0]!.property_id;

  return (
    <AppShell
      title="Review & reconciliation"
      subtitle="Pending actions first, then exceptions, reconciliation and the audit trail. OCR is never authoritative without your confirmation."
      wide
    >
      {adminMemberships.length > 1 ? (
        <div className="mb-5 max-w-xs">
          <Select value={active} onValueChange={setPropertyId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {adminMemberships.map((membership) => (
                <SelectItem key={membership.property_id} value={membership.property_id}>
                  {membership.property_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mb-6">
        <SummaryPanel propertyId={active} />
      </div>

      <Tabs defaultValue="payments">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="central">Central meter</TabsTrigger>
          <TabsTrigger value="submeters">Submeters</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="pt-5">
          <PaymentReviewPanel propertyId={active} userId={user!.id} />
        </TabsContent>
        <TabsContent value="central" className="pt-5">
          <CentralMeterReviewPanel propertyId={active} userId={user!.id} />
        </TabsContent>
        <TabsContent value="submeters" className="pt-5">
          <SubmeterReviewPanel propertyId={active} userId={user!.id} />
        </TabsContent>
        <TabsContent value="reconciliation" className="pt-5">
          <ReconciliationPanel propertyId={active} />
        </TabsContent>
        <TabsContent value="ledger" className="pt-5">
          <LedgerReviewPanel propertyId={active} />
        </TabsContent>
        <TabsContent value="audit" className="pt-5">
          <AuditLogPanel propertyId={active} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
