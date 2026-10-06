export type SortDir = 'asc' | 'desc';

interface Props {
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: () => void;
  align?: 'left' | 'right';
  className?: string;
}

// A table column header you can click to sort by: ▲ ascending, ▼ descending,
// ↕ when another column is the one being sorted.
export function SortableTh({ label, active, dir, onSort, align = 'left', className }: Props) {
  return (
    <th className={className} style={align === 'right' ? { textAlign: 'right' } : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button" className="btn btn-ghost" onClick={onSort}
        style={{
          padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'inherit',
          display: 'inline-flex', gap: 6, alignItems: 'center', flexDirection: align === 'right' ? 'row-reverse' : 'row'
        }}
        title={active ? (dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending') : `Click to sort by ${label}`}
      >
        {label} <span aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
