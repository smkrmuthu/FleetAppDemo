const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
];

interface Props {
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  years: number[];
}

// A quick shortcut over the same Loading-date-from/to filter: pick a whole
// month, or a whole year, instead of typing both edges by hand. It reads its
// selection back out of dateFrom/dateTo, so it stays in sync when someone
// edits those fields directly (and just shows blank for a range that isn't
// a clean calendar month or year).
export function MonthYearFilter({ dateFrom, dateTo, onDateFrom, onDateTo, years }: Props) {
  let selMonth = '';
  let selYear = '';
  // A whole-year range (Jan 1 – Dec 31) is checked first: Jan 1 alone would
  // otherwise also match the single-month pattern below and get misread as
  // "January" with no year, since its own end date (Dec 31) isn't Jan 31.
  if (/^\d{4}-01-01$/.test(dateFrom) && dateTo === `${dateFrom.slice(0, 4)}-12-31`) {
    selYear = dateFrom.slice(0, 4);
  } else {
    const monthMatch = /^(\d{4})-(\d{2})-01$/.exec(dateFrom);
    if (monthMatch) {
      const lastDay = new Date(Number(monthMatch[1]), Number(monthMatch[2]), 0).getDate();
      if (dateTo === `${monthMatch[1]}-${monthMatch[2]}-${String(lastDay).padStart(2, '0')}`) {
        selYear = monthMatch[1];
        selMonth = monthMatch[2];
      }
    }
  }

  function apply(month: string, year: string) {
    if (!year) return;
    if (!month) {
      onDateFrom(`${year}-01-01`);
      onDateTo(`${year}-12-31`);
      return;
    }
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    onDateFrom(`${year}-${month}-01`);
    onDateTo(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
  }

  return (
    <>
      <div className="field">
        <label>Month</label>
        <select className="input" value={selMonth} onChange={(e) => apply(e.target.value, selYear || String(years[0]))}>
          <option value="">Any month</option>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Year</label>
        <select className="input" value={selYear} onChange={(e) => apply(selMonth, e.target.value)}>
          <option value="">Any year</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </>
  );
}
