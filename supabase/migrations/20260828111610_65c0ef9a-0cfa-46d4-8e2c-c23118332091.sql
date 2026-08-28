-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_members enable row level security;
alter table public.apartments enable row level security;
alter table public.resident_accounts enable row level security;
alter table public.meters enable row level security;
alter table public.submeters enable row level security;
alter table public.central_meter_readings enable row level security;
alter table public.submeter_readings enable row level security;
alter table public.evidence_files enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.ocr_extractions enable row level security;
alter table public.central_meter_loads enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.reconciliations enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users see themselves; admins see profiles belonging to their properties.
create policy profiles_select_self on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_admin_manage on public.profiles
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Property
create policy properties_select on public.properties
for select to authenticated
using (public.is_property_admin(id) or public.is_property_resident(id));

create policy properties_admin_insert on public.properties
for insert to authenticated
with check (public.is_admin());

create policy properties_admin_update on public.properties
for update to authenticated
using (public.is_property_admin(id))
with check (public.is_property_admin(id));

-- Property members
create policy property_members_select on public.property_members
for select to authenticated
using (user_id = auth.uid() or public.is_property_admin(property_id));

create policy property_members_admin_manage on public.property_members
for all to authenticated
using (public.is_property_admin(property_id))
with check (public.is_property_admin(property_id));

-- Apartments
create policy apartments_select on public.apartments
for select to authenticated
using (public.is_property_admin(property_id) or public.is_property_resident(property_id));

create policy apartments_admin_manage on public.apartments
for all to authenticated
using (public.is_property_admin(property_id))
with check (public.is_property_admin(property_id));

-- Resident accounts
create policy resident_accounts_select on public.resident_accounts
for select to authenticated
using (resident_id = auth.uid() or public.is_property_admin(property_id));

create policy resident_accounts_admin_manage on public.resident_accounts
for all to authenticated
using (public.is_property_admin(property_id))
with check (public.is_property_admin(property_id));

-- Meters
create policy meters_select on public.meters
for select to authenticated
using (public.is_property_admin(property_id) or public.is_property_resident(property_id));

create policy meters_admin_manage on public.meters
for all to authenticated
using (public.is_property_admin(property_id))
with check (public.is_property_admin(property_id));

-- Submeters
create policy submeters_select on public.submeters
for select to authenticated
using (
  exists (
    select 1 from public.apartments a
    where a.id = apartment_id
      and (public.is_property_admin(a.property_id) or exists (
        select 1 from public.resident_accounts ra
        where ra.apartment_id = a.id and ra.resident_id = auth.uid() and ra.active = true
      ))
  )
);

create policy submeters_admin_manage on public.submeters
for all to authenticated
using (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_property_admin(a.property_id)))
with check (exists (select 1 from public.apartments a where a.id = apartment_id and public.is_property_admin(a.property_id)));

-- Central readings: residents may see only property-level current readings; admins manage.
create policy central_readings_select on public.central_meter_readings
for select to authenticated
using (
  exists (select 1 from public.meters m where m.id = meter_id and (public.is_property_admin(m.property_id) or public.is_property_resident(m.property_id)))
);

create policy central_readings_admin_insert on public.central_meter_readings
for insert to authenticated
with check (exists (select 1 from public.meters m where m.id = meter_id and public.is_property_admin(m.property_id)));

-- Submeter readings: resident can see own apartment; only admin can insert.
create policy submeter_readings_select on public.submeter_readings
for select to authenticated
using (
  exists (
    select 1 from public.submeters sm
    join public.apartments a on a.id = sm.apartment_id
    where sm.id = submeter_id
      and (public.is_property_admin(a.property_id) or exists (
        select 1 from public.resident_accounts ra
        where ra.apartment_id = a.id and ra.resident_id = auth.uid() and ra.active = true
      ))
  )
);

create policy submeter_readings_admin_insert on public.submeter_readings
for insert to authenticated
with check (
  exists (
    select 1 from public.submeters sm
    join public.apartments a on a.id = sm.apartment_id
    where sm.id = submeter_id and public.is_property_admin(a.property_id)
  )
);

-- Evidence: resident may insert own payment evidence; admin may insert/read property evidence.
create policy evidence_select on public.evidence_files
for select to authenticated
using (uploaded_by = auth.uid() or public.is_property_admin(property_id));

create policy evidence_insert_resident_or_admin on public.evidence_files
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    public.is_property_admin(property_id)
    or (public.is_property_resident(property_id) and evidence_type = 'payment_receipt')
  )
);

-- Payment submissions
create policy payment_submissions_select on public.payment_submissions
for select to authenticated
using (resident_id = auth.uid() or public.is_property_admin(property_id));

create policy payment_submissions_resident_insert on public.payment_submissions
for insert to authenticated
with check (
  resident_id = auth.uid()
  and public.is_property_resident(property_id)
);

create policy payment_submissions_admin_update on public.payment_submissions
for update to authenticated
using (public.is_property_admin(property_id))
with check (public.is_property_admin(property_id));

-- OCR: residents may see OCR for their own submission; admins see all property OCR.
create policy ocr_select on public.ocr_extractions
for select to authenticated
using (
  exists (
    select 1 from public.payment_submissions ps
    where ps.id = payment_submission_id
      and (ps.resident_id = auth.uid() or public.is_property_admin(ps.property_id))
  )
);

create policy ocr_admin_insert on public.ocr_extractions
for insert to authenticated
with check (
  exists (
    select 1 from public.payment_submissions ps
    where ps.id = payment_submission_id and public.is_property_admin(ps.property_id)
  )
);

-- Central loads: admin only.
create policy central_loads_admin_select on public.central_meter_loads
for select to authenticated
using (public.is_property_admin(property_id));

-- Ledger account: resident sees own; admin sees property.
create policy ledger_accounts_select on public.ledger_accounts
for select to authenticated
using (
  exists (
    select 1 from public.resident_accounts ra
    where ra.id = resident_account_id
      and (ra.resident_id = auth.uid() or public.is_property_admin(ra.property_id))
  )
);

-- Ledger transactions are SELECT-only to authenticated clients. Inserts happen via SECURITY DEFINER functions.
create policy ledger_transactions_select on public.ledger_transactions
for select to authenticated
using (resident_id = auth.uid() or public.is_property_admin(property_id));

-- No client INSERT/UPDATE/DELETE policies for immutable ledger.

-- Reconciliation admin only, resident may view property-level result if desired.
create policy reconciliations_select on public.reconciliations
for select to authenticated
using (public.is_property_admin(property_id) or public.is_property_resident(property_id));

create policy reconciliations_admin_manage on public.reconciliations
for all to authenticated
using (public.is_property_admin(property_id))
with check (public.is_property_admin(property_id));

create policy reconciliation_items_select on public.reconciliation_items
for select to authenticated
using (
  exists (
    select 1 from public.reconciliations r
    where r.id = reconciliation_id
      and (public.is_property_admin(r.property_id) or public.is_property_resident(r.property_id))
  )
);

create policy reconciliation_items_admin_manage on public.reconciliation_items
for all to authenticated
using (exists (select 1 from public.reconciliations r where r.id = reconciliation_id and public.is_property_admin(r.property_id)))
with check (exists (select 1 from public.reconciliations r where r.id = reconciliation_id and public.is_property_admin(r.property_id)));

-- Notifications: recipient sees own; admins can see property notifications.
create policy notifications_select on public.notifications
for select to authenticated
using (recipient_id = auth.uid() or (property_id is not null and public.is_property_admin(property_id)));

create policy notifications_admin_insert on public.notifications
for insert to authenticated
with check (recipient_id = auth.uid() or (property_id is not null and public.is_property_admin(property_id)));

-- Audit: read-only. No direct client insert; server functions/triggers should write it.
create policy audit_select on public.audit_logs
for select to authenticated
using (actor_id = auth.uid() or (property_id is not null and public.is_property_admin(property_id)));

-- ============================================================
-- STORAGE OBJECT POLICIES (private evidence bucket)
-- ============================================================

create policy storage_electricity_evidence_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'electricity-evidence'
  and (storage.foldername(name))[1] in (
    select p.id::text from public.properties p
    where public.is_property_admin(p.id) or public.is_property_resident(p.id)
  )
);

create policy storage_electricity_evidence_select
on storage.objects for select to authenticated
using (
  bucket_id = 'electricity-evidence'
  and (storage.foldername(name))[1] in (
    select p.id::text from public.properties p
    where public.is_property_admin(p.id) or public.is_property_resident(p.id)
  )
);

-- ============================================================
-- TABLE GRANTS (required for Data API access)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_members TO authenticated;
GRANT ALL ON public.property_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apartments TO authenticated;
GRANT ALL ON public.apartments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident_accounts TO authenticated;
GRANT ALL ON public.resident_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meters TO authenticated;
GRANT ALL ON public.meters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submeters TO authenticated;
GRANT ALL ON public.submeters TO service_role;
GRANT SELECT, INSERT ON public.central_meter_readings TO authenticated;
GRANT ALL ON public.central_meter_readings TO service_role;
GRANT SELECT, INSERT ON public.submeter_readings TO authenticated;
GRANT ALL ON public.submeter_readings TO service_role;
GRANT SELECT, INSERT ON public.evidence_files TO authenticated;
GRANT ALL ON public.evidence_files TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_submissions TO authenticated;
GRANT ALL ON public.payment_submissions TO service_role;
GRANT SELECT, INSERT ON public.ocr_extractions TO authenticated;
GRANT ALL ON public.ocr_extractions TO service_role;
GRANT SELECT ON public.central_meter_loads TO authenticated;
GRANT ALL ON public.central_meter_loads TO service_role;
GRANT SELECT, INSERT ON public.ledger_accounts TO authenticated;
GRANT ALL ON public.ledger_accounts TO service_role;
GRANT SELECT ON public.ledger_transactions TO authenticated;
GRANT ALL ON public.ledger_transactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliations TO authenticated;
GRANT ALL ON public.reconciliations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_items TO authenticated;
GRANT ALL ON public.reconciliation_items TO service_role;
GRANT SELECT, INSERT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;