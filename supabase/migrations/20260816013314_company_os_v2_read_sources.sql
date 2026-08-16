-- Company OS V2 reads the minimum operational detail needed for management
-- calibration. Business tables remain read-only and CRM text/PII is not
-- exposed to the application role.

CREATE SCHEMA IF NOT EXISTS company_os_source;
REVOKE ALL ON SCHEMA company_os_source FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW company_os_source.recent_product_inquiries AS
WITH normalized_messages AS (
  SELECT
    m.id,
    COALESCE(m.timestamp_utc, m.message_at) AS message_at,
    trim(regexp_replace(lower(COALESCE(m.text_normalized, m.body_normalized, m.body, '')), '[^a-z0-9]+', ' ', 'g')) AS normalized_text
  FROM public.wa_messages AS m
  JOIN public.wa_chats AS c
    ON c.id = m.chat_id
   AND c.account_id = m.account_id
  JOIN public.wa_chat_segments AS s
    ON s.chat_id = c.id
   AND s.account_id = c.account_id
  WHERE lower(trim(m.direction)) = 'inbound'
    AND lower(trim(c.chat_type)) = 'direct'
    AND lower(trim(s.segment)) = 'cliente'
    AND lower(trim(s.confidence)) IN ('alta', 'media')
    AND s.conflict = false
)
SELECT
  p.id AS product_id,
  p.sku,
  p.model,
  nm.message_at,
  'HIGH_EXACT_SKU'::text AS match_confidence,
  false AS conflict
FROM normalized_messages AS nm
JOIN public."Product" AS p
  ON length(trim(regexp_replace(lower(p.sku), '[^a-z0-9]+', ' ', 'g'))) >= 4
 AND (' ' || nm.normalized_text || ' ') LIKE
     ('% ' || trim(regexp_replace(lower(p.sku), '[^a-z0-9]+', ' ', 'g')) || ' %');

CREATE OR REPLACE VIEW company_os_source.supplier_availability AS
WITH normalized_items AS (
  SELECT
    oi.*,
    trim(regexp_replace(
      lower(concat_ws(' ', oi.brand, oi.product, oi.model, oi.capacity, oi.color, oi.condition)),
      '[^a-z0-9]+',
      ' ',
      'g'
    )) AS normalized_item
  FROM public.wa_offer_items AS oi
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
JOIN public.wa_offers AS o ON o.id = ni.offer_id
JOIN public."SupplierProduct" AS sp
  ON trim(regexp_replace(lower(sp."supplierName"), '[^a-z0-9]+', ' ', 'g')) = ni.normalized_item
JOIN public."Product" AS p
  ON (sp."ourProductId" IS NOT NULL AND p.id = sp."ourProductId")
  OR (sp."ourSku" IS NOT NULL AND p.sku = sp."ourSku");

REVOKE ALL ON ALL TABLES IN SCHEMA company_os_source FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'company_os_reader') THEN
    GRANT USAGE ON SCHEMA company_os_source TO company_os_reader;
    GRANT SELECT ON
      public."OrderItem",
      public."PurchaseItem",
      public."PurchaseAllocation",
      public."SupplierProduct"
    TO company_os_reader;
    GRANT SELECT ON
      company_os_source.recent_product_inquiries,
      company_os_source.supplier_availability
    TO company_os_reader;
  END IF;
END
$$;

COMMENT ON VIEW company_os_source.recent_product_inquiries IS
  'Read-only exact-SKU demand signals. No message text, contact identity, phone, or chat identifier is exposed.';
COMMENT ON VIEW company_os_source.supplier_availability IS
  'Read-only supplier availability mapped through SupplierProduct. No supplier identity or raw message text is exposed.';
