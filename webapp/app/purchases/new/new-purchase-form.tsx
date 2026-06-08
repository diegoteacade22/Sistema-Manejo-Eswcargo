'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductSearchSelect } from '@/components/product-search-select';
import { createPurchaseFromForm } from '@/app/purchases/actions';

interface Supplier {
  id: number;
  name: string;
}

interface Product {
  id: number;
  name: string;
  sku: string;
  lp1: number | null;
  last_purchase_cost: number | null;
  color_grade: string | null;
  last_sale_price: number | null;
}

interface ItemRow {
  productId: string;
  quantity: number;
  unit_cost: number;
}

export default function NewPurchaseForm({ suppliers, products }: { suppliers: Supplier[]; products: Product[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);

  const addItem = () => {
    setItems((prev) => [...prev, { productId: '', quantity: 1, unit_cost: 0 }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ItemRow, value: string | number) => {
    setItems((prev) => {
      const clone = [...prev];
      const current = { ...clone[index], [field]: value };

      if (field === 'productId') {
        const product = products.find((p) => p.id.toString() === value);
        if (product) {
          current.unit_cost = product.last_purchase_cost ?? 0;
        }
      }

      clone[index] = current;
      return clone;
    });
  };

  const total = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);

  const onSubmit = () => {
    if (!supplierId) {
      alert('Selecciona un proveedor.');
      return;
    }

    if (!items.length) {
      alert('Agrega al menos un ítem.');
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set('supplierId', supplierId);
      formData.set('date', date);
      formData.set('invoice_number', invoiceNumber);
      formData.set('payment_method', paymentMethod);
      formData.set('notes', notes);
      formData.set('items', JSON.stringify(items.map((item) => ({
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unit_cost: Number(item.unit_cost),
        }))));
      if (receipt) formData.set('receipt', receipt);

      const result = await createPurchaseFromForm(formData);

      if (!result.success) {
        alert(result.message);
        return;
      }

      router.push(`/purchases/${result.purchaseId}`);
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 grid gap-4 md:grid-cols-5">
          <div className="space-y-2 md:col-span-2">
            <Label>Proveedor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar proveedor" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id.toString()}>{supplier.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Invoice</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-2">
            <Label>Método de pago</Label>
            <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Comprobante</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReceipt(e.target.files?.[0] || null)}
            />
          </div>
          <div className="space-y-2 md:col-span-5">
            <Label>Notas</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones de la compra" />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[420px]">Producto / SKU</TableHead>
                  <TableHead className="w-[120px]">Cantidad</TableHead>
                  <TableHead className="w-[180px]">Costo unit.</TableHead>
                  <TableHead className="w-[180px] text-right">Subtotal</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <ProductSearchSelect
                        products={products}
                        value={item.productId}
                        onValueChange={(val) => updateItem(index, 'productId', val)}
                        placeholder="Buscar por SKU o nombre..."
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="1"
                        className="h-8"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', Number(e.target.value) || 0)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-8"
                        value={item.unit_cost}
                        onChange={(e) => updateItem(index, 'unit_cost', Number(e.target.value) || 0)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.quantity * item.unit_cost)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="p-4 flex justify-between items-center bg-muted/20">
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" /> Agregar ítem
            </Button>
            <div className="text-xl font-bold">
              Total Compra: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total)}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onSubmit} disabled={isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar Compra
        </Button>
      </div>
    </div>
  );
}
