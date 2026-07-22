-- ESWCARGO accesses PostgreSQL only from the server through Prisma. Public
-- Supabase API roles must not have direct access to operational data.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AccountEvidence',
    'Client',
    'ClientPaymentGuard',
    'Contact',
    'Expense',
    'ManualPackingItem',
    'Order',
    'OrderItem',
    'OrderSubmissionGuard',
    'PaymentReceipt',
    'Product',
    'Purchase',
    'PurchaseAllocation',
    'PurchaseItem',
    'PurchasePayment',
    'PurchasePaymentGuard',
    'Shipment',
    'SparePart',
    'Supplier',
    'SupplierProduct',
    'SyncChange',
    'SyncRun',
    'Transaction',
    'User',
    '_prisma_migrations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END
$$;
