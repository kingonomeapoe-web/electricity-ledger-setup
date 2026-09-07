create or replace function public.log_ocr_event(
  p_payment_submission_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.payment_submissions%rowtype;
begin
  select * into v_submission
  from public.payment_submissions
  where id = p_payment_submission_id
    and resident_id = auth.uid();

  if not found then
    raise exception 'Payment submission not found or not owned by caller';
  end if;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_submission.property_id, auth.uid(), p_event_type,
    'payment_submission', p_payment_submission_id, p_metadata
  );
end;
$$;

grant execute on function public.log_ocr_event(uuid, text, jsonb) to authenticated;


create or replace function public.log_ocr_failure(
  p_payment_submission_id uuid,
  p_evidence_id uuid,
  p_error_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.payment_submissions%rowtype;
begin
  select * into v_submission
  from public.payment_submissions
  where id = p_payment_submission_id
    and resident_id = auth.uid();

  if not found then
    raise exception 'Payment submission not found or not owned by caller';
  end if;

  insert into public.ocr_extractions (
    evidence_id,
    payment_submission_id,
    status,
    provider,
    model,
    error_message,
    structured_data,
    field_confidence,
    processed_at
  ) values (
    p_evidence_id,
    p_payment_submission_id,
    'failed',
    'lovable-ai',
    'google/gemini-2.5-flash',
    p_error_message,
    '{}'::jsonb,
    '{}'::jsonb,
    now()
  );

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_submission.property_id, auth.uid(), 'OCR_FAILED',
    'payment_submission', p_payment_submission_id, p_metadata
  );
end;
$$;

grant execute on function public.log_ocr_failure(uuid, uuid, text, jsonb) to authenticated;


create or replace function public.process_receipt_ocr(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_id uuid := (p_payload->>'payment_submission_id')::uuid;
  v_submission public.payment_submissions%rowtype;
  v_ocr_id uuid;
  v_confidence numeric(5,2);
begin
  select * into v_submission
  from public.payment_submissions
  where id = v_submission_id
    and resident_id = auth.uid();

  if not found then
    raise exception 'Payment submission not found or not owned by caller';
  end if;

  v_confidence := (p_payload->>'confidence')::numeric;
  if v_confidence is not null then
    v_confidence := greatest(0, least(100, v_confidence));
  end if;

  insert into public.ocr_extractions (
    evidence_id,
    payment_submission_id,
    status,
    provider,
    model,
    raw_text,
    structured_data,
    amount,
    amount_paid,
    units_kwh,
    meter_number,
    beneficiary_id,
    token_ciphertext,
    token_last4,
    transaction_reference,
    transaction_number,
    session_id,
    customer_name,
    service_address,
    transaction_date,
    transaction_time,
    tariff_class,
    tariff_rate,
    confidence,
    field_confidence,
    processed_at
  ) values (
    (p_payload->>'evidence_id')::uuid,
    v_submission_id,
    (p_payload->>'status')::public.ocr_status,
    p_payload->>'provider',
    p_payload->>'model',
    p_payload->>'raw_text',
    coalesce(p_payload->'structured_data', '{}'::jsonb),
    (p_payload->>'amount')::numeric,
    (p_payload->>'amount_paid')::numeric,
    (p_payload->>'units_kwh')::numeric,
    p_payload->>'meter_number',
    p_payload->>'beneficiary_id',
    p_payload->>'token_ciphertext',
    p_payload->>'token_last4',
    p_payload->>'transaction_reference',
    p_payload->>'transaction_number',
    p_payload->>'session_id',
    p_payload->>'customer_name',
    p_payload->>'service_address',
    (p_payload->>'transaction_date')::date,
    (p_payload->>'transaction_time')::timestamptz,
    p_payload->>'tariff_class',
    (p_payload->>'tariff_rate')::numeric,
    v_confidence,
    coalesce(p_payload->'field_confidence', '{}'::jsonb),
    (p_payload->>'processed_at')::timestamptz
  ) returning id into v_ocr_id;

  if v_submission.status in ('uploaded', 'ocr_processed') then
    update public.payment_submissions
    set status = 'pending_approval',
        updated_at = now()
    where id = v_submission_id;
  end if;

  insert into public.audit_logs (
    property_id, actor_id, event_type, entity_type, entity_id,
    old_data, new_data, metadata
  ) values (
    v_submission.property_id, auth.uid(), 'OCR_COMPLETED',
    'payment_submission', v_submission_id,
    jsonb_build_object('status', v_submission.status),
    jsonb_build_object('status', 'pending_approval', 'ocr_extraction_id', v_ocr_id),
    coalesce(p_payload->'metadata', '{}'::jsonb)
  );

  return v_ocr_id;
end;
$$;

grant execute on function public.process_receipt_ocr(jsonb) to authenticated;