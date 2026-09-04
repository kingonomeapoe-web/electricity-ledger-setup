-- Property administrators need to read the names of residents assigned to the
-- properties they administer. Without this, the embedded profile query on the
-- Evidence & readings overview is denied by RLS for non-system admins.
drop policy if exists profiles_select_self on public.profiles;

create policy profiles_select_self on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1
    from public.property_members pm
    where pm.user_id = profiles.id
      and pm.active = true
      and public.is_property_admin(pm.property_id)
  )
);
