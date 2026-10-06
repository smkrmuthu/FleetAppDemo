import { useEffect, useRef, useState } from 'react';

// A horizontally-scrolling box for a wide table with a second scrollbar along
// the top (kept in step with the one underneath), so a long list can be
// scrolled sideways without first scrolling down to its bottom edge. The top
// bar only appears when the table is actually wider than the box.
export function DualScroll({ children }: { children: React.ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const echo = useRef(false);
  const [contentWidth, setContentWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      setContentWidth(body.scrollWidth);
      setOverflowing(body.scrollWidth > body.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    return () => observer.disconnect();
  }, []);

  // Moving one bar moves the other; `echo` swallows the scroll event that
  // the second move itself causes, so they can't chase each other.
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (echo.current) { echo.current = false; return; }
    if (!from || !to || from.scrollLeft === to.scrollLeft) return;
    echo.current = true;
    to.scrollLeft = from.scrollLeft;
  };

  return (
    <div>
      <div
        ref={topRef}
        className="scroll-top"
        aria-hidden="true"
        style={{ display: overflowing ? 'block' : 'none' }}
        onScroll={() => follow(topRef.current, bodyRef.current)}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      <div
        ref={bodyRef}
        className="scroll-x scroll-body"
        style={{ border: '2px solid var(--color-divider)' }}
        onScroll={() => follow(bodyRef.current, topRef.current)}
      >
        {children}
      </div>
    </div>
  );
}
