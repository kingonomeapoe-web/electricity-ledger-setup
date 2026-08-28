import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Zap, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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
  const width = wide ? "max-w-7xl" : "max-w-5xl";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className={`mx-auto flex ${width} items-center justify-between gap-3 px-4 py-3`}>

          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Electricity Ledger</span>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/auth" });
            }}
          >
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
    </div>
  );
}
