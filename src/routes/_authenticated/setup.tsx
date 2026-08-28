import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/useAuth";
import { createProperty, linkResident } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/setup")({
  head: () => ({
    meta: [
      { title: "Property setup — Electricity Ledger" },
      {
        name: "description",
        content: "Create properties, apartments, the main prepaid meter, submeters and resident access.",
      },
      { property: "og:title", content: "Property setup — Electricity Ledger" },
      {
        property: "og:description",
        content: "Configure buildings, meters, submeters and resident access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const { loading, isAdmin, adminMemberships, refetch } = useCurrentProfile();
  const queryClient = useQueryClient();
  const create = useServerFn(createProperty);
  const link = useServerFn(linkResident);

  const [propertyName, setPropertyName] = useState("");
  const [address, setAddress] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [submeterIdentifier, setSubmeterIdentifier] = useState("");
  const [meterIdentifier, setMeterIdentifier] = useState("");
  const [meterNumber, setMeterNumber] = useState("");
  const [residentEmail, setResidentEmail] = useState("");
  const [apartmentId, setApartmentId] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [submeterOpening, setSubmeterOpening] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const active = propertyId || adminMemberships[0]?.property_id || "";

  const apartmentsQuery = useQuery({
    queryKey: ["apartments", active],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apartments")
        .select("id, unit_name, submeters(id, identifier, submeter_readings(id, reading_kwh, reading_kind, captured_at))")
        .eq("property_id", active)
        .order("unit_name");
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        unit_name: string;
        submeters: Array<{
          id: string;
          identifier: string;
          submeter_readings: Array<{
            id: string;
            reading_kwh: number;
            reading_kind: string;
            captured_at: string;
          }>;
        }>;
      }>;
    },
  });

  const meterQuery = useQuery({
    queryKey: ["main-meter", active],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meters")
        .select("id, identifier, meter_number")
        .eq("property_id", active)
        .eq("meter_type", "prepaid_main")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const openingReadingQuery = useQuery({
    queryKey: ["central-opening", meterQuery.data?.id],
    enabled: !!meterQuery.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("central_meter_readings")
        .select("id, reading_kwh, captured_at")
        .eq("meter_id", meterQuery.data!.id)
        .eq("reading_kind", "opening")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  /** Opening records are written once; existing ones are never overwritten. */
  async function saveOpeningBalance() {
    const meter = meterQuery.data;
    const value = Number(openingBalance);
    if (!meter || !Number.isFinite(value) || value < 0) return;
    if (openingReadingQuery.data) {
      toast.error("An opening balance already exists and cannot be replaced.");
      return;
    }
    setBusyKey("central-opening");
    const { data: user } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await supabase.from("central_meter_readings").insert({
      meter_id: meter.id,
      reading_kwh: value,
      reading_kind: "opening",
      source: "manual",
      confirmed_value_kwh: value,
      captured_at: now,
      confirmed_at: now,
      captured_by: user.user!.id,
      confirmed_by: user.user!.id,
      notes: "Opening central meter balance captured during property setup",
    });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpeningBalance("");
    toast.success("Opening central meter balance recorded.");
    await queryClient.invalidateQueries({ queryKey: ["central-opening"] });
    await queryClient.invalidateQueries({ queryKey: ["property-overview"] });
  }

  async function saveSubmeterOpening(submeterId: string) {
    const value = Number(submeterOpening[submeterId]);
    if (!Number.isFinite(value) || value < 0) return;
    setBusyKey(submeterId);
    const { data: user } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await supabase.from("submeter_readings").insert({
      submeter_id: submeterId,
      reading_kwh: value,
      reading_kind: "opening",
      source: "manual",
      confirmed_value_kwh: value,
      captured_at: now,
      confirmed_at: now,
      captured_by: user.user!.id,
      confirmed_by: user.user!.id,
      notes: "Initial submeter reading captured during property setup",
    });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSubmeterOpening((current) => ({ ...current, [submeterId]: "" }));
    toast.success("Initial submeter reading recorded.");
    await queryClient.invalidateQueries({ queryKey: ["apartments"] });
    await queryClient.invalidateQueries({ queryKey: ["property-overview"] });
  }


  const createPropertyMutation = useMutation({
    mutationFn: () => create({ data: { name: propertyName, address: address || null } }),
    onSuccess: async () => {
      toast.success("Property created.");
      setPropertyName("");
      setAddress("");
      await refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function addApartment() {
    if (!active || !unitName) return;
    const { data, error } = await supabase
      .from("apartments")
      .insert({ property_id: active, unit_name: unitName })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (submeterIdentifier) {
      const { error: submeterError } = await supabase
        .from("submeters")
        .insert({ apartment_id: data.id, identifier: submeterIdentifier });
      if (submeterError) toast.error(submeterError.message);
    }
    setUnitName("");
    setSubmeterIdentifier("");
    toast.success("Apartment added.");
    await queryClient.invalidateQueries({ queryKey: ["apartments"] });
    await queryClient.invalidateQueries({ queryKey: ["submeters"] });
  }

  async function addMainMeter() {
    if (!active || !meterIdentifier) return;
    const { error } = await supabase.from("meters").insert({
      property_id: active,
      meter_type: "prepaid_main",
      identifier: meterIdentifier,
      meter_number: meterNumber || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setMeterIdentifier("");
    setMeterNumber("");
    toast.success("Main prepaid meter added.");
    await queryClient.invalidateQueries({ queryKey: ["main-meter"] });
  }

  const linkMutation = useMutation({
    mutationFn: () =>
      link({ data: { propertyId: active, apartmentId, email: residentEmail } }),
    onSuccess: () => {
      toast.success("Resident linked.");
      setResidentEmail("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (loading) {
    return (
      <AppShell title="Property setup">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell title="Property setup">
        <p className="text-sm text-muted-foreground">Administrator access is required.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Property setup" subtitle="Buildings, meters, submeters and resident access">
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Create a property</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pname">Name</Label>
              <Input id="pname" value={propertyName} onChange={(e) => setPropertyName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paddr">Address</Label>
              <Input id="paddr" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={propertyName.length < 2 || createPropertyMutation.isPending}
            onClick={() => createPropertyMutation.mutate()}
          >
            {createPropertyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create property
          </Button>
        </section>

        {adminMemberships.length > 0 ? (
          <>
            <div className="max-w-xs">
              <Label>Working on</Label>
              <Select value={active} onValueChange={setPropertyId}>
                <SelectTrigger className="mt-1.5">
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

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Main prepaid meter</h2>
              {meterQuery.data ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {meterQuery.data.identifier} · {meterQuery.data.meter_number ?? "no meter number"}
                </p>
              ) : (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mid">Identifier</Label>
                      <Input id="mid" value={meterIdentifier} onChange={(e) => setMeterIdentifier(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mnum">Meter number</Label>
                      <Input id="mnum" value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} />
                    </div>
                  </div>
                  <Button className="mt-4" onClick={() => void addMainMeter()} disabled={!meterIdentifier}>
                    Add main meter
                  </Button>
                </>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Apartments & submeters</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="unit">Unit name</Label>
                  <Input id="unit" value={unitName} onChange={(e) => setUnitName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sub">Submeter identifier</Label>
                  <Input id="sub" value={submeterIdentifier} onChange={(e) => setSubmeterIdentifier(e.target.value)} />
                </div>
              </div>
              <Button className="mt-4" onClick={() => void addApartment()} disabled={!unitName}>
                Add apartment
              </Button>

              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                {(apartmentsQuery.data ?? []).map((apartment) => (
                  <li key={apartment.id}>
                    {apartment.unit_name} —{" "}
                    {(apartment as unknown as { submeters: Array<{ identifier: string }> }).submeters?.[0]
                      ?.identifier ?? "no submeter"}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Link a resident</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The resident must have created an account first.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="remail">Resident email</Label>
                  <Input id="remail" type="email" value={residentEmail} onChange={(e) => setResidentEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Apartment</Label>
                  <Select value={apartmentId} onValueChange={setApartmentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select apartment" />
                    </SelectTrigger>
                    <SelectContent>
                      {(apartmentsQuery.data ?? []).map((apartment) => (
                        <SelectItem key={apartment.id} value={apartment.id}>
                          {apartment.unit_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="mt-4"
                disabled={!residentEmail || !apartmentId || linkMutation.isPending}
                onClick={() => linkMutation.mutate()}
              >
                {linkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Link resident
              </Button>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
