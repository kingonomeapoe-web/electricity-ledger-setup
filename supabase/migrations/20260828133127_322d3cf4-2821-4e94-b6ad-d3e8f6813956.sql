-- 1. Audit event recording (audit_logs is insert-denied to clients by design)
create or replace function public.log_admin_audit(
  p_property_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_old_data jsonb default null,
  p_new_data jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_property_id is null or not public.is_property_admin(p_property_id) then
    raise exception 'Only an administrator of this property can record audit events';
  end if;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id,
    old_data, new_data, metadata
  ) values (
    p_property_id, auth.uid(), p_event_type, p_entity_type, p_entity_id,
    p_old_data, p_new_data, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$$;

-- 2. Audited ledger adjustment / correction (never mutates history)
create or replace function public.create_ledger_adjustment(
  p_resident_id uuid,
  p_property_id uuid,
  p_units_kwh numeric,
  p_reason text,
  p_explanation text,
  p_transaction_type ledger_transaction_type default 'adjustment',
  p_original_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.resident_accounts%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_previous numeric(14,3);
  v_tx uuid;
begin
  if not public.is_property_admin(p_property_id) then
    raise exception 'Only an administrator of this property can post an adjustment';
  end if;

  if p_transaction_type not in ('adjustment', 'correction', 'reversal') then
    raise exception 'Only adjustment, correction or reversal entries may be posted here';
  end if;

  if p_units_kwh is null or p_units_kwh = 0 then
    raise exception 'Adjustment units must be non-zero';
  end if;

  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_explanation), '') = '' then
    raise exception 'A reason and an explanation are required for every adjustment';
  end if;

  select * into v_resident
  from public.resident_accounts
  where resident_id = p_resident_id
    and property_id = p_property_id
    and active = true
  limit 1;

  if not found then
    raise exception 'Active resident account not found for this property';
  end if;

  select * into v_account
  from public.ledger_accounts
  where resident_account_id = v_resident.id
  for update;

  if not found then
    raise exception 'Resident ledger account not found';
  end if;

  select coalesce(balance_after_kwh, 0) into v_previous
  from public.ledger_transactions
  where ledger_account_id = v_account.id
  order by created_at desc, id desc
  limit 1;

  v_previous := coalesce(v_previous, 0);

  if round(v_previous + p_units_kwh, 3) < 0 then
    raise exception 'Adjustment would drive the resident balance negative. Balance: %, adjustment: %', v_previous, p_units_kwh;
  end if;

  insert into public.ledger_transactions (
    ledger_account_id, property_id, resident_id, apartment_id,
    transaction_type, units_kwh, amount,
    balance_before_kwh, balance_after_kwh,
    source_type, source_id, description, created_by
  ) values (
    v_account.id, p_property_id, p_resident_id, v_resident.apartment_id,
    p_transaction_type, p_units_kwh, null,
    v_previous, round(v_previous + p_units_kwh, 3),
    'admin_adjustment', p_original_transaction_id,
    btrim(p_reason) || ': ' || btrim(p_explanation), auth.uid()
  ) returning id into v_tx;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id,
    old_data, new_data, metadata
  ) values (
    p_property_id, auth.uid(), 'LEDGER_ADJUSTMENT_POSTED', 'ledger_transaction', v_tx,
    jsonb_build_object('balance_kwh', v_previous),
    jsonb_build_object('balance_kwh', round(v_previous + p_units_kwh, 3), 'units_kwh', p_units_kwh),
    jsonb_build_object(
      'reason', btrim(p_reason),
      'explanation', btrim(p_explanation),
      'transaction_type', p_transaction_type,
      'original_transaction_id', p_original_transaction_id,
      'new_transaction_id', v_tx,
      'resident_id', p_resident_id
    )
  );

  return v_tx;
end;
$$;

-- 3. Reconciliation variance classification (explanation mandatory)
create or replace function public.classify_reconciliation_variance(
  p_reconciliation_id uuid,
  p_classification reconciliation_classification,
  p_explanation text,
  p_status reconciliation_status default 'reviewed'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.reconciliations%rowtype;
begin
  select * into v_rec from public.reconciliations where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;

  if not public.is_property_admin(v_rec.property_id) then
    raise exception 'Only an administrator of this property can classify a variance';
  end if;

  if coalesce(btrim(p_explanation), '') = '' then
    raise exception 'An explanation is required when classifying a variance';
  end if;

  update public.reconciliations
     set classification = p_classification,
         explanation = btrim(p_explanation),
         status = p_status,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_reconciliation_id;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id,
    old_data, new_data, metadata
  ) values (
    v_rec.property_id, auth.uid(), 'RECONCILIATION_CLASSIFIED', 'reconciliation', p_reconciliation_id,
    jsonb_build_object('status', v_rec.status, 'classification', v_rec.classification, 'explanation', v_rec.explanation),
    jsonb_build_object('status', p_status, 'classification', p_classification, 'explanation', btrim(p_explanation)),
    jsonb_build_object('variance_kwh', v_rec.variance_kwh, 'tolerance_kwh', v_rec.tolerance_kwh)
  );

  return p_reconciliation_id;
end;
$$;

revoke all on function public.log_admin_audit(uuid, text, text, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.create_ledger_adjustment(uuid, uuid, numeric, text, text, ledger_transaction_type, uuid) from public, anon;
revoke all on function public.classify_reconciliation_variance(uuid, reconciliation_classification, text, reconciliation_status) from public, anon;

grant execute on function public.log_admin_audit(uuid, text, text, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.create_ledger_adjustment(uuid, uuid, numeric, text, text, ledger_transaction_type, uuid) to authenticated;
grant execute on function public.classify_reconciliation_variance(uuid, reconciliation_classification, text, reconciliation_status) to authenticated;