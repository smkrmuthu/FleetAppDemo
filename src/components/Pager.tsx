import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE = 25;

// Which slice of a long list to show. The page goes back to the first one
// whenever `resetKey` changes (a filter or search), and never past the last.
export function usePaging(total: number, resetKey: string, size = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  const current = Math.min(page, Math.max(0, Math.ceil(total / size) - 1));
  return { page: current, setPage, size, total, slice: <T,>(items: T[]) => items.slice(current * size, (current + 1) * size) };
}


// "1–25 of 250" with previous / next, for tables that would otherwise run to
// hundreds of rows. Renders nothing when everything fits on one page.
export function Pager({ page, pageSize, total, onPage, attached }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; attached?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className={attached ? 'pager pager-attached' : 'pager'}>
      <span>{from}–{to} of {total}</span>
      <span className="pager-buttons">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        <span>Page {page + 1} of {pages}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </span>
    </div>
  );
}
