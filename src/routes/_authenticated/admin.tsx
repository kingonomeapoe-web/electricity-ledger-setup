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
import { PaymentsPanel } from "@/components/admin/PaymentsPanel";
import { CentralMeterPanel } from "@/components/admin/CentralMeterPanel";
import { SubmeterPanel } from "@/components/admin/SubmeterPanel";
import { useCurrentProfile } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Evidence & readings — Electricity Ledger" },
      {
        name: "description",
        content:
          "Review payment receipts, record central prepaid meter token loads and confirm submeter readings.",
      },
      { property: "og:title", content: "Evidence & readings — Electricity Ledger" },
      {
        property: "og:description",
        content: "Administrator workspace for receipts, token loads and meter readings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, loading, adminMemberships } = useCurrentProfile();
  const [propertyId, setPropertyId] = useState<string>("");

  if (loading) {
    return (
      <AppShell title="Evidence & readings">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AppShell>
    );
  }

  if (adminMemberships.length === 0) {
    return (
      <AppShell title="Evidence & readings">
        <p className="text-sm text-muted-foreground">You do not administer any property yet.</p>
      </AppShell>
    );
  }

  const active = propertyId || adminMemberships[0]!.property_id;

  return (
    <AppShell
      title="Evidence & readings"
      subtitle="OCR is assistive only — every value needs your confirmation."
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

      <Tabs defaultValue="payments">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="payments">Receipts</TabsTrigger>
          <TabsTrigger value="central">Central meter</TabsTrigger>
          <TabsTrigger value="submeters">Submeters</TabsTrigger>
        </TabsList>
        <TabsContent value="payments" className="pt-5">
          <PaymentsPanel propertyId={active} userId={user!.id} />
        </TabsContent>
        <TabsContent value="central" className="pt-5">
          <CentralMeterPanel propertyId={active} userId={user!.id} />
        </TabsContent>
        <TabsContent value="submeters" className="pt-5">
          <SubmeterPanel propertyId={active} userId={user!.id} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
