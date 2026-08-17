import type { ExtractedItem } from './contracts';

export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  model: string | null;
  brand: string | null;
  color_grade: string | null;
};

const aliases: Record<string, string> = {
  iph: 'iphone',
  pm: 'pro max',
  blk: 'black',
  wht: 'white',
};

export function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d+)\s*(gb|tb)\b/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => aliases[word]?.split(' ') || word);
}

function score(query: string[], candidate: string[]) {
  if (!query.length || !candidate.length) return 0;
  const querySet = new Set(query);
  const candidateSet = new Set(candidate);
  let overlap = 0;
  for (const token of querySet) if (candidateSet.has(token)) overlap += 1;
  const precision = overlap / querySet.size;
  const recall = overlap / candidateSet.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

export function matchCatalog(item: ExtractedItem, catalog: CatalogProduct[]) {
  const query = normalizeWords([
    item.product, item.exactModel, item.capacity, item.color, item.condition, item.region,
  ].filter(Boolean).join(' '));
  const ranked = catalog
    .map((product) => ({
      product,
      confidence: score(query, normalizeWords([
        product.sku, product.brand, product.name, product.model, product.color_grade,
      ].filter(Boolean).join(' '))),
    }))
    .sort((left, right) => right.confidence - left.confidence);
  const best = ranked[0];
  const second = ranked[1];
  const accepted = Boolean(
    best && best.confidence >= 0.82 && best.confidence - (second?.confidence || 0) >= 0.08,
  );
  return {
    product: accepted ? best.product : null,
    confidence: best?.confidence || 0,
    reason: accepted
      ? null
      : best?.confidence
        ? 'Coincidencia de catálogo ambigua o de baja confianza.'
        : 'No se encontró candidato en el catálogo.',
  };
}
