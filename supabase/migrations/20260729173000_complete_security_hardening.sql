-- Security hardening after the 2026-07-29 credential incident.

alter function public.eswtech_contact_detail(text)
  set search_path = pg_catalog, public, crm;
alter function public.eswtech_contact_source_records(text)
  set search_path = pg_catalog, public, crm;
alter function public.eswtech_sales_by_client_product(text, text)
  set search_path = pg_catalog, public, crm;
alter function public.eswtech_sales_by_dedupe_key(text)
  set search_path = pg_catalog, public, crm;
alter function public.set_wasa_updated_at()
  set search_path = pg_catalog, public, crm;
alter function public.validate_account_evidence_transaction_client()
  set search_path = pg_catalog, public, crm;
alter function public.wa_touch_conversation()
  set search_path = pg_catalog, public, crm;
alter function crm.sales_by_client_product(text, text)
  set search_path = pg_catalog, crm, public;

drop policy if exists "Fotos públicas" on storage.objects;
drop policy if exists "Subir fotos" on storage.objects;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'shipment-photos';

revoke all privileges on table
  public.eswcargo_users_web,
  public.eswtech_crm_contact_geo,
  public.google_contacts_csv,
  public.google_contacts_raw,
  public.wa_conversations,
  public.wa_import_jobs,
  public.wa_message_attachments,
  public.wa_messages,
  public.wasa_attribution_clicks,
  public.wasa_bot_logs,
  public.wasa_leads,
  public.wasa_messages,
  public.wasa_templates
from anon, authenticated;

revoke execute on function public.set_wasa_updated_at()
  from public, anon, authenticated;
revoke execute on function public.validate_account_evidence_transaction_client()
  from public, anon, authenticated;
revoke execute on function public.wa_touch_conversation()
  from public, anon, authenticated;

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
