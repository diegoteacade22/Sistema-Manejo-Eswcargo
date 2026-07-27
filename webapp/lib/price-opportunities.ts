import { prisma } from '@/lib/prisma';
import type { OfferedPriceItem } from '@/lib/price-list-parser';

type ProductForMatching = {
  id: number;
  sku: string;
  name: string;
  color_grade: string | null;
  type: string | null;
  model: string | null;
  brand: string | null;
  active: boolean;
};

type ProductFeatures = {
  normalized: string;
  family?: string;
  capacity?: string;
  region?: string;
  color?: string;
  condition?: string;
  tokens: Set<string>;
};

export type OpportunityStatus =
  | 'OFERTA_PROBABLE'
  | 'POSIBLE_OFERTA'
  | 'NO_ES_OFERTA'
  | 'HISTORIAL_INSUFICIENTE'
  | 'AMBIGUO'
  | 'NO_ENCONTRADO';

export type PriceOpportunity = {
  lineId: string;
  source: {
    description: string;
    supplierSku?: string;
    spec?: string;
    quantity?: number;
    offeredUnitCost: number;
    currency: 'USD';
    sheet?: string;
    sourceRow?: number;
  };
  match: {
    status: 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND';
    confidence: number;
    product?: { id: number; sku: string; name: string; color?: string | null };
    alternatives?: Array<{ sku: string; name: string; color?: string | null; score: number }>;
  };
  history?: {
    purchases: {
      count: number;
      units: number;
      latestCost: number | null;
      latestDate: string | null;
      medianCost: number | null;
      weightedAverageCost: number | null;
    };
    sales: {
      count: number;
      units: number;
      latestPrice: number | null;
      latestDate: string | null;
      medianPrice: number | null;
      weightedAveragePrice: number | null;
      medianRecordedCost: number | null;
    };
    referenceCost: number | null;
    referenceCostSource: 'PURCHASE_ITEMS' | 'SALE_RECORDED_COST' | null;
    savingsVsReferencePct: number | null;
    estimatedMarginPct: number | null;
  };
  status: OpportunityStatus;
  reason: string;
};

const regionMarkers: Array<[string, string[]]> = [
  ['IN', ['indian', 'india', 'hn/a', '🇮🇳']],
  ['US', ['usa', 'united states', 'll/a', '🇺🇸']],
  ['JP', ['japanese', 'japan', 'j/a', '🇯🇵']],
  ['CA', ['canada', 'canadian', '🇨🇦']],
  ['CN', ['china', 'chinese', 'hong kong', '🇨🇳']],
  ['EU', ['euro', 'europe', 'european']],
  ['ID', ['indonesian', 'indonesia']],
];

const colors = [
  'cosmic orange',
  'deep blue',
  'mist blue',
  'space black',
  'space gray',
  'rose gold',
  'natural titanium',
  'black titanium',
  'white titanium',
  'blue titanium',
  'desert titanium',
  'cobalt violet',
  'champagne gold',
  'matte black',
  'awesome graphite',
  'light blue',
  'light gray',
  'sky blue',
  'graphite',
  'starlight',
  'midnight',
  'ultramarine',
  'lavender',
  'sage',
  'purple',
  'silver',
  'yellow',
  'green',
  'white',
  'black',
  'blue',
  'pink',
  'teal',
  'red',
];

const stopWords = new Set([
  'the', 'with', 'and', 'for', 'new', 'sealed', 'factory', 'apple', 'samsung',
  'gb', 'tb', 'usa', 'indian', 'japanese', 'euro', 'unit', 'units',
]);

export function normalizeProductText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200e\u200f]/g, '')
    .toLowerCase()
    .replace(/iphone\s*(\d)/g, 'iphone $1')
    .replace(/(\d)\s*(gb|tb)/g, '$1$2')
    .replace(/[^a-z0-9+/" ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFamily(normalized: string) {
  const iphoneSe = normalized.match(/iphone\s+se\s*(\d+)?/);
  if (iphoneSe) return `iphone se${iphoneSe[1] ? ` ${iphoneSe[1]}` : ''}`;

  const iphoneAir = normalized.match(/iphone\s+air/);
  if (iphoneAir) return 'iphone air';

  const iphone = normalized.match(/iphone\s*(\d{1,2})(e)?\s*(pro max|pro|plus)?/);
  if (iphone) {
    const suffix = iphone[2] ? 'e' : iphone[3] ? ` ${iphone[3]}` : '';
    return `iphone ${iphone[1]}${suffix}`;
  }

  const bareIphone = normalized.match(/^(1[3-9])\s*(e)?\s*(pro max|pro|plus)?/);
  if (bareIphone) {
    const suffix = bareIphone[2] ? 'e' : bareIphone[3] ? ` ${bareIphone[3]}` : '';
    return `iphone ${bareIphone[1]}${suffix}`;
  }

  const ipad = normalized.match(/ipad\s+(air|pro|mini)?\s*(\d{1,2})?/);
  if (ipad) return ['ipad', ipad[1], ipad[2]].filter(Boolean).join(' ');

  const watch = normalized.match(/(?:apple\s+)?watch\s+(series|se|ultra)?\s*(\d+)?/);
  if (watch) return ['watch', watch[1], watch[2]].filter(Boolean).join(' ');

  const macbook = normalized.match(/macbook\s+(air|pro|neo)?\s*(\d{2})?/);
  if (macbook) return ['macbook', macbook[1]].filter(Boolean).join(' ');

  const galaxy = normalized.match(/samsung\s+(?:galaxy\s+)?([a-z]+\s*\d+[a-z]?)/)
    || normalized.match(/galaxy\s+([a-z]+\s*\d+[a-z]?)/);
  if (galaxy) return `samsung ${galaxy[1].replace(/\s+/g, '')}`;

  return undefined;
}

function detectCapacity(normalized: string) {
  const matches = [...normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(gb|tb)\b/g)];
  const match = matches.at(-1);
  return match ? `${match[1]}${match[2]}` : undefined;
}

function detectRegion(raw: string, normalized: string, sku?: string) {
  const skuUpper = (sku || '').toUpperCase();
  const skuRegion = skuUpper.match(/-(IN|US|JP|CA|CN|CH|EU|ID)-/);
  if (skuRegion) return skuRegion[1] === 'CH' ? 'CN' : skuRegion[1];

  for (const [code, markers] of regionMarkers) {
    if (markers.some((marker) => raw.toLowerCase().includes(marker) || normalized.includes(normalizeProductText(marker)))) return code;
  }
  return undefined;
}

function detectColor(normalized: string) {
  return colors.find((color) => normalized.includes(color));
}

function detectCondition(normalized: string, type?: string | null) {
  const combined = `${normalized} ${normalizeProductText(type)}`;
  if (/(activated|activado|resellado|cell act)/.test(combined)) return 'ACTIVATED';
  if (/(cpo|certified pre owned)/.test(combined)) return 'CPO';
  if (/(refurb|renewed|reacondicionado)/.test(combined)) return 'REFURB';
  if (/(asis|as is)/.test(combined)) return 'ASIS';
  if (/(used|grade|a\+|a grade|ab grade)/.test(combined)) return 'USED';
  if (/(cell new|new|sealed)/.test(combined)) return 'NEW';
  return undefined;
}

function tokenSet(normalized: string) {
  return new Set(
    normalized
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  );
}

function features(raw: string, options: { sku?: string; type?: string | null } = {}): ProductFeatures {
  const normalized = normalizeProductText(raw);
  return {
    normalized,
    family: detectFamily(normalized),
    capacity: detectCapacity(normalized),
    region: detectRegion(raw, normalized, options.sku),
    color: detectColor(normalized),
    condition: detectCondition(normalized, options.type),
    tokens: tokenSet(normalized),
  };
}

function tokenSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

function scoreProduct(item: OfferedPriceItem, product: ProductForMatching) {
  if (item.sku && normalizeProductText(item.sku) === normalizeProductText(product.sku)) return 100;

  const offered = features(`${item.description} ${item.spec || ''} ${item.supplierSku || ''}`);
  const catalog = features(
    `${product.name} ${product.model || ''} ${product.color_grade || ''} ${product.brand || ''} ${product.sku}`,
    { sku: product.sku, type: product.type },
  );

  let score = 0;
  if (offered.family) {
    if (catalog.family !== offered.family) return 0;
    score += 48;
  }
  if (offered.capacity) {
    if (catalog.capacity !== offered.capacity) return 0;
    score += 20;
  }
  if (!offered.family && !offered.capacity) score += tokenSimilarity(offered.tokens, catalog.tokens) * 55;

  if (offered.region) {
    if (catalog.region && catalog.region !== offered.region) return 0;
    score += catalog.region === offered.region ? 12 : 0;
  }
  if (offered.color) {
    if (catalog.color && catalog.color !== offered.color) return 0;
    score += catalog.color === offered.color ? 10 : 0;
  }

  const offeredCondition = offered.condition || 'NEW';
  if (catalog.condition && catalog.condition !== offeredCondition) return 0;
  if (catalog.condition === offeredCondition) score += 8;

  score += tokenSimilarity(offered.tokens, catalog.tokens) * 12;
  return Math.max(0, Math.min(99, Math.round(score)));
}

export function rankProductMatches(item: OfferedPriceItem, products: ProductForMatching[]) {
  return products
    .map((product) => ({ product, score: scoreProduct(item, product) }))
    .filter((entry) => entry.score >= 58)
    .sort((left, right) => right.score - left.score || left.product.sku.localeCompare(right.product.sku))
    .slice(0, 5);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedAverage(rows: Array<{ value: number; quantity: number }>) {
  const units = rows.reduce((sum, row) => sum + Math.max(row.quantity, 0), 0);
  if (!units) return null;
  return rows.reduce((sum, row) => sum + row.value * Math.max(row.quantity, 0), 0) / units;
}

function round(value: number | null, precision = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function classify(
  offered: number,
  referenceCost: number | null,
  medianSale: number | null,
  hasPurchaseHistory: boolean,
) {
  const savingsPct = referenceCost && referenceCost > 0 ? ((referenceCost - offered) / referenceCost) * 100 : null;
  const marginPct = medianSale && medianSale > 0 ? ((medianSale - offered) / medianSale) * 100 : null;

  if (referenceCost === null && medianSale === null) {
    return {
      status: 'HISTORIAL_INSUFICIENTE' as const,
      reason: 'No hay compras ni ventas comparables para esta variante.',
      savingsPct,
      marginPct,
    };
  }

  if (savingsPct !== null && savingsPct >= 5 && (marginPct === null || marginPct >= 5)) {
    return {
      status: 'OFERTA_PROBABLE' as const,
      reason: `El precio está ${savingsPct.toFixed(1)}% debajo del costo histórico de referencia.`,
      savingsPct,
      marginPct,
    };
  }

  if (
    (savingsPct !== null && savingsPct >= 1 && (marginPct === null || marginPct >= 3))
    || (referenceCost === null && marginPct !== null && marginPct >= 15)
  ) {
    return {
      status: 'POSIBLE_OFERTA' as const,
      reason: hasPurchaseHistory
        ? 'El precio mejora el costo histórico, pero la diferencia es moderada.'
        : 'El margen contra ventas recientes es atractivo, aunque faltan compras exactas.',
      savingsPct,
      marginPct,
    };
  }

  if (referenceCost === null) {
    return {
      status: 'HISTORIAL_INSUFICIENTE' as const,
      reason: 'Hay ventas comparables, pero falta un costo histórico exacto para confirmar la oferta.',
      savingsPct,
      marginPct,
    };
  }

  return {
    status: 'NO_ES_OFERTA' as const,
    reason: savingsPct !== null && savingsPct < 0
      ? `El precio está ${Math.abs(savingsPct).toFixed(1)}% por encima del costo histórico.`
      : 'El precio no mejora de forma material el costo histórico.',
    savingsPct,
    marginPct,
  };
}

export async function analyzePriceOpportunities(items: OfferedPriceItem[], historyLimit = 5) {
  const safeHistoryLimit = Math.max(1, Math.min(10, historyLimit));
  const products = await prisma.product.findMany({
    where: { active: true },
    select: {
      id: true,
      sku: true,
      name: true,
      color_grade: true,
      type: true,
      model: true,
      brand: true,
      active: true,
    },
  });

  const initial = items.slice(0, 500).map((item) => {
    const ranked = rankProductMatches(item, products);
    const top = ranked[0];
    const second = ranked[1];
    const ambiguous = Boolean(top && second && top.score - second.score < 6);

    if (!top) {
      return {
        item,
        ranked,
        opportunity: {
          lineId: item.lineId,
          source: { ...item },
          match: { status: 'NOT_FOUND' as const, confidence: 0 },
          status: 'NO_ENCONTRADO' as const,
          reason: 'No se encontró una variante suficientemente parecida en IMPORTSYS.',
        },
      };
    }

    if (ambiguous) {
      return {
        item,
        ranked,
        opportunity: {
          lineId: item.lineId,
          source: { ...item },
          match: {
            status: 'AMBIGUOUS' as const,
            confidence: top.score,
            alternatives: ranked.slice(0, 3).map(({ product, score }) => ({
              sku: product.sku,
              name: product.name,
              color: product.color_grade,
              score,
            })),
          },
          status: 'AMBIGUO' as const,
          reason: 'Hay más de una variante posible; se requiere confirmar SKU, región, condición o color.',
        },
      };
    }

    return {
      item,
      ranked,
      product: top.product,
      opportunity: {
        lineId: item.lineId,
        source: { ...item },
        match: {
          status: 'MATCHED' as const,
          confidence: top.score,
          product: {
            id: top.product.id,
            sku: top.product.sku,
            name: top.product.name,
            color: top.product.color_grade,
          },
        },
        status: 'HISTORIAL_INSUFICIENTE' as const,
        reason: '',
      },
    };
  });

  const matchedProducts = [...new Map(
    initial.filter((entry) => entry.product).map((entry) => [entry.product!.id, entry.product!]),
  ).values()];
  const productIds = matchedProducts.map((product) => product.id);
  const productSkus = matchedProducts.map((product) => product.sku);

  const [purchaseRows, saleRows] = productIds.length
    ? await Promise.all([
      prisma.purchaseItem.findMany({
        where: { sku: { in: productSkus }, unit_cost: { gt: 0 } },
        include: { purchase: { select: { date: true } } },
        orderBy: [{ purchase: { date: 'desc' } }, { id: 'desc' }],
        take: Math.min(5_000, productIds.length * safeHistoryLimit * 4),
      }),
      prisma.orderItem.findMany({
        where: {
          productId: { in: productIds },
          unit_price: { gt: 0 },
          order: {
            status: { not: 'CANCELADO' },
            OR: [{ order_number: null }, { order_number: { lt: 900000 } }],
          },
        },
        include: { order: { select: { date: true } } },
        orderBy: [{ order: { date: 'desc' } }, { id: 'desc' }],
        take: Math.min(5_000, productIds.length * safeHistoryLimit * 6),
      }),
    ])
    : [[], []];

  const purchasesBySku = new Map<string, typeof purchaseRows>();
  for (const row of purchaseRows) {
    if (!row.sku) continue;
    const group = purchasesBySku.get(row.sku) || [];
    if (group.length < safeHistoryLimit) group.push(row);
    purchasesBySku.set(row.sku, group);
  }

  const salesByProductId = new Map<number, typeof saleRows>();
  for (const row of saleRows) {
    if (!row.productId) continue;
    const group = salesByProductId.get(row.productId) || [];
    if (group.length < safeHistoryLimit) group.push(row);
    salesByProductId.set(row.productId, group);
  }

  const opportunities: PriceOpportunity[] = initial.map((entry) => {
    if (!entry.product) return entry.opportunity;

    const purchases = purchasesBySku.get(entry.product.sku) || [];
    const sales = salesByProductId.get(entry.product.id) || [];
    const purchaseCosts = purchases.map((row) => row.unit_cost);
    const salePrices = sales.map((row) => row.unit_price);
    const saleCosts = sales.map((row) => row.unit_cost).filter((value) => value > 0);
    const purchaseMedian = median(purchaseCosts);
    const saleCostMedian = median(saleCosts);
    const referenceCost = purchaseMedian ?? saleCostMedian;
    const saleMedian = median(salePrices);
    const classification = classify(
      entry.item.offeredUnitCost,
      referenceCost,
      saleMedian,
      purchases.length > 0,
    );

    return {
      ...entry.opportunity,
      history: {
        purchases: {
          count: purchases.length,
          units: purchases.reduce((sum, row) => sum + row.quantity, 0),
          latestCost: round(purchases[0]?.unit_cost ?? null),
          latestDate: purchases[0]?.purchase.date.toISOString() ?? null,
          medianCost: round(purchaseMedian),
          weightedAverageCost: round(weightedAverage(purchases.map((row) => ({ value: row.unit_cost, quantity: row.quantity })))),
        },
        sales: {
          count: sales.length,
          units: sales.reduce((sum, row) => sum + row.quantity, 0),
          latestPrice: round(sales[0]?.unit_price ?? null),
          latestDate: sales[0]?.order.date.toISOString() ?? null,
          medianPrice: round(saleMedian),
          weightedAveragePrice: round(weightedAverage(sales.map((row) => ({ value: row.unit_price, quantity: row.quantity })))),
          medianRecordedCost: round(saleCostMedian),
        },
        referenceCost: round(referenceCost),
        referenceCostSource: purchaseMedian !== null
          ? 'PURCHASE_ITEMS'
          : saleCostMedian !== null
            ? 'SALE_RECORDED_COST'
            : null,
        savingsVsReferencePct: round(classification.savingsPct, 1),
        estimatedMarginPct: round(classification.marginPct, 1),
      },
      status: classification.status,
      reason: classification.reason,
    };
  });

  const uniqueByProduct = new Map<string, PriceOpportunity>();
  for (const item of opportunities) {
    const key = item.match.product?.sku
      || `${item.status}:${normalizeProductText(item.source.description)}`;
    const existing = uniqueByProduct.get(key);
    if (!existing || item.source.offeredUnitCost < existing.source.offeredUnitCost) {
      uniqueByProduct.set(key, item);
    }
  }
  const uniqueOpportunities = [...uniqueByProduct.values()];

  const counts = uniqueOpportunities.reduce<Record<OpportunityStatus, number>>((acc, item) => {
    acc[item.status] += 1;
    return acc;
  }, {
    OFERTA_PROBABLE: 0,
    POSIBLE_OFERTA: 0,
    NO_ES_OFERTA: 0,
    HISTORIAL_INSUFICIENTE: 0,
    AMBIGUO: 0,
    NO_ENCONTRADO: 0,
  });

  const ranked = uniqueOpportunities
    .filter((item) => item.status === 'OFERTA_PROBABLE' || item.status === 'POSIBLE_OFERTA')
    .sort((left, right) =>
      (right.history?.savingsVsReferencePct ?? -999) - (left.history?.savingsVsReferencePct ?? -999),
    );

  const summaryLines = ranked.slice(0, 10).map((item) => {
    const product = item.match.product!;
    const savings = item.history?.savingsVsReferencePct;
    const margin = item.history?.estimatedMarginPct;
    return `• ${product.sku} ${product.name}: oferta $${item.source.offeredUnitCost.toFixed(2)}`
      + `${savings !== null && savings !== undefined ? `, ahorro ${savings.toFixed(1)}%` : ''}`
      + `${margin !== null && margin !== undefined ? `, margen estimado ${margin.toFixed(1)}%` : ''}`;
  });

  const summaryText = [
    `Lista analizada: ${opportunities.length} renglones, ${uniqueOpportunities.length} productos o variantes.`,
    `Oferta probable: ${counts.OFERTA_PROBABLE}. Posible oferta: ${counts.POSIBLE_OFERTA}.`,
    `Revisión manual: ${counts.AMBIGUO + counts.NO_ENCONTRADO}. Historial insuficiente: ${counts.HISTORIAL_INSUFICIENTE}.`,
    ...summaryLines,
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    rowsAnalyzed: opportunities.length,
    uniqueProductsAnalyzed: uniqueOpportunities.length,
    sourceData: {
      latestPurchaseDate: purchaseRows[0]?.purchase.date.toISOString() ?? null,
      latestSaleDate: saleRows[0]?.order.date.toISOString() ?? null,
      historyLimit: safeHistoryLimit,
    },
    counts,
    summaryText,
    opportunities: uniqueOpportunities,
  };
}
