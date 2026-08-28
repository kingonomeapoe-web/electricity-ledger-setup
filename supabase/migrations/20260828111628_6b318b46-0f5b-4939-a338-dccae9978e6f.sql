-- Fix: Add search_path to functions that were missing it

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.calculate_submeter_delta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  prev numeric(14,3);
begin
  select sr.reading_kwh
    into prev
  from public.submeter_readings sr
  where sr.submeter_id = new.submeter_id
  order by sr.captured_at desc, sr.created_at desc
  limit 1;

  if prev is null then
    new.previous_reading_kwh := null;
    new.units_consumed_kwh := 0;
  else
    if new.reading_kwh < prev then
      raise exception 'Submeter reading cannot decrease. Previous: %, new: %', prev, new.reading_kwh;
    end if;
    new.previous_reading_kwh := prev;
    new.units_consumed_kwh := round(new.reading_kwh - prev, 3);
  end if;

  return new;
end;
$$;

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Immutable record: % cannot be updated or deleted', tg_table_name;
end;
$$;

-- Fix: Revoke public execute from all SECURITY DEFINER functions
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_property_admin(uuid) from public;
revoke execute on function public.is_property_resident(uuid) from public;
revoke execute on function public.confirm_central_meter_credit(uuid,numeric,numeric,numeric,uuid,uuid,text) from public;
revoke execute on function public.post_confirmed_submeter_consumption(uuid) from public;
revoke execute on function public.handle_new_user() from public;

-- Fix: Revoke authenticated execute from trigger-only function (handle_new_user)
revoke execute on function public.handle_new_user() from authenticated;