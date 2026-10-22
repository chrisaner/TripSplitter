export const HISTORY_PAGE_SIZE = 10;
export const TRASH_PAGE_SIZE = 5;

export function recordPage(records, requestedPage, size, dateField) {
  const sorted = [...records].sort((a,b) => String(b[dateField] || '').localeCompare(String(a[dateField] || '')) || String(b.id).localeCompare(String(a.id)));
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), pages - 1);
  return { items: sorted.slice(page * size, (page + 1) * size), page, pages, total: sorted.length };
}
