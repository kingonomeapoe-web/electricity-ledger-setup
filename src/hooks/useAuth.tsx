import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useSessionUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

export type Membership = {
  property_id: string;
  role: "owner_admin" | "admin" | "resident";
  apartment_id: string | null;
  property_name: string;
};

export function useCurrentProfile() {
  const { user, loading } = useSessionUser();

  const query = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: profile, error }, { data: members, error: memberError }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle(),
        supabase
          .from("property_members")
          .select("property_id, role, apartment_id, active, properties(name)")
          .eq("user_id", user!.id)
          .eq("active", true),
      ]);
      if (error) throw error;
      if (memberError) throw memberError;

      const memberships: Membership[] = (members ?? []).map((m) => ({
        property_id: m.property_id,
        role: m.role,
        apartment_id: m.apartment_id,
        property_name:
          (m as unknown as { properties: { name: string } | null }).properties?.name ?? "Property",
      }));

      return { profile, memberships };
    },
  });

  const memberships = query.data?.memberships ?? [];
  const adminMemberships = memberships.filter(
    (m) => m.role === "owner_admin" || m.role === "admin",
  );

  return {
    user,
    loading: loading || query.isLoading,
    profileError: query.error,
    profile: query.data?.profile ?? null,
    memberships,
    adminMemberships,
    residentMemberships: memberships.filter((m) => m.role === "resident"),
    isAdmin: query.data?.profile?.role === "admin",
    refetch: query.refetch,
  };
}
