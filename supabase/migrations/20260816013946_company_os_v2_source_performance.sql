-- Availability older than 24 hours is never actionable. Filter it before
-- normalizing or mapping offer items so the live view cannot scan historical
-- WhatsApp offers during a Manager request.
CREATE OR REPLACE VIEW company_os_source.supplier_availability AS
WITH normalized_items AS (
  SELECT
    oi.id,
    oi.capacity,
    oi.color,
    oi.condition,
    oi.quantity,
    oi.unit_price,
    oi.currency,
    oi.confidence,
    o.confidence AS offer_confidence,
    o.offered_at,
    o.needs_review,
    trim(regexp_replace(
      lower(concat_ws(' ', oi.brand, oi.product, oi.model, oi.capacity, oi.color, oi.condition)),
      '[^a-z0-9]+',
      ' ',
      'g'
    )) AS normalized_item,
    trim(regexp_replace(lower(COALESCE(oi.raw_match, '')), '[^a-z0-9]+', ' ', 'g')) AS normalized_raw_match
  FROM public.wa_offers AS o
  JOIN public.wa_offer_items AS oi ON oi.offer_id = o.id
  WHERE o.offered_at >= now() - interval '24 hours'
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
  LEAST(ni.confidence, ni.offer_confidence) AS confidence,
  ni.offered_at,
  ni.needs_review
FROM normalized_items AS ni
JOIN resolved_matches AS rm ON rm.item_id = ni.id
JOIN public."Product" AS p ON p.id = rm.product_id;

REVOKE ALL ON TABLE company_os_source.supplier_availability FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'company_os_reader') THEN
    GRANT SELECT ON TABLE company_os_source.supplier_availability TO company_os_reader;
  END IF;
END
$$;
