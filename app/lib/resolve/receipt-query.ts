export function buildLookupQuery(item: { name: string; brand: string | null; packageSize: string | null }) {
  const leading = item.brand && !item.name.toLowerCase().includes(item.brand.toLowerCase()) ? item.brand : '';
  return [leading, item.name, item.packageSize].filter(Boolean).join(' ').trim().slice(0, 160);
}

