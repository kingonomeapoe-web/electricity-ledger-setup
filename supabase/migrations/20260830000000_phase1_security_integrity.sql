-- Phase 1 security and transaction integrity remediation

create extension if not exists pgcrypto;

-- Payment lifecycle additions used by authoritative state transitions.
alter type public.payment_status add value if not exists 'ocr_processing';
alter type public.payment_status add value if not exists 'ocr_failed';

do $$ begin
  create type public.adjustment_request_status as enum ('pending', 'approved', 'rejected', 'executed');
exception when duplicate_object then null; end $$;

alter table public.ocr_extractions add column if not exists token_fingerprint text;
create unique index if not exists uq_ocr_token_fingerprint
  on public.ocr_extractions(token_fingerprint)
  where token_fingerprint is not null and token_fingerprint <> '';

create unique index if not exists uq_payment_submission_evidence
  on public.payment_submissions(evidence_id);

create table if not exists public.adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  resident_id uuid not null references public.profiles(id) on delete restrict,
  apartment_id uuid not null references public.apartments(id) on delete restrict,
  ledger_account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  requested_units numeric(14,3) not null check (requested_units <> 0),
  adjustment_type public.ledger_transaction_type not null check (adjustment_type in ('adjustment','correction','reversal')),
  reason text not null,
  description text not null,
  source_transaction_id uuid references public.ledger_transactions(id) on delete restrict,
  status public.adjustment_request_status not null default 'pending',
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  executed_at timestamptz,
  resulting_transaction_id uuid references public.ledger_transactions(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.adjustment_requests enable row level security;

drop policy if exists adjustment_requests_select on public.adjustment_requests;
create policy adjustment_requests_select on public.adjustment_requests
for select to authenticated
using (public.is_property_admin(property_id));

grant select on public.adjustment_requests to authenticated;
grant all on public.adjustment_requests to service_role;

-- Audit hash chaining. A table lock serializes hash assignment to avoid forks.
create or replace function public.hash_audit_event()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_previous text;
  v_payload text;
begin
  lock table public.audit_logs in exclusive mode;

  select event_hash into v_previous
  from public.audit_logs
  order by created_at desc, id desc
  limit 1;

  new.previous_hash := v_previous;
  v_payload := concat_ws('|',
    coalesce(v_previous, ''),
    coalesce(new.created_at::text, ''),
    coalesce(new.actor_id::text, ''),
    coalesce(new.event_type, ''),
    coalesce(new.entity_type, ''),
    coalesce(new.entity_id::text, ''),
    coalesce(new.old_data::text, ''),
    coalesce(new.new_data::text, ''),
    coalesce(new.metadata::text, '')
  );
  new.event_hash := encode(digest(v_payload, 'sha256'), 'hex');
  return new;
end;
$$;

drop trigger if exists trg_audit_hash_insert on public.audit_logs;
create trigger trg_audit_hash_insert
before insert on public.audit_logs
for each row execute function public.hash_audit_event();

drop policy if exists payment_submissions_admin_update on public.payment_submissions;

-- Tighten storage policies: ownership comes from path + metadata, not property membership only.
drop policy if exists storage_electricity_evidence_insert on storage.objects;
drop policy if exists storage_electricity_evidence_select on storage.objects;

create policy storage_electricity_evidence_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'electricity-evidence'
  and array_length(storage.foldername(name), 1) >= 4
  and (storage.foldername(name))[3] = auth.uid()::text
  and (
    (
      (storage.foldername(name))[2] = 'payment_receipt'
      and public.is_property_resident(((storage.foldername(name))[1])::uuid)
    )
    or public.is_property_admin(((storage.foldername(name))[1])::uuid)
  )
);

create policy storage_electricity_evidence_select
on storage.objects for select to authenticated
using (
  bucket_id = 'electricity-evidence'
  and exists (
    select 1
    from public.evidence_files ef
    where ef.storage_bucket = bucket_id
      and ef.storage_path = name
      and (ef.uploaded_by = auth.uid() or public.is_property_admin(ef.property_id))
  )
);

create or replace function public.admin_transition_payment_status(
  p_payment_submission_id uuid,
  p_new_status public.payment_status,
  p_reason text default null,
  p_duplicate_of uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payment_submissions%rowtype;
  v_allowed boolean := false;
begin
  select * into v_payment from public.payment_submissions where id = p_payment_submission_id for update;
  if not found then raise exception 'Payment submission not found'; end if;
  if not public.is_property_admin(v_payment.property_id) then raise exception 'You are not authorized to process this property'; end if;

  if v_payment.status = p_new_status then
    return v_payment.id;
  end if;

  v_allowed :=
    (v_payment.status in ('pending_approval','ocr_processed') and p_new_status = 'approved_for_loading')
    or (v_payment.status in ('uploaded','ocr_processing','ocr_processed','pending_approval','approved_for_loading') and p_new_status in ('rejected','duplicate','disputed','correction_required'));

  if not v_allowed then
    raise exception 'This payment cannot transition from % to %', v_payment.status, p_new_status;
  end if;

  if p_new_status = 'rejected' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection reason is required';
  end if;

  update public.payment_submissions
    set status = p_new_status,
        rejection_reason = case when p_new_status = 'rejected' then btrim(p_reason) else rejection_reason end,
        duplicate_of = case when p_new_status = 'duplicate' then p_duplicate_of else duplicate_of end,
        reviewed_at = now(),
        reviewed_by = auth.uid()
  where id = v_payment.id;

  insert into public.audit_logs(property_id, actor_id, event_type, entity_type, entity_id, old_data, new_data, metadata)
  values (
    v_payment.property_id, auth.uid(), 'PAYMENT_STATUS_TRANSITIONED', 'payment_submission', v_payment.id,
    jsonb_build_object('status', v_payment.status),
    jsonb_build_object('status', p_new_status),
    jsonb_build_object('reason', p_reason, 'duplicate_of', p_duplicate_of)
  );

  return v_payment.id;
end;
$$;

revoke all on function public.admin_transition_payment_status(uuid, public.payment_status, text, uuid) from public, anon;
grant execute on function public.admin_transition_payment_status(uuid, public.payment_status, text, uuid) to authenticated;

drop function if exists public.confirm_central_meter_credit(uuid, numeric, numeric, numeric, uuid, uuid, text);

create or replace function public.confirm_central_meter_credit(
  p_payment_submission_id uuid,
  p_units_loaded_kwh numeric,
  p_central_balance_before_kwh numeric,
  p_central_balance_after_kwh numeric,
  p_reading_evidence_id uuid,
  p_load_evidence_id uuid default null,
  p_notes text default null,
  p_reading_source public.reading_source default 'ocr_confirmed',
  p_ocr_value_kwh numeric default null,
  p_ocr_confidence numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payment_submissions%rowtype;
  v_meter public.meters%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_previous_balance numeric(14,3) := 0;
  v_ledger_tx uuid;
  v_load_id uuid;
  v_reading_id uuid;
  v_amount numeric(14,2) := 0;
  v_token_last4 text;
  v_token_fingerprint text;
  v_reference text;
  v_expected_before numeric(14,3);
begin
  if p_units_loaded_kwh <= 0 then raise exception 'Units loaded must be greater than zero'; end if;
  if p_central_balance_before_kwh < 0 or p_central_balance_after_kwh < 0 then raise exception 'Central meter balances cannot be negative'; end if;

  select * into v_payment from public.payment_submissions where id = p_payment_submission_id for update;
  if not found then raise exception 'Payment submission not found'; end if;
  if not public.is_property_admin(v_payment.property_id) then raise exception 'You are not authorized to process this property'; end if;
  if v_payment.status not in ('approved_for_loading','loaded') then
    raise exception 'This payment cannot be credited from its current state: %', v_payment.status;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_payment.property_id::text));

  select * into v_meter from public.meters where property_id = v_payment.property_id and meter_type = 'prepaid_main' and active = true limit 1;
  if not found then raise exception 'Active main prepaid meter not found'; end if;

  select coalesce(cmr.confirmed_value_kwh, cmr.reading_kwh) into v_expected_before
  from public.central_meter_readings cmr
  where cmr.meter_id = v_meter.id and cmr.confirmed_at is not null
  order by cmr.captured_at desc, cmr.created_at desc, cmr.id desc
  limit 1;

  if v_expected_before is not null and round(v_expected_before, 3) <> round(p_central_balance_before_kwh, 3) then
    raise exception 'Central meter previous balance mismatch. Expected %, got %', v_expected_before, p_central_balance_before_kwh;
  end if;

  if round(p_central_balance_before_kwh + p_units_loaded_kwh, 3) <> round(p_central_balance_after_kwh, 3) then
    raise exception 'Central meter reading does not reconcile';
  end if;

  if p_reading_evidence_id is null then raise exception 'A central meter reading evidence file is required'; end if;
  if not exists (select 1 from public.evidence_files where id = p_reading_evidence_id and property_id = v_payment.property_id and evidence_type = 'central_meter_reading') then
    raise exception 'Central meter reading evidence is invalid for this property';
  end if;
  if p_load_evidence_id is not null and not exists (select 1 from public.evidence_files where id = p_load_evidence_id and property_id = v_payment.property_id and evidence_type = 'central_meter_load') then
    raise exception 'Central meter load evidence is invalid for this property';
  end if;

  select coalesce(amount, amount_paid, 0), token_last4, token_fingerprint, coalesce(transaction_reference, transaction_number)
    into v_amount, v_token_last4, v_token_fingerprint, v_reference
  from public.ocr_extractions
  where payment_submission_id = v_payment.id
  order by created_at desc
  limit 1;

  if v_token_fingerprint is not null and exists (select 1 from public.central_meter_loads where token_fingerprint = v_token_fingerprint) then
    raise exception 'Duplicate token cannot be loaded twice';
  end if;
  if v_reference is not null and exists (
    select 1 from public.central_meter_loads cml
    join public.ocr_extractions oe on oe.payment_submission_id = cml.payment_submission_id
    where coalesce(oe.transaction_reference, oe.transaction_number) = v_reference
  ) then
    raise exception 'Duplicate transaction reference cannot be credited twice';
  end if;

  select la.* into v_account
  from public.ledger_accounts la
  join public.resident_accounts ra on ra.id = la.resident_account_id
  where ra.resident_id = v_payment.resident_id and ra.property_id = v_payment.property_id and ra.apartment_id = v_payment.apartment_id and ra.active = true
  for update;
  if not found then raise exception 'Resident ledger account not found'; end if;

  select coalesce(lt.balance_after_kwh, 0) into v_previous_balance
  from public.ledger_transactions lt
  where lt.ledger_account_id = v_account.id
  order by lt.created_at desc, lt.id desc
  limit 1;
  v_previous_balance := coalesce(v_previous_balance, 0);

  insert into public.central_meter_readings(
    meter_id, reading_kwh, reading_kind, source, evidence_id, ocr_value_kwh, ocr_confidence,
    confirmed_value_kwh, captured_at, confirmed_at, captured_by, confirmed_by, notes
  ) values (
    v_meter.id, p_central_balance_after_kwh, 'post_load', p_reading_source, p_reading_evidence_id,
    p_ocr_value_kwh, p_ocr_confidence, p_central_balance_after_kwh, now(), now(), auth.uid(), auth.uid(), p_notes
  ) returning id into v_reading_id;

  insert into public.central_meter_loads(
    property_id, meter_id, payment_submission_id, units_loaded_kwh, amount_paid, token_last4, token_fingerprint,
    central_balance_before_kwh, central_balance_after_kwh, load_evidence_id, reading_evidence_id,
    loaded_by, confirmed_at, confirmed_by, status, notes
  ) values (
    v_payment.property_id, v_meter.id, v_payment.id, p_units_loaded_kwh, coalesce(v_amount, 0), v_token_last4, v_token_fingerprint,
    p_central_balance_before_kwh, p_central_balance_after_kwh, p_load_evidence_id, p_reading_evidence_id,
    auth.uid(), now(), auth.uid(), 'confirmed', p_notes
  ) returning id into v_load_id;

  insert into public.ledger_transactions(
    ledger_account_id, property_id, resident_id, apartment_id, transaction_type, units_kwh, amount,
    balance_before_kwh, balance_after_kwh, source_type, source_id, description, created_by
  ) values (
    v_account.id, v_payment.property_id, v_payment.resident_id, v_payment.apartment_id, 'credit', p_units_loaded_kwh, coalesce(v_amount, 0),
    v_previous_balance, round(v_previous_balance + p_units_loaded_kwh, 3), 'central_meter_load', v_load_id,
    'Electricity credit after confirmed token loading', auth.uid()
  ) returning id into v_ledger_tx;

  update public.payment_submissions set status = 'credited', reviewed_at = now(), reviewed_by = auth.uid() where id = v_payment.id;

  insert into public.audit_logs(property_id, actor_id, event_type, entity_type, entity_id, old_data, new_data, metadata)
  values (
    v_payment.property_id, auth.uid(), 'RESIDENT_CREDITED', 'ledger_transaction', v_ledger_tx,
    jsonb_build_object('payment_status', v_payment.status, 'resident_balance_kwh', v_previous_balance),
    jsonb_build_object('payment_status', 'credited', 'resident_balance_kwh', round(v_previous_balance + p_units_loaded_kwh, 3), 'units_kwh', p_units_loaded_kwh),
    jsonb_build_object('payment_submission_id', v_payment.id, 'central_meter_load_id', v_load_id, 'central_meter_reading_id', v_reading_id, 'token_last4', v_token_last4)
  );

  return v_ledger_tx;
end;
$$;

revoke all on function public.confirm_central_meter_credit(uuid,numeric,numeric,numeric,uuid,uuid,text,public.reading_source,numeric,numeric) from public, anon;
grant execute on function public.confirm_central_meter_credit(uuid,numeric,numeric,numeric,uuid,uuid,text,public.reading_source,numeric,numeric) to authenticated;

create or replace function public.confirm_and_post_submeter_consumption(p_submeter_reading_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reading public.submeter_readings%rowtype;
  v_submeter public.submeters%rowtype;
  v_apartment public.apartments%rowtype;
  v_resident public.resident_accounts%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_previous_balance numeric(14,3) := 0;
  v_tx uuid;
  v_consumption numeric(14,3);
begin
  select * into v_reading from public.submeter_readings where id = p_submeter_reading_id for update;
  if not found then raise exception 'Submeter reading not found'; end if;

  select * into v_submeter from public.submeters where id = v_reading.submeter_id for update;
  select * into v_apartment from public.apartments where id = v_submeter.apartment_id;
  if not public.is_property_admin(v_apartment.property_id) then raise exception 'You are not authorized to process this property'; end if;

  select id into v_tx from public.ledger_transactions where source_type = 'submeter_reading' and source_id = p_submeter_reading_id limit 1;
  if v_tx is not null then return v_tx; end if;

  v_consumption := coalesce(v_reading.units_consumed_kwh, 0);
  if v_consumption < 0 then raise exception 'Submeter consumption cannot be negative'; end if;
  if v_reading.previous_reading_kwh is not null and v_reading.reading_kwh < v_reading.previous_reading_kwh then raise exception 'Submeter reading cannot decrease'; end if;

  perform set_config('app.allow_immutable_update', 'on', true);
  update public.submeter_readings
    set confirmed_at = coalesce(confirmed_at, now()),
        confirmed_by = coalesce(confirmed_by, auth.uid()),
        confirmed_value_kwh = coalesce(confirmed_value_kwh, reading_kwh)
  where id = p_submeter_reading_id;
  perform set_config('app.allow_immutable_update', 'off', true);

  select * into v_resident from public.resident_accounts where apartment_id = v_apartment.id and active = true limit 1;
  if not found then raise exception 'No active resident account found for apartment'; end if;
  select * into v_account from public.ledger_accounts where resident_account_id = v_resident.id for update;
  if not found then raise exception 'Resident ledger account not found'; end if;

  select coalesce(balance_after_kwh, 0) into v_previous_balance
  from public.ledger_transactions
  where ledger_account_id = v_account.id
  order by created_at desc, id desc
  limit 1;
  v_previous_balance := coalesce(v_previous_balance, 0);

  if v_consumption > v_previous_balance then
    raise exception 'Insufficient resident credit for recorded consumption. Balance: %, consumption: %', v_previous_balance, v_consumption;
  end if;

  insert into public.ledger_transactions(
    ledger_account_id, property_id, resident_id, apartment_id, transaction_type, units_kwh, amount,
    balance_before_kwh, balance_after_kwh, source_type, source_id, description, created_by
  ) values (
    v_account.id, v_apartment.property_id, v_resident.resident_id, v_apartment.id, 'consumption', -v_consumption, null,
    v_previous_balance, round(v_previous_balance - v_consumption, 3), 'submeter_reading', p_submeter_reading_id,
    'Consumption calculated from confirmed submeter reading', auth.uid()
  ) returning id into v_tx;

  insert into public.audit_logs(property_id, actor_id, event_type, entity_type, entity_id, new_data, metadata)
  values (
    v_apartment.property_id, auth.uid(), 'CONSUMPTION_RECORDED', 'ledger_transaction', v_tx,
    jsonb_build_object('consumption_kwh', v_consumption, 'submeter_reading_id', p_submeter_reading_id),
    jsonb_build_object('resident_id', v_resident.resident_id, 'apartment_id', v_apartment.id)
  );

  return v_tx;
exception when others then
  perform set_config('app.allow_immutable_update', 'off', true);
  raise;
end;
$$;

revoke all on function public.confirm_and_post_submeter_consumption(uuid) from public, anon;
grant execute on function public.confirm_and_post_submeter_consumption(uuid) to authenticated;

create or replace function public.post_confirmed_submeter_consumption(p_submeter_reading_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.confirm_and_post_submeter_consumption(p_submeter_reading_id);
end;
$$;

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_immutable_update', true) = 'on' then
    return new;
  end if;
  raise exception 'Immutable record: % cannot be updated or deleted', tg_table_name;
end;
$$;

create or replace function public.request_ledger_adjustment(
  p_resident_id uuid,
  p_property_id uuid,
  p_units_kwh numeric,
  p_reason text,
  p_description text,
  p_transaction_type public.ledger_transaction_type default 'adjustment',
  p_source_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.resident_accounts%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_request_id uuid;
begin
  if not public.is_property_admin(p_property_id) then raise exception 'Only an administrator of this property can request an adjustment'; end if;
  if p_transaction_type not in ('adjustment','correction','reversal') then raise exception 'Invalid adjustment type'; end if;
  if p_units_kwh is null or p_units_kwh = 0 then raise exception 'Adjustment units must be non-zero'; end if;
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_description), '') = '' then raise exception 'A reason and description are required'; end if;

  select * into v_resident from public.resident_accounts where resident_id = p_resident_id and property_id = p_property_id and active = true limit 1;
  if not found then raise exception 'Active resident account not found for this property'; end if;
  select * into v_account from public.ledger_accounts where resident_account_id = v_resident.id;
  if not found then raise exception 'Resident ledger account not found'; end if;

  insert into public.adjustment_requests(property_id, resident_id, apartment_id, ledger_account_id, requested_units, adjustment_type, reason, description, source_transaction_id, requested_by)
  values (p_property_id, p_resident_id, v_resident.apartment_id, v_account.id, p_units_kwh, p_transaction_type, btrim(p_reason), btrim(p_description), p_source_transaction_id, auth.uid())
  returning id into v_request_id;

  insert into public.audit_logs(property_id, actor_id, event_type, entity_type, entity_id, new_data)
  values (p_property_id, auth.uid(), 'LEDGER_ADJUSTMENT_REQUESTED', 'adjustment_request', v_request_id,
    jsonb_build_object('resident_id', p_resident_id, 'requested_units', p_units_kwh, 'adjustment_type', p_transaction_type, 'reason', btrim(p_reason)));

  return v_request_id;
end;
$$;

create or replace function public.execute_approved_adjustment(p_adjustment_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.adjustment_requests%rowtype;
  v_previous numeric(14,3) := 0;
  v_tx uuid;
begin
  select * into v_req from public.adjustment_requests where id = p_adjustment_request_id for update;
  if not found then raise exception 'Adjustment request not found'; end if;
  if not public.is_property_admin(v_req.property_id) then raise exception 'Only an administrator of this property can execute an adjustment'; end if;
  if v_req.status = 'executed' then return v_req.resulting_transaction_id; end if;
  if v_req.status not in ('pending','approved') then raise exception 'Adjustment request cannot be executed from status %', v_req.status; end if;

  select coalesce(balance_after_kwh, 0) into v_previous
  from public.ledger_transactions
  where ledger_account_id = v_req.ledger_account_id
  order by created_at desc, id desc
  limit 1;
  v_previous := coalesce(v_previous, 0);
  if round(v_previous + v_req.requested_units, 3) < 0 then raise exception 'Adjustment would drive the resident balance negative'; end if;

  insert into public.ledger_transactions(
    ledger_account_id, property_id, resident_id, apartment_id, transaction_type, units_kwh, amount,
    balance_before_kwh, balance_after_kwh, source_type, source_id, description, created_by
  ) values (
    v_req.ledger_account_id, v_req.property_id, v_req.resident_id, v_req.apartment_id, v_req.adjustment_type, v_req.requested_units, null,
    v_previous, round(v_previous + v_req.requested_units, 3), 'adjustment_request', v_req.id,
    v_req.reason || ': ' || v_req.description, auth.uid()
  ) returning id into v_tx;

  update public.adjustment_requests
    set status = 'executed', reviewed_by = auth.uid(), reviewed_at = coalesce(reviewed_at, now()), executed_at = now(), resulting_transaction_id = v_tx
  where id = v_req.id;

  insert into public.audit_logs(property_id, actor_id, event_type, entity_type, entity_id, old_data, new_data, metadata)
  values (v_req.property_id, auth.uid(), 'LEDGER_ADJUSTMENT_EXECUTED', 'ledger_transaction', v_tx,
    jsonb_build_object('balance_kwh', v_previous),
    jsonb_build_object('balance_kwh', round(v_previous + v_req.requested_units, 3), 'units_kwh', v_req.requested_units),
    jsonb_build_object('adjustment_request_id', v_req.id));

  return v_tx;
end;
$$;

create or replace function public.create_ledger_adjustment(
  p_resident_id uuid,
  p_property_id uuid,
  p_units_kwh numeric,
  p_reason text,
  p_explanation text,
  p_transaction_type public.ledger_transaction_type default 'adjustment',
  p_original_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  v_request_id := public.request_ledger_adjustment(p_resident_id, p_property_id, p_units_kwh, p_reason, p_explanation, p_transaction_type, p_original_transaction_id);
  return public.execute_approved_adjustment(v_request_id);
end;
$$;

revoke all on function public.request_ledger_adjustment(uuid, uuid, numeric, text, text, public.ledger_transaction_type, uuid) from public, anon;
revoke all on function public.execute_approved_adjustment(uuid) from public, anon;
grant execute on function public.request_ledger_adjustment(uuid, uuid, numeric, text, text, public.ledger_transaction_type, uuid) to authenticated;
grant execute on function public.execute_approved_adjustment(uuid) to authenticated;
