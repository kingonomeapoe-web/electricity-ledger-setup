import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Building2, Receipt, ShieldCheck } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useCurrentProfile } from "@/hooks/useAuth";
import { claimFirstAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Electricity Ledger" },
      { name: "description", content: "Your electricity ledger home: receipts, meters and evidence." },
      { property: "og:title", content: "Dashboard — Electricity Ledger" },
      { property: "og:description", content: "Your electricity ledger home: receipts, meters and evidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { loading, profile, isAdmin, adminMemberships, residentMemberships, refetch } =
    useCurrentProfile();
  const claim = useServerFn(claimFirstAdmin);

  const claimMutation = useMutation({
    mutationFn: () => claim({ data: undefined as never }),
    onSuccess: async () => {
      toast.success("You are now the system administrator.");
      await refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (loading) {
    return (
      <AppShell title="Dashboard">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`Hello, ${profile?.full_name ?? "there"}`}
      subtitle={isAdmin ? "Administrator" : "Resident"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {residentMemberships.length > 0 ? (
          <Card
            icon={Receipt}
            title="My electricity"
            body="Upload a payment receipt and follow its review status."
            to="/resident"
          />
        ) : null}
        {adminMemberships.length > 0 ? (
          <>
            <Card
              icon={ShieldCheck}
              title="Evidence & readings"
              body="Review receipts, record token loads, capture central and submeter readings."
              to="/admin"
            />
            <Card
              icon={Building2}
              title="Property setup"
              body="Manage apartments, meters, submeters and resident access."
              to="/setup"
            />
          </>
        ) : null}
        {isAdmin && adminMemberships.length === 0 ? (
          <Card
            icon={Building2}
            title="Create your first property"
            body="Set up a building, its main prepaid meter and apartments."
            to="/setup"
          />
        ) : null}
      </div>

      {!isAdmin && residentMemberships.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium">You are not linked to an apartment yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask your building administrator to link {profile?.email ?? "your email"} to your unit.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={claimMutation.isPending}
            onClick={() => claimMutation.mutate()}
          >
            {claimMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            I am setting this system up (claim admin)
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}

function Card({
  icon: Icon,
  title,
  body,
  to,
}: {
  icon: typeof Receipt;
  title: string;
  body: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-accent"
    >
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </Link>
  );
}
