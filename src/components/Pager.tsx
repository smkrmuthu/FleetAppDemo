import { ChevronLeft, ChevronRight } from 'lucide-react';

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
