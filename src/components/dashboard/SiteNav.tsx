"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Meetings" },
  { href: "/search", label: "Search" },
] as const;

/** Primary site navigation. Client component so the current page gets
 *  aria-current + a visible active state. */
export default function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-2 sm:gap-4">
      <ul className="flex items-center gap-1 sm:gap-2">
        {LINKS.map(({ href, label }) => {
          const isCurrent =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isCurrent ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-md px-4 font-medium text-white focus-visible:outline-white ${
                  isCurrent
                    ? "bg-white/15 underline decoration-2 underline-offset-8"
                    : "hover:bg-white/10 hover:underline hover:decoration-2 hover:underline-offset-8"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href="/meetings/new"
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-white shadow-sm hover:bg-accent-strong focus-visible:outline-white"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add meeting
      </Link>
    </nav>
  );
}
