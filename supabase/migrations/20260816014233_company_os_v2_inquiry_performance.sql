-- Demand signals older than 30 days cannot qualify a product. Apply the
-- indexed message_at cutoff before normalization and SKU matching.
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
  WHERE m.message_at >= now() - interval '30 days'
    AND lower(trim(m.direction)) = 'inbound'
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

REVOKE ALL ON TABLE company_os_source.recent_product_inquiries FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'company_os_reader') THEN
    GRANT SELECT ON TABLE company_os_source.recent_product_inquiries TO company_os_reader;
  END IF;
END
$$;
