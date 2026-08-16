-- Forward-only hardening after production readback of the first V2 migration.
-- Resolve supplier offers only when an exact supplier identifier maps to one
-- and only one internal product. The application never receives raw text or
-- supplier identity.
CREATE OR REPLACE VIEW company_os_source.supplier_availability AS
WITH normalized_items AS (
  SELECT
    oi.id,
    oi.offer_id,
    oi.capacity,
    oi.color,
    oi.condition,
    oi.quantity,
    oi.unit_price,
    oi.currency,
    oi.confidence,
    trim(regexp_replace(
      lower(concat_ws(' ', oi.brand, oi.product, oi.model, oi.capacity, oi.color, oi.condition)),
      '[^a-z0-9]+',
      ' ',
      'g'
    )) AS normalized_item,
    trim(regexp_replace(lower(COALESCE(oi.raw_match, '')), '[^a-z0-9]+', ' ', 'g')) AS normalized_raw_match
  FROM public.wa_offer_items AS oi
), normalized_mappings AS (
  SELECT
    sp."ourProductId" AS product_id,
    trim(regexp_replace(lower(COALESCE(sp."supplierSku", '')), '[^a-z0-9]+', ' ', 'g')) AS supplier_sku,
    trim(regexp_replace(lower(COALESCE(sp."supplierName", '')), '[^a-z0-9]+', ' ', 'g')) AS supplier_name
  FROM public."SupplierProduct" AS sp
  WHERE sp."ourProductId" IS NOT NULL
), candidate_matches AS (
  SELECT ni.id AS item_id, nm.product_id
  FROM normalized_items AS ni
  JOIN normalized_mappings AS nm
    ON (
      length(nm.supplier_sku) >= 4
      AND (
        (' ' || ni.normalized_item || ' ') LIKE ('% ' || nm.supplier_sku || ' %')
        OR (' ' || ni.normalized_raw_match || ' ') LIKE ('% ' || nm.supplier_sku || ' %')
      )
    )
    OR (
      length(nm.supplier_name) >= 8
      AND (
        ni.normalized_item = nm.supplier_name
        OR ni.normalized_raw_match = nm.supplier_name
      )
    )
), resolved_matches AS (
  SELECT item_id, min(product_id) AS product_id
  FROM candidate_matches
  GROUP BY item_id
  HAVING count(DISTINCT product_id) = 1
)
SELECT
  p.id AS product_id,
  p.sku,
  p.model,
  ni.capacity,
  ni.color,
  ni.condition,
  ni.quantity,
  ni.unit_price,
  ni.currency,
  LEAST(ni.confidence, o.confidence) AS confidence,
  o.offered_at,
  o.needs_review
FROM normalized_items AS ni
JOIN resolved_matches AS rm ON rm.item_id = ni.id
JOIN public.wa_offers AS o ON o.id = ni.offer_id
JOIN public."Product" AS p ON p.id = rm.product_id;

REVOKE ALL ON TABLE company_os_source.supplier_availability FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'company_os_reader') THEN
    GRANT SELECT ON TABLE company_os_source.supplier_availability TO company_os_reader;
  END IF;
END
$$;

-- Enforce the chain head inside PostgreSQL as well as in the API transaction.
-- A direct INSERT cannot fork the sequence, invent a previous hash, or claim a
-- fromStatus different from the persisted mission projection.
CREATE OR REPLACE FUNCTION public.validate_company_agent_mission_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  latest_sequence integer;
  latest_hash text;
  latest_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('company-os-mission:' || NEW."missionId", 0));

  SELECT e."sequence", e."eventHash", e."toStatus"
    INTO latest_sequence, latest_hash, latest_status
  FROM public."CompanyAgentMissionEvent" AS e
  WHERE e."missionId" = NEW."missionId"
  ORDER BY e."sequence" DESC
  LIMIT 1;

  IF FOUND THEN
    IF NEW."sequence" <> latest_sequence + 1
      OR NEW."expectedHead" <> latest_sequence
      OR NEW."previousHash" IS DISTINCT FROM latest_hash
      OR NEW."fromStatus" IS DISTINCT FROM latest_status THEN
      RAISE EXCEPTION 'invalid CompanyAgentMissionEvent chain head' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT m.status INTO latest_status
    FROM public."CompanyAgentMission" AS m
    WHERE m.id = NEW."missionId";

    IF NOT FOUND
      OR NEW."sequence" <> 1
      OR NEW."expectedHead" <> 0
      OR NEW."previousHash" IS NOT NULL
      OR NEW."fromStatus" IS DISTINCT FROM latest_status THEN
      RAISE EXCEPTION 'invalid first CompanyAgentMissionEvent' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.validate_company_agent_mission_event_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER "CompanyAgentMissionEvent_validate_chain"
BEFORE INSERT ON public."CompanyAgentMissionEvent"
FOR EACH ROW EXECUTE FUNCTION public.validate_company_agent_mission_event_insert();
