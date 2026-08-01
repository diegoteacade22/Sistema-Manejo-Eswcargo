create or replace function public.prevent_shipment_status_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'shipment_status_change_log is append-only';
end;
$$;

drop trigger if exists shipment_status_change_log_no_update_delete
  on public.shipment_status_change_log;

create trigger shipment_status_change_log_no_update_delete
before update or delete on public.shipment_status_change_log
for each row execute function public.prevent_shipment_status_audit_mutation();

drop trigger if exists shipment_status_change_log_no_truncate
  on public.shipment_status_change_log;

create trigger shipment_status_change_log_no_truncate
before truncate on public.shipment_status_change_log
for each statement execute function public.prevent_shipment_status_audit_mutation();

revoke all on function public.prevent_shipment_status_audit_mutation() from public;
