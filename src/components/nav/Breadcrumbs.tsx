// Shared breadcrumb trail. A server-safe presentational component (no "use
// client"): pure props, no state. Renders an ordered list inside a labelled
// <nav> so assistive tech announces the trail and its position. The final crumb
// is the current page (no link, aria-current="page"); earlier crumbs link back.

import Link from "next/link";

export interface Crumb {
  label: string;
  /** Omit href on the current (last) crumb so it renders as plain text. */
  href?: string;
}

const linkClass =
  "rounded font-medium text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950 hover:decoration-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg text-slate-700">
        {items.map((crumb, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-x-2">
              {i > 0 && (
                <span aria-hidden="true" className="text-slate-400">
                  /
                </span>
              )}
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className={linkClass}>
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="font-semibold text-slate-900"
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
