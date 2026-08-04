begin;

lock table public."Shipment" in share row exclusive mode;

create temporary table shipment_status_repair on commit drop as
select
  shipment.id,
  shipment.shipment_number,
  coalesce(nullif(btrim(shipment.status), ''), 'SIN ESTADO') as previous_status,
  case
    when upper(btrim(coalesce(shipment.status, ''))) = 'CANCELADO' then 'CANCELADO'
    when upper(btrim(coalesce(shipment.status, ''))) in ('ENTREGADO', 'FINALIZADO') then 'ENTREGADO'
    when shipment.date_arrived::date < (current_timestamp at time zone 'America/New_York')::date then 'ENTREGADO'
    when shipment.date_arrived::date = (current_timestamp at time zone 'America/New_York')::date then 'EN BSAS'
    when upper(btrim(coalesce(shipment.status, ''))) = 'MIAMI' then 'MIAMI'
    when upper(btrim(coalesce(shipment.status, ''))) in ('SALIENDO', 'SALIENDO MIAMI') then 'SALIENDO'
    when upper(btrim(coalesce(shipment.status, ''))) in ('LLEGANDO', 'EN TRANSITO', 'EN_TRANSITO') then 'LLEGANDO'
    when upper(btrim(coalesce(shipment.status, ''))) in ('EN BSAS', 'EN 🇦🇷', 'RECIBIDO BSAS', 'ARRIBADO') then 'EN BSAS'
    when shipment.date_arrived is not null then 'LLEGANDO'
    when shipment.date_shipped::date <= (current_timestamp at time zone 'America/New_York')::date then 'SALIENDO'
    else 'MIAMI'
  end as next_status
from public."Shipment" shipment;

delete from shipment_status_repair
where previous_status = next_status;

do $$
declare
  repair_operation_id uuid := gen_random_uuid();
begin
  insert into public.shipment_status_change_log (
    operation_id,
    shipment_id,
    shipment_number,
    actor_name,
    selected_date,
    from_status,
    to_status,
    event_type,
    details
  )
  select
    repair_operation_id,
    repair.id,
    coalesce(repair.shipment_number, -repair.id),
    'Migracion de integridad',
    (current_timestamp at time zone 'America/New_York')::date,
    repair.previous_status,
    repair.next_status,
    'SYSTEM_UPDATED',
    jsonb_build_object(
      'reason', 'Estado logistico obligatorio y entrega como maximo al dia siguiente de la llegada real.',
      'repair', '20260804231904_enforce_shipment_lifecycle_status',
      'shipment_number_missing', repair.shipment_number is null
    )
  from shipment_status_repair repair;

  update public."Shipment" shipment
  set status = repair.next_status
  from shipment_status_repair repair
  where shipment.id = repair.id;
end;
$$;

alter table public."Shipment"
  drop constraint if exists shipment_status_not_comprar;

alter table public."Shipment"
  alter column status set not null;

alter table public."Shipment"
  add constraint shipment_status_valid_lifecycle
  check (upper(btrim(status)) in ('MIAMI', 'SALIENDO', 'LLEGANDO', 'EN BSAS', 'ENTREGADO', 'CANCELADO'));

comment on constraint shipment_status_valid_lifecycle on public."Shipment" is
  'Shipment always has a canonical logistics state; order-only COMPRAR and blank states are forbidden.';

commit;
