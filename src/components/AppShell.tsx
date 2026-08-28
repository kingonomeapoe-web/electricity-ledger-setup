import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  LogOut,
  Home,
  Building2,
  ShieldCheck,
  ClipboardList,
  Receipt,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/useAuth";

type NavItem = { to: string; label: string; icon: typeof Home };

export function AppShell({
  title,
  subtitle,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { adminMemberships, residentMemberships, isAdmin } = useCurrentProfile();
  const width = wide ? "max-w-7xl" : "max-w-5xl";

  const items: NavItem[] = [{ to: "/dashboard", label: "Home", icon: Home }];
  if (residentMemberships.length > 0) {
    items.push({ to: "/resident", label: "My electricity", icon: Receipt });
  }
  if (adminMemberships.length > 0) {
    items.push({ to: "/review", label: "Review", icon: ClipboardList });
    items.push({ to: "/admin", label: "Evidence", icon: ShieldCheck });
  }
  if (isAdmin) {
    items.push({ to: "/setup", label: "Setup", icon: Building2 });
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <header className="border-b border-border bg-card">
        <div className={`mx-auto flex ${width} items-center justify-between gap-3 px-4 py-3`}>
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Electricity Ledger</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{ className: "bg-accent text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className={`mx-auto ${width} px-4 py-6`}>
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card sm:hidden">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground"
            activeProps={{ className: "text-primary" }}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
