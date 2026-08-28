-- ============================================================
-- ELECTRICITY LEDGER — SUPABASE / POSTGRES PRODUCTION SCHEMA
-- V1.1
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================

do $$ begin
  create type public.app_role as enum ('admin', 'resident');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.property_member_role as enum ('owner_admin', 'admin', 'resident');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meter_type as enum ('prepaid_main', 'submeter');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum (
    'uploaded',
    'ocr_processed',
    'pending_approval',
    'approved_for_loading',
    'loaded',
    'credited',
    'rejected',
    'duplicate',
    'disputed',
    'correction_required'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ocr_status as enum ('pending', 'processing', 'completed', 'failed', 'needs_review');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ledger_transaction_type as enum (
    'opening_balance',
    'credit',
    'consumption',
    'adjustment',
    'reversal',
    'correction'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.evidence_type as enum (
    'payment_receipt',
    'central_meter_reading',
    'central_meter_load',
    'submeter_reading'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reading_source as enum ('manual', 'ocr_confirmed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reconciliation_status as enum ('pending', 'balanced', 'variance', 'reviewed', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reconciliation_classification as enum (
    'common_area',
    'meter_loss',
    'timing_difference',
    'meter_issue',
    'data_entry_error',
    'unmetered_load',
    'suspected_tampering',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_channel as enum ('sms', 'whatsapp', 'in_app');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_status as enum ('queued', 'sent', 'delivered', 'failed', 'read');
exception when duplicate_object then null; end $$;

-- ============================================================
-- PROFILES / PROPERTY STRUCTURE
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  role public.app_role not null default 'resident',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  description text,
  timezone text not null default 'Africa/Lagos',
  currency_code text not null default 'NGN',
  active boolean not null default true,
  activated_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_members (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.property_member_role not null,
  apartment_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(property_id, user_id)
);

create table if not exists public.apartments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, unit_name)
);

alter table public.property_members
  drop constraint if exists property_members_apartment_id_fkey;
alter table public.property_members
  add constraint property_members_apartment_id_fkey
  foreign key (apartment_id) references public.apartments(id) on delete set null;

create table if not exists public.resident_accounts (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null unique references public.profiles(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  apartment_id uuid not null references public.apartments(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- METERS
-- ============================================================

create table if not exists public.meters (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  meter_type public.meter_type not null,
  meter_number text,
  identifier text not null,
  provider text,
  tariff_class text,
  tariff_rate numeric(14,4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, identifier)
);

create unique index if not exists uq_active_main_meter_per_property
  on public.meters(property_id)
  where meter_type = 'prepaid_main' and active = true;

create table if not exists public.submeters (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null unique references public.apartments(id) on delete restrict,
  meter_number text,
  identifier text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- OPENING BALANCES / READINGS
-- ============================================================

create table if not exists public.central_meter_readings (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references public.meters(id) on delete restrict,
  reading_kwh numeric(14,3) not null check (reading_kwh >= 0),
  reading_kind text not null default 'snapshot' check (reading_kind in ('opening', 'snapshot', 'post_load')),
  source public.reading_source not null default 'manual',
  evidence_id uuid,
  ocr_value_kwh numeric(14,3),
  ocr_confidence numeric(5,2) check (ocr_confidence between 0 and 100),
  confirmed_value_kwh numeric(14,3),
  captured_at timestamptz not null default now(),
  confirmed_at timestamptz,
  captured_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_by uuid references public.profiles(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_main_opening_reading
  on public.central_meter_readings(meter_id)
  where reading_kind = 'opening';

create table if not exists public.submeter_readings (
  id uuid primary key default gen_random_uuid(),
  submeter_id uuid not null references public.submeters(id) on delete restrict,
  reading_kind text not null default 'snapshot' check (reading_kind in ('opening', 'snapshot')),
  reading_kwh numeric(14,3) not null check (reading_kwh >= 0),
  previous_reading_kwh numeric(14,3),
  units_consumed_kwh numeric(14,3),
  source public.reading_source not null default 'manual',
  evidence_id uuid,
  ocr_value_kwh numeric(14,3),
  ocr_confidence numeric(5,2) check (ocr_confidence between 0 and 100),
  confirmed_value_kwh numeric(14,3),
  captured_at timestamptz not null default now(),
  confirmed_at timestamptz,
  captured_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_by uuid references public.profiles(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  check (previous_reading_kwh is null or previous_reading_kwh >= 0),
  check (units_consumed_kwh is null or units_consumed_kwh >= 0)
);

-- ============================================================
-- EVIDENCE / RECEIPTS / OCR
-- ============================================================

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  evidence_type public.evidence_type not null,
  storage_bucket text not null default 'electricity-evidence',
  storage_path text not null,
  original_filename text,
  mime_type text,
  file_size_bytes bigint,
  sha256_hash text,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_evidence_sha256
  on public.evidence_files(sha256_hash)
  where sha256_hash is not null;

alter table public.central_meter_readings
  drop constraint if exists central_meter_readings_evidence_id_fkey;
alter table public.central_meter_readings
  add constraint central_meter_readings_evidence_id_fkey
  foreign key (evidence_id) references public.evidence_files(id) on delete restrict;

alter table public.submeter_readings
  drop constraint if exists submeter_readings_evidence_id_fkey;
alter table public.submeter_readings
  add constraint submeter_readings_evidence_id_fkey
  foreign key (evidence_id) references public.evidence_files(id) on delete restrict;

create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  resident_id uuid not null references public.profiles(id) on delete restrict,
  apartment_id uuid not null references public.apartments(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  status public.payment_status not null default 'uploaded',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  rejection_reason text,
  duplicate_of uuid references public.payment_submissions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ocr_extractions (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  payment_submission_id uuid references public.payment_submissions(id) on delete restrict,
  status public.ocr_status not null default 'pending',
  provider text,
  model text,
  raw_text text,
  structured_data jsonb not null default '{}'::jsonb,
  amount numeric(14,2),
  amount_paid numeric(14,2),
  units_kwh numeric(14,3),
  meter_number text,
  beneficiary_id text,
  token_ciphertext text,
  token_last4 text,
  transaction_reference text,
  transaction_number text,
  session_id text,
  customer_name text,
  service_address text,
  transaction_date date,
  transaction_time timestamptz,
  tariff_class text,
  tariff_rate numeric(14,4),
  confidence numeric(5,2) check (confidence between 0 and 100),
  field_confidence jsonb not null default '{}'::jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_transaction_reference
  on public.ocr_extractions(transaction_reference)
  where transaction_reference is not null and transaction_reference <> '';

create unique index if not exists uq_token_ciphertext
  on public.ocr_extractions(token_ciphertext)
  where token_ciphertext is not null and token_ciphertext <> '';

-- ============================================================
-- CENTRAL METER LOAD / CREDIT EVENTS
-- ============================================================

create table if not exists public.central_meter_loads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  meter_id uuid not null references public.meters(id) on delete restrict,
  payment_submission_id uuid not null unique references public.payment_submissions(id) on delete restrict,
  units_loaded_kwh numeric(14,3) not null check (units_loaded_kwh > 0),
  amount_paid numeric(14,2) not null check (amount_paid >= 0),
  token_last4 text,
  token_fingerprint text,
  central_balance_before_kwh numeric(14,3) not null check (central_balance_before_kwh >= 0),
  central_balance_after_kwh numeric(14,3) not null check (central_balance_after_kwh >= 0),
  load_evidence_id uuid references public.evidence_files(id) on delete restrict,
  reading_evidence_id uuid references public.evidence_files(id) on delete restrict,
  loaded_at timestamptz not null default now(),
  loaded_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'voided')),
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_token_fingerprint
  on public.central_meter_loads(token_fingerprint)
  where token_fingerprint is not null and token_fingerprint <> '';

-- ============================================================
-- RESIDENT CREDIT LEDGER
-- ============================================================

create unique index if not exists uq_submeter_opening_reading
  on public.submeter_readings(submeter_id)
  where reading_kind = 'opening';

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  resident_account_id uuid not null unique references public.resident_accounts(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  ledger_account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  resident_id uuid not null references public.profiles(id) on delete restrict,
  apartment_id uuid not null references public.apartments(id) on delete restrict,
  transaction_type public.ledger_transaction_type not null,
  units_kwh numeric(14,3) not null,
  amount numeric(14,2),
  balance_before_kwh numeric(14,3) not null,
  balance_after_kwh numeric(14,3) not null,
  source_type text not null,
  source_id uuid,
  description text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (balance_before_kwh >= 0),
  check (balance_after_kwh >= 0),
  check (
    (transaction_type in ('credit', 'opening_balance', 'adjustment') and units_kwh >= 0)
    or
    (transaction_type in ('consumption', 'reversal', 'correction') and units_kwh <> 0)
  )
);

create index if not exists idx_ledger_account_created
  on public.ledger_transactions(ledger_account_id, created_at desc);
create index if not exists idx_ledger_resident_created
  on public.ledger_transactions(resident_id, created_at desc);

-- ============================================================
-- RECONCILIATION
-- ============================================================

create table if not exists public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  meter_id uuid not null references public.meters(id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  central_balance_start_kwh numeric(14,3) not null,
  total_credits_kwh numeric(14,3) not null default 0,
  central_balance_end_kwh numeric(14,3) not null,
  central_consumption_kwh numeric(14,3) not null default 0,
  submeter_consumption_kwh numeric(14,3) not null default 0,
  variance_kwh numeric(14,3) not null default 0,
  tolerance_kwh numeric(14,3) not null default 0.01,
  status public.reconciliation_status not null default 'pending',
  classification public.reconciliation_classification,
  explanation text,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

create table if not exists public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.reconciliations(id) on delete cascade,
  apartment_id uuid not null references public.apartments(id) on delete restrict,
  submeter_id uuid not null references public.submeters(id) on delete restrict,
  opening_reading_kwh numeric(14,3) not null,
  closing_reading_kwh numeric(14,3) not null,
  consumption_kwh numeric(14,3) not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  channel public.notification_channel not null,
  event_type text not null,
  title text,
  message text not null,
  related_type text,
  related_id uuid,
  status public.notification_status not null default 'queued',
  provider_message_id text,
  provider_response jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- APPEND-ONLY AUDIT LOG
-- ============================================================

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  previous_hash text,
  event_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_property_created
  on public.audit_logs(property_id, created_at desc);
create index if not exists idx_audit_entity
  on public.audit_logs(entity_type, entity_id, created_at desc);

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

grant execute on function public.is_admin() to authenticated;

create or replace function public.is_property_admin(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_members pm
    join public.profiles p on p.id = pm.user_id
    where pm.property_id = p_property_id
      and pm.user_id = auth.uid()
      and pm.active = true
      and pm.role in ('owner_admin', 'admin')
      and p.active = true
  );
$$;

grant execute on function public.is_property_admin(uuid) to authenticated;

create or replace function public.is_property_resident(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_property_id
      and pm.user_id = auth.uid()
      and pm.active = true
      and pm.role = 'resident'
  );
$$;

grant execute on function public.is_property_resident(uuid) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- AUTOMATIC SUBMETER CONSUMPTION CALCULATION
-- ============================================================

create or replace function public.calculate_submeter_delta()
returns trigger
language plpgsql
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

create trigger trg_calculate_submeter_delta
before insert on public.submeter_readings
for each row execute function public.calculate_submeter_delta();

-- ============================================================
-- AUDIT HASHING / APPEND-ONLY PROTECTION
-- ============================================================

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Immutable record: % cannot be updated or deleted', tg_table_name;
end;
$$;

create trigger trg_ledger_immutable_update
before update or delete on public.ledger_transactions
for each row execute function public.prevent_mutation();

create trigger trg_audit_immutable_update
before update or delete on public.audit_logs
for each row execute function public.prevent_mutation();

create trigger trg_submeter_reading_immutable_update
before update or delete on public.submeter_readings
for each row execute function public.prevent_mutation();

create trigger trg_central_reading_immutable_update
before update or delete on public.central_meter_readings
for each row execute function public.prevent_mutation();

create trigger trg_central_load_immutable_update
before update or delete on public.central_meter_loads
for each row execute function public.prevent_mutation();

-- ============================================================
-- CREDIT TRANSACTION — SERVER-SIDE / ATOMIC
-- ============================================================

create or replace function public.confirm_central_meter_credit(
  p_payment_submission_id uuid,
  p_units_loaded_kwh numeric,
  p_central_balance_before_kwh numeric,
  p_central_balance_after_kwh numeric,
  p_reading_evidence_id uuid,
  p_load_evidence_id uuid default null,
  p_notes text default null
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
  v_previous_balance numeric(14,3);
  v_ledger_tx uuid;
  v_load_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can confirm a central meter credit';
  end if;

  if p_units_loaded_kwh <= 0 then
    raise exception 'Units loaded must be greater than zero';
  end if;

  if p_central_balance_before_kwh < 0 or p_central_balance_after_kwh < 0 then
    raise exception 'Central meter balances cannot be negative';
  end if;

  select * into v_payment
  from public.payment_submissions
  where id = p_payment_submission_id
  for update;

  if not found then
    raise exception 'Payment submission not found';
  end if;

  if v_payment.status in ('credited', 'duplicate') then
    raise exception 'Payment submission has already been processed';
  end if;

  if not public.is_property_admin(v_payment.property_id) then
    raise exception 'Administrator does not have access to this property';
  end if;

  select * into v_meter
  from public.meters
  where property_id = v_payment.property_id
    and meter_type = 'prepaid_main'
    and active = true
  limit 1;

  if not found then
    raise exception 'Active main prepaid meter not found';
  end if;

  if round(p_central_balance_before_kwh + p_units_loaded_kwh, 3) <> round(p_central_balance_after_kwh, 3) then
    raise exception 'Central meter reconciliation failed: before + loaded must equal after';
  end if;

  select la.* into v_account
  from public.ledger_accounts la
  join public.resident_accounts ra on ra.id = la.resident_account_id
  where ra.resident_id = v_payment.resident_id
    and ra.property_id = v_payment.property_id
    and ra.apartment_id = v_payment.apartment_id
    and ra.active = true
  for update;

  if not found then
    raise exception 'Resident ledger account not found';
  end if;

  select coalesce(lt.balance_after_kwh, 0)
    into v_previous_balance
  from public.ledger_transactions lt
  where lt.ledger_account_id = v_account.id
  order by lt.created_at desc, lt.id desc
  limit 1;

  insert into public.central_meter_loads (
    property_id, meter_id, payment_submission_id,
    units_loaded_kwh, amount_paid,
    central_balance_before_kwh, central_balance_after_kwh,
    load_evidence_id, reading_evidence_id,
    loaded_by, confirmed_at, confirmed_by, status, notes
  ) values (
    v_payment.property_id, v_meter.id, v_payment.id,
    p_units_loaded_kwh,
    coalesce((select amount from public.ocr_extractions where payment_submission_id = v_payment.id order by created_at desc limit 1), 0),
    p_central_balance_before_kwh, p_central_balance_after_kwh,
    p_load_evidence_id, p_reading_evidence_id,
    auth.uid(), now(), auth.uid(), 'confirmed', p_notes
  ) returning id into v_load_id;

  insert into public.ledger_transactions (
    ledger_account_id, property_id, resident_id, apartment_id,
    transaction_type, units_kwh, amount,
    balance_before_kwh, balance_after_kwh,
    source_type, source_id, description, created_by
  ) values (
    v_account.id, v_payment.property_id, v_payment.resident_id, v_payment.apartment_id,
    'credit', p_units_loaded_kwh,
    coalesce((select amount from public.ocr_extractions where payment_submission_id = v_payment.id order by created_at desc limit 1), 0),
    v_previous_balance, round(v_previous_balance + p_units_loaded_kwh, 3),
    'central_meter_load', v_load_id, 'Electricity credit after confirmed token loading', auth.uid()
  ) returning id into v_ledger_tx;

  update public.payment_submissions
    set status = 'credited', reviewed_at = now(), reviewed_by = auth.uid()
  where id = v_payment.id;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id,
    old_data, new_data, metadata
  ) values (
    v_payment.property_id, auth.uid(), 'RESIDENT_CREDITED', 'ledger_transaction', v_ledger_tx,
    jsonb_build_object('balance_kwh', v_previous_balance),
    jsonb_build_object('balance_kwh', round(v_previous_balance + p_units_loaded_kwh, 3), 'units_kwh', p_units_loaded_kwh),
    jsonb_build_object('payment_submission_id', v_payment.id, 'central_meter_load_id', v_load_id)
  );

  return v_ledger_tx;
end;
$$;

grant execute on function public.confirm_central_meter_credit(uuid,numeric,numeric,numeric,uuid,uuid,text) to authenticated;

-- ============================================================
-- RECORD CONSUMPTION — SERVER-SIDE / ATOMIC
-- ============================================================

create or replace function public.post_confirmed_submeter_consumption(
  p_submeter_reading_id uuid
)
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
  v_previous_balance numeric(14,3);
  v_tx uuid;
  v_consumption numeric(14,3);
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can post submeter consumption';
  end if;

  select * into v_reading
  from public.submeter_readings
  where id = p_submeter_reading_id;

  if not found then raise exception 'Submeter reading not found'; end if;
  if v_reading.confirmed_at is null then raise exception 'Submeter reading must be confirmed first'; end if;

  v_consumption := coalesce(v_reading.units_consumed_kwh, 0);

  select * into v_submeter from public.submeters where id = v_reading.submeter_id;
  select * into v_apartment from public.apartments where id = v_submeter.apartment_id;
  select * into v_resident
  from public.resident_accounts
  where apartment_id = v_apartment.id and active = true
  limit 1;

  if not found then raise exception 'No active resident account found for apartment'; end if;

  select * into v_account from public.ledger_accounts where resident_account_id = v_resident.id for update;
  if not found then raise exception 'Resident ledger account not found'; end if;

  if exists (
    select 1 from public.ledger_transactions
    where source_type = 'submeter_reading' and source_id = p_submeter_reading_id
  ) then
    raise exception 'Consumption for this reading has already been posted';
  end if;

  select coalesce(balance_after_kwh, 0) into v_previous_balance
  from public.ledger_transactions
  where ledger_account_id = v_account.id
  order by created_at desc, id desc
  limit 1;

  if v_consumption > v_previous_balance then
    raise exception 'Insufficient resident credit for recorded consumption. Balance: %, consumption: %', v_previous_balance, v_consumption;
  end if;

  insert into public.ledger_transactions (
    ledger_account_id, property_id, resident_id, apartment_id,
    transaction_type, units_kwh, amount,
    balance_before_kwh, balance_after_kwh,
    source_type, source_id, description, created_by
  ) values (
    v_account.id, v_apartment.property_id, v_resident.resident_id, v_apartment.id,
    'consumption', -v_consumption, null,
    v_previous_balance, round(v_previous_balance - v_consumption, 3),
    'submeter_reading', p_submeter_reading_id, 'Consumption calculated from confirmed submeter reading', auth.uid()
  ) returning id into v_tx;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id,
    new_data
  ) values (
    v_apartment.property_id, auth.uid(), 'CONSUMPTION_RECORDED', 'ledger_transaction', v_tx,
    jsonb_build_object('consumption_kwh', v_consumption, 'submeter_reading_id', p_submeter_reading_id)
  );

  return v_tx;
end;
$$;

grant execute on function public.post_confirmed_submeter_consumption(uuid) to authenticated;

-- ============================================================
-- PROFILE CREATION TRIGGER
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1), 'User'),
    new.phone,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();

drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at before update on public.properties for each row execute function public.touch_updated_at();

drop trigger if exists trg_apartments_updated_at on public.apartments;
create trigger trg_apartments_updated_at before update on public.apartments for each row execute function public.touch_updated_at();

drop trigger if exists trg_resident_accounts_updated_at on public.resident_accounts;
create trigger trg_resident_accounts_updated_at before update on public.resident_accounts for each row execute function public.touch_updated_at();

drop trigger if exists trg_meters_updated_at on public.meters;
create trigger trg_meters_updated_at before update on public.meters for each row execute function public.touch_updated_at();

drop trigger if exists trg_submeters_updated_at on public.submeters;
create trigger trg_submeters_updated_at before update on public.submeters for each row execute function public.touch_updated_at();

drop trigger if exists trg_payment_submissions_updated_at on public.payment_submissions;
create trigger trg_payment_submissions_updated_at before update on public.payment_submissions for each row execute function public.touch_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_property_members_user on public.property_members(user_id, property_id);
create index if not exists idx_apartments_property on public.apartments(property_id);
create index if not exists idx_resident_accounts_property on public.resident_accounts(property_id, apartment_id);
create index if not exists idx_meters_property on public.meters(property_id);
create index if not exists idx_submeters_apartment on public.submeters(apartment_id);
create index if not exists idx_central_readings_meter_time on public.central_meter_readings(meter_id, captured_at desc);
create index if not exists idx_submeter_readings_meter_time on public.submeter_readings(submeter_id, captured_at desc);
create index if not exists idx_payment_property_status on public.payment_submissions(property_id, status, submitted_at desc);
create index if not exists idx_payment_resident on public.payment_submissions(resident_id, submitted_at desc);
create index if not exists idx_ocr_payment on public.ocr_extractions(payment_submission_id, created_at desc);
create index if not exists idx_central_load_property on public.central_meter_loads(property_id, loaded_at desc);
create index if not exists idx_notifications_recipient on public.notifications(recipient_id, created_at desc);