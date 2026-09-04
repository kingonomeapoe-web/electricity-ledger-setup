import { useEffect, useState } from "react";
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
import { CentralMeterPanel } from "@/components/admin/CentralMeterPanel";
import { SubmeterPanel } from "@/components/admin/SubmeterPanel";
import { PropertyOverview } from "@/components/admin/PropertyOverview";
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
  const { user, loading, profileError, adminMemberships, refetch } = useCurrentProfile();
  const [propertyId, setPropertyId] = useState<string>("");

  // Memberships can change after a property is created or access is updated.
  // Never keep querying a property that is no longer in the user's admin scope.
  useEffect(() => {
    if (
      propertyId &&
      !adminMemberships.some((membership) => membership.property_id === propertyId)
    ) {
      setPropertyId("");
    }
  }, [adminMemberships, propertyId]);

  if (loading) {
    return (
      <AppShell title="Evidence & readings">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AppShell>
    );
  }

  if (profileError) {
    return (
      <AppShell title="Evidence & readings">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Unable to load your property access.</p>
          <p className="mt-1 text-muted-foreground">
            Check your connection and try again. If this continues, ask a system administrator to
            confirm your property membership.
          </p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => void refetch()}
          >
            Try again
          </button>
        </div>
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

  const active = propertyId || adminMemberships[0]?.property_id;
  if (!active || !user) {
    return (
      <AppShell title="Evidence & readings">
        <p className="text-sm text-muted-foreground">
          Your session is no longer available. Please sign in again.
        </p>
      </AppShell>
    );
  }

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

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="central">Central meter</TabsTrigger>
          <TabsTrigger value="submeters">Submeters</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-5">
          <PropertyOverview propertyId={active} />
          <p className="mt-4 text-xs text-muted-foreground">
            Payment receipts, token loading and resident credits are handled only in Review &amp;
            reconciliation, so there is a single authoritative crediting route.
          </p>
        </TabsContent>
        <TabsContent value="central" className="pt-5">
          <CentralMeterPanel propertyId={active} userId={user.id} />
        </TabsContent>
        <TabsContent value="submeters" className="pt-5">
          <SubmeterPanel propertyId={active} userId={user.id} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
