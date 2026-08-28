import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/audit";

type AuditRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
  profiles: { full_name: string } | null;
};

function summarise(value: unknown) {
  if (value === null || value === undefined) return "—";
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function AuditLogPanel({ propertyId }: { propertyId: string }) {
  const query = useQuery({
    queryKey: ["review-audit", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, event_type, entity_type, entity_id, old_data, new_data, created_at, profiles(full_name)")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as AuditRow[];
    },
  });

  if (query.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Previous state</TableHead>
              <TableHead>New state</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(row.created_at)}
                </TableCell>
                <TableCell className="text-sm">{row.profiles?.full_name ?? "System"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.event_type.replace(/_/g, " ").toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {row.entity_type}
                  {row.entity_id ? (
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {row.entity_id}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[220px] text-[11px] text-muted-foreground">
                  {summarise(row.old_data)}
                </TableCell>
                <TableCell className="max-w-[220px] text-[11px] text-muted-foreground">
                  {summarise(row.new_data)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <Badge variant="outline">{row.event_type.replace(/_/g, " ").toLowerCase()}</Badge>
              <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
            </div>
            <p className="mt-2 text-xs">
              {row.profiles?.full_name ?? "System"} · {row.entity_type}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{summarise(row.new_data)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
