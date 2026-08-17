'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Analysis = {
  sourceName: string;
  summaryText: string;
  counts: Record<string, number>;
  sourceData: { latestPurchaseDate: string | null; latestSaleDate: string | null };
  opportunities: Array<{
    lineId: string;
    status: string;
    reason: string;
    source: { description: string; offeredUnitCost: number; quantity?: number };
    match: { confidence: number; product?: { sku: string; name: string; color?: string | null } };
    history?: {
      purchases: { latestCost: number | null; latestDate: string | null; count: number };
      sales: { latestPrice: number | null; latestDate: string | null; count: number };
      savingsVsReferencePct: number | null;
      estimatedMarginPct: number | null;
      referenceCostSource: string | null;
    };
  }>;
};

const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const date = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(value)) : '—';

const badgeClass: Record<string, string> = {
  OFERTA_PROBABLE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  POSIBLE_OFERTA: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400',
  NO_ES_OFERTA: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  HISTORIAL_INSUFICIENTE: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  AMBIGUO: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  NO_ENCONTRADO: 'border-red-500/40 bg-red-500/10 text-red-400',
};

export function PriceOpportunitiesClient() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setError('');
    setLoading(true);
    try {
      const form = new FormData();
      if (file) form.set('file', file);
      if (text.trim()) form.set('text', text.trim());
      if (supplierName.trim()) form.set('supplierName', supplierName.trim());
      const response = await fetch('/api/price-opportunities', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo analizar la lista.');
      setAnalysis(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo analizar la lista.');
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-700 bg-slate-900/60">
        <CardHeader>
          <CardTitle className="text-base">Cómo usarlo</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
            <li>Sube la lista recibida por WhatsApp o pega el texto del mensaje.</li>
            <li>Presiona <strong>Analizar contra IMPORTSYS</strong>.</li>
            <li>Prioriza <strong>Oferta probable</strong> y revisa precio, última compra, última venta y margen.</li>
            <li>Confirma manualmente los resultados <strong>Ambiguo</strong> o <strong>No encontrado</strong> antes de comprar.</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            El análisis es informativo: no crea ni modifica compras, ventas o inventario.
          </p>
        </CardContent>
      </Card>

      <Card className="border-cyan-500/20 bg-slate-950/40">
        <CardHeader>
          <CardTitle>Cargar lista o pegar mensaje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="file"
            accept=".xls,.xlsx,.xlsm,.csv,.txt"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <Input
            value={supplierName}
            onChange={(event) => setSupplierName(event.target.value)}
            placeholder="Proveedor (opcional, pero recomendado)"
          />
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            placeholder="También puedes pegar aquí una lista recibida como texto en WhatsApp…"
          />
          <Button onClick={analyze} disabled={loading || (!file && !text.trim())}>
            {loading ? 'Analizando…' : 'Analizar contra IMPORTSYS'}
          </Button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {analysis && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Oferta probable</p><p className="text-3xl font-black text-emerald-400">{analysis.counts.OFERTA_PROBABLE || 0}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Posible oferta</p><p className="text-3xl font-black text-cyan-400">{analysis.counts.POSIBLE_OFERTA || 0}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Revisión manual</p><p className="text-3xl font-black text-amber-400">{(analysis.counts.AMBIGUO || 0) + (analysis.counts.NO_ENCONTRADO || 0)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Sin historial</p><p className="text-3xl font-black text-slate-300">{analysis.counts.HISTORIAL_INSUFICIENTE || 0}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Resumen · {analysis.sourceName}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm text-slate-300">{analysis.summaryText}</pre>
              <p className="mt-4 text-xs text-muted-foreground">
                Última compra disponible: {date(analysis.sourceData.latestPurchaseDate)} · Última venta disponible: {date(analysis.sourceData.latestSaleDate)}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {analysis.opportunities.map((item) => (
              <Card key={item.lineId} className="overflow-hidden">
                <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.4fr_0.8fr_0.8fr_1fr]">
                  <div>
                    <Badge variant="outline" className={badgeClass[item.status] || ''}>{item.status.replaceAll('_', ' ')}</Badge>
                    <p className="mt-2 font-semibold">{item.match.product?.name || item.source.description}</p>
                    <p className="text-xs text-muted-foreground">{item.match.product?.sku || 'Sin coincidencia exacta'} · confianza {item.match.confidence}%</p>
                    <p className="mt-2 text-xs text-muted-foreground">{item.reason}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Oferta proveedor</p>
                    <p className="text-xl font-black">{money(item.source.offeredUnitCost)}</p>
                    {item.source.quantity !== undefined && <p className="text-xs text-muted-foreground">Stock: {item.source.quantity}</p>}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Última compra</p>
                    <p className="font-bold">{money(item.history?.purchases.latestCost)}</p>
                    <p className="text-xs text-muted-foreground">{date(item.history?.purchases.latestDate)} · {item.history?.purchases.count || 0} registros</p>
                    <p className="mt-2 text-xs text-muted-foreground">Última venta</p>
                    <p className="font-bold">{money(item.history?.sales.latestPrice)}</p>
                    <p className="text-xs text-muted-foreground">{date(item.history?.sales.latestDate)} · {item.history?.sales.count || 0} registros</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ahorro vs. costo</p>
                    <p className="text-xl font-black text-emerald-400">{item.history?.savingsVsReferencePct !== null && item.history?.savingsVsReferencePct !== undefined ? `${item.history.savingsVsReferencePct.toFixed(1)}%` : '—'}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Margen estimado</p>
                    <p className="font-bold">{item.history?.estimatedMarginPct !== null && item.history?.estimatedMarginPct !== undefined ? `${item.history.estimatedMarginPct.toFixed(1)}%` : '—'}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{item.history?.referenceCostSource === 'PURCHASE_ITEMS' ? 'Basado en compras reales' : item.history?.referenceCostSource === 'SALE_RECORDED_COST' ? 'Basado en costo registrado en ventas' : ''}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
