'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardPaste, FileCheck2, Mic, Plus, Square, Trash2 } from 'lucide-react';
import { submitOrder } from '@/app/actions';
import { ProductSearchSelect } from '@/components/product-search-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type Client = { id: number; name: string };
type Product = {
    id: number;
    name: string;
    sku: string;
    lp1: number | null;
    last_purchase_cost: number | null;
    color_grade: string | null;
    last_sale_price: number | null;
};

type DraftItem = {
    raw: string;
    productId: string;
    quantity: number;
    price: number;
    cost: number;
    shipmentNumber: string;
    matched: boolean;
};

function normalized(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function parseAmount(value: string) {
    const compact = value.replace(/[^0-9,.-]/g, '');
    if (!compact) return 0;
    const lastComma = compact.lastIndexOf(',');
    const lastDot = compact.lastIndexOf('.');
    const decimalIndex = Math.max(lastComma, lastDot);
    const integer = decimalIndex >= 0 ? compact.slice(0, decimalIndex).replace(/[.,]/g, '') : compact.replace(/[.,]/g, '');
    const decimal = decimalIndex >= 0 ? compact.slice(decimalIndex + 1).replace(/[.,]/g, '') : '';
    return Number(`${integer || '0'}${decimal ? `.${decimal.slice(0, 2)}` : ''}`) || 0;
}

function parseLine(line: string, products: Product[]): DraftItem | null {
    const compact = line.trim();
    if (!compact) return null;

    const quantityMatch = compact.match(/^\s*(?:[-*]\s*)?(\d+)\s*(?:x|u(?:nidades?)?\.?)?\s+(.+)$/i);
    if (!quantityMatch) return null;

    const quantity = Number(quantityMatch[1]);
    if (!Number.isInteger(quantity) || quantity <= 0) return null;

    const details = quantityMatch[2];
    const moneyMatch = details.match(/(?:usd|u\$s|us\$|\$)\s*([0-9.,]+)/i);
    const price = moneyMatch ? parseAmount(moneyMatch[1]) : 0;
    const shipmentMatch = details.match(/(?:envio|env[ií]o|pl|shipment)\s*#?\s*(\d+)/i);
    const productText = normalized(details.replace(/(?:usd|u\$s|us\$|\$)\s*[0-9.,]+/ig, '').replace(/(?:envio|env[ií]o|pl|shipment)\s*#?\s*\d+/ig, ''));

    const skuMatches = products.filter((product) => productText.includes(normalized(product.sku)));
    const nameMatches = skuMatches.length ? skuMatches : products.filter((product) => {
        const name = normalized(product.name);
        return name.length >= 7 && (productText.includes(name) || name.includes(productText));
    });
    const product = nameMatches.length === 1 ? nameMatches[0] : null;
    const suggestedPrice = product?.last_sale_price ?? product?.lp1 ?? 0;

    return {
        raw: compact,
        productId: product ? String(product.id) : '',
        quantity,
        price: price || suggestedPrice,
        cost: product?.last_purchase_cost || 0,
        shipmentNumber: shipmentMatch ? shipmentMatch[1] : '',
        matched: Boolean(product),
    };
}

function findClient(text: string, clients: Client[]) {
    const source = normalized(text);
    const matches = clients.filter((client) => {
        const name = normalized(client.name);
        return name.length >= 5 && source.includes(name);
    });
    return matches.length === 1 ? String(matches[0].id) : '';
}

export default function OrderIntakeClient({ clients, products, shipments }: { clients: Client[]; products: Product[]; shipments: number[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [rawText, setRawText] = useState('');
    const [clientId, setClientId] = useState('');
    const [items, setItems] = useState<DraftItem[]>([]);
    const [paymentMethod, setPaymentMethod] = useState('PENDIENTE');
    const [dispatchConfirmed, setDispatchConfirmed] = useState(false);
    const [notice, setNotice] = useState('');
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

    const total = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.price, 0), [items]);
    const hasShipmentAssignment = items.some((item) => Boolean(item.shipmentNumber));
    const canCreate = Boolean(clientId) && items.length > 0 && (!hasShipmentAssignment || dispatchConfirmed) && items.every((item) =>
        item.productId &&
        item.quantity > 0 &&
        item.price > 0 &&
        (!item.shipmentNumber || shipments.includes(Number(item.shipmentNumber)))
    );

    const updateItem = (index: number, patch: Partial<DraftItem>) => {
        setItems((current) => current.map((item, itemIndex) => {
            if (itemIndex !== index) return item;
            const next = { ...item, ...patch };
            if (patch.productId !== undefined) {
                const product = products.find((candidate) => candidate.id === Number(patch.productId));
                if (product) {
                    next.cost = product.last_purchase_cost || 0;
                    if (!next.price) next.price = product.last_sale_price ?? product.lp1 ?? 0;
                    next.matched = true;
                } else {
                    next.matched = false;
                }
            }
            return next;
        }));
    };

    const extractDraft = () => {
        const parsed = rawText.split(/\r?\n/).map((line) => parseLine(line, products)).filter((item): item is DraftItem => Boolean(item));
        setItems(parsed);
        setClientId(findClient(rawText, clients));
        setNotice(parsed.length ? '' : 'No se detectaron líneas con cantidad. Revisá el texto o agregá los productos manualmente.');
    };

    const addItem = () => setItems((current) => [...current, { raw: '', productId: '', quantity: 1, price: 0, cost: 0, shipmentNumber: '', matched: false }]);

    useEffect(() => () => recognitionRef.current?.stop(), []);
    useEffect(() => {
        if (!hasShipmentAssignment) setDispatchConfirmed(false);
    }, [hasShipmentAssignment]);

    const toggleDictation = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }

        const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!Recognition) {
            setNotice('El dictado no está disponible en este navegador. Podés pegar el texto recibido.');
            return;
        }

        const recognition = new Recognition();
        recognition.lang = 'es-AR';
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (event: any) => {
            let finalText = '';
            for (let index = event.resultIndex; index < event.results.length; index++) {
                if (event.results[index].isFinal) finalText += event.results[index][0].transcript;
            }
            if (finalText) setRawText((current) => `${current}${current ? '\n' : ''}${finalText.trim()}`);
        };
        recognition.onerror = () => {
            setNotice('No se pudo transcribir el dictado. Revisá el permiso del micrófono e intentá nuevamente.');
            setIsListening(false);
        };
        recognition.onend = () => setIsListening(false);
        recognitionRef.current = recognition;
        recognition.start();
        setNotice('');
        setIsListening(true);
    };

    const createOrder = () => {
        if (!canCreate) {
            setNotice(hasShipmentAssignment && !dispatchConfirmed
                ? 'Confirmá la asignación de despacho antes de aprobar un pedido con envío.'
                : 'Completá cliente, producto, cantidad, precio y verificá cada número de envío antes de aprobar.');
            return;
        }

        setNotice('');
        startTransition(async () => {
            const result = await submitOrder({
                clientId: Number(clientId),
                date: new Date(),
                type: 'CELL-NEW',
                paymentMethod: paymentMethod === 'PENDIENTE' ? undefined : paymentMethod,
                dispatchConfirmed,
                notes: `Borrador aprobado desde WhatsApp:\nCondición de pago: ${paymentMethod}.\n${rawText}`.slice(0, 5000),
                items: items.map((item) => ({
                    productId: Number(item.productId),
                    name: products.find((product) => product.id === Number(item.productId))?.name || 'Producto confirmado',
                    quantity: item.quantity,
                    price: item.price,
                    cost: item.cost,
                    shipment_number: item.shipmentNumber ? Number(item.shipmentNumber) : null,
                    status: item.shipmentNumber ? 'SALIENDO' : 'RESERVADO',
                })),
            });

            if (result.success) {
                router.push(`/orders/${result.orderId}`);
                return;
            }
            setNotice(result.message || 'No se pudo crear el pedido.');
        });
    };

    return (
        <main className="p-6 md:p-8 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Bandeja de pedidos</h1>
                    <p className="text-sm text-muted-foreground">Borrador pendiente de aprobación</p>
                </div>
                <Button onClick={createOrder} disabled={!canCreate || isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <FileCheck2 className="mr-2 h-4 w-4" /> {isPending ? 'Creando pedido...' : 'Aprobar y crear pedido'}
                </Button>
            </div>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div className="space-y-3">
                    <Label htmlFor="whatsapp-text">Texto recibido</Label>
                    <Textarea id="whatsapp-text" value={rawText} onChange={(event) => setRawText(event.target.value)} className="min-h-[360px] font-mono text-sm" placeholder="Pegá el mensaje recibido..." />
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={extractDraft} disabled={!rawText.trim()}>
                            <ClipboardPaste className="mr-2 h-4 w-4" /> Generar borrador
                        </Button>
                        <Button type="button" variant={isListening ? 'destructive' : 'outline'} onClick={toggleDictation}>
                            {isListening ? <Square className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                            {isListening ? 'Detener dictado' : 'Dictar pedido'}
                        </Button>
                    </div>
                </div>

                <div className="space-y-4 border border-border p-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <Select value={clientId} onValueChange={setClientId}>
                                <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                                <SelectContent>{clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Total</Label>
                            <div className="h-10 border border-input px-3 py-2 font-mono font-semibold">USD {total.toFixed(2)}</div>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Condición de pago</Label>
                            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="PENDIENTE">Pendiente de cobro</SelectItem>
                                    <SelectItem value="TRANSFERENCIA">Transferencia informada</SelectItem>
                                    <SelectItem value="EFECTIVO">Efectivo informado</SelectItem>
                                    <SelectItem value="TARJETA">Tarjeta informada</SelectItem>
                                    <SelectItem value="OTRO">Otro medio informado</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">No registra un pago. El cobro se confirma desde Cuenta Corriente.</p>
                        </div>
                        <label className={`flex items-start gap-3 border border-border p-3 text-sm ${hasShipmentAssignment ? 'cursor-pointer' : 'opacity-60'}`}>
                            <input
                                type="checkbox"
                                checked={dispatchConfirmed}
                                disabled={!hasShipmentAssignment}
                                onChange={(event) => setDispatchConfirmed(event.target.checked)}
                                className="mt-0.5 h-4 w-4"
                            />
                            <span><strong>Despacho confirmado</strong><br /><span className="text-xs text-muted-foreground">Verifiqué que los números de envío asignados son correctos.</span></span>
                        </label>
                    </div>

                    <div className="space-y-3">
                        {items.map((item, index) => (
                            <div key={`${item.raw}-${index}`} className="grid gap-3 border-t border-border pt-3 md:grid-cols-[minmax(0,1fr)_70px_110px_120px_42px]">
                                <div className="space-y-1">
                                    <ProductSearchSelect products={products} value={item.productId} onValueChange={(productId) => updateItem(index, { productId })} placeholder={item.raw || 'Seleccionar producto'} />
                                    {!item.matched && <p className="text-xs text-amber-600">Producto sin coincidencia confirmada.</p>}
                                    {item.shipmentNumber && !shipments.includes(Number(item.shipmentNumber)) && <p className="text-xs text-amber-600">Envío no encontrado.</p>}
                                </div>
                                <Input aria-label="Cantidad" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, { quantity: Number(event.target.value) || 0 })} />
                                <Input aria-label="Precio" type="number" min="0" step="0.01" value={item.price} onChange={(event) => updateItem(index, { price: Number(event.target.value) || 0 })} />
                                <Input aria-label="Envio" list="shipment-numbers" placeholder="Envio #" value={item.shipmentNumber} onChange={(event) => updateItem(index, { shipmentNumber: event.target.value })} />
                                <Button type="button" variant="ghost" size="icon" aria-label="Quitar producto" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        ))}
                        <datalist id="shipment-numbers">{shipments.map((number) => <option key={number} value={number} />)}</datalist>
                        <Button type="button" variant="outline" onClick={addItem}><Plus className="mr-2 h-4 w-4" /> Agregar producto</Button>
                    </div>
                </div>
            </section>

            {notice && <p className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{notice}</p>}
        </main>
    );
}
