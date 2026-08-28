import { useQuery } from "@tanstack/react-query";
import { Loader2, Zap, Home, Users, Gauge } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatKwh, formatDateTime } from "@/lib/audit";

type ApartmentRow = {
  id: string;
  unit_name: string;
  submeters: Array<{ id: string; identifier: string; active: boolean }>;
  resident_accounts: Array<{
    id: string;
    active: boolean;
    profiles: { full_name: string; email: string | null } | null;
  }>;
};

export function PropertyOverview({ propertyId }: { propertyId: string }) {
  const query = useQuery({
    queryKey: ["property-overview", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const [property, meter, apartments] = await Promise.all([
        supabase.from("properties").select("id, name, address").eq("id", propertyId).maybeSingle(),
        supabase
          .from("meters")
          .select("id, identifier, meter_number, provider")
          .eq("property_id", propertyId)
          .eq("meter_type", "prepaid_main")
          .eq("active", true)
          .maybeSingle(),
        supabase
          .from("apartments")
          .select(
            "id, unit_name, submeters(id, identifier, active), resident_accounts(id, active, profiles:resident_id(full_name, email))",
          )
          .eq("property_id", propertyId)
          .eq("active", true)
          .order("unit_name"),
      ]);

      if (property.error) throw property.error;
      if (meter.error) throw meter.error;
      if (apartments.error) throw apartments.error;

      let balance: { reading_kwh: number; captured_at: string; reading_kind: string } | null = null;
      if (meter.data) {
        const { data, error } = await supabase
          .from("central_meter_readings")
          .select("reading_kwh, captured_at, reading_kind")
          .eq("meter_id", meter.data.id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        balance = data;
      }

      return {
        property: property.data,
        meter: meter.data,
        balance,
        apartments: (apartments.data ?? []) as unknown as ApartmentRow[],
      };
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading property data…
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Unable to load property data.
      </p>
    );
  }

  const data = query.data!;
  if (!data.property) {
    return (
      <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Your property has not been configured yet.
      </p>
    );
  }

  const residentCount = data.apartments.reduce(
    (total, apartment) => total + apartment.resident_accounts.filter((r) => r.active).length,
    0,
  );
  const submeterCount = data.apartments.reduce(
    (total, apartment) => total + apartment.submeters.filter((s) => s.active).length,
    0,
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{data.property.name}</h2>
        {data.property.address ? (
          <p className="mt-1 text-sm text-muted-foreground">{data.property.address}</p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={Zap} label="Central meter balance">
          {data.meter ? (
            data.balance ? (
              <>
                <p className="text-xl font-semibold">{formatKwh(data.balance.reading_kwh)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.balance.reading_kind} · {formatDateTime(data.balance.captured_at)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No opening balance recorded yet.</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">No main prepaid meter configured.</p>
          )}
        </Tile>
        <Tile icon={Home} label="Apartments">
          <p className="text-xl font-semibold">{data.apartments.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">{submeterCount} submeters</p>
        </Tile>
        <Tile icon={Users} label="Residents">
          <p className="text-xl font-semibold">{residentCount}</p>
        </Tile>
      </div>

      {data.meter ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">Main prepaid meter</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.meter.identifier}
            {data.meter.meter_number ? ` · meter no. ${data.meter.meter_number}` : ""}
            {data.meter.provider ? ` · ${data.meter.provider}` : ""}
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Apartments, submeters & residents</h3>
        {data.apartments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No apartment has been created yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.apartments.map((apartment) => {
              const submeter = apartment.submeters.find((s) => s.active);
              const residents = apartment.resident_accounts.filter((r) => r.active);
              return (
                <li key={apartment.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{apartment.unit_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {residents.length > 0
                        ? residents
                            .map((r) => r.profiles?.full_name ?? r.profiles?.email ?? "Resident")
                            .join(", ")
                        : "No resident linked."}
                    </p>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5" />
                    {submeter ? submeter.identifier : "No submeter has been assigned."}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Zap;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
