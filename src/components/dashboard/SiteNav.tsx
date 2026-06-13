"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Meetings" },
  { href: "/crash-course", label: "Crash Course Corner" },
  { href: "/schedules", label: "Schedules" },
  { href: "/search", label: "Search" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Primary site navigation. Inline on desktop; collapses to a disclosure menu
 *  on mobile so the links + CTA never overflow a narrow viewport. */
export default function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the menu after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const linkClass = (href: string) =>
    `inline-flex min-h-11 items-center rounded-md px-4 font-medium text-white focus-visible:outline-white ${
      isActive(pathname, href)
        ? "bg-white/15 underline decoration-2 underline-offset-8"
        : "hover:bg-white/10 hover:underline hover:decoration-2 hover:underline-offset-8"
    }`;

  const cta =
    "inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-white shadow-sm hover:bg-accent-strong focus-visible:outline-white";

  return (
    <nav aria-label="Primary" className="flex items-center">
      {/* Desktop: inline links + CTA */}
      <ul className="hidden items-center gap-1 md:flex lg:gap-2">
        {LINKS.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={linkClass(href)}
            >
              {label}
            </Link>
          </li>
        ))}
        <li className="ml-2">
          <Link href="/meetings/new" className={cta}>
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
        </li>
      </ul>

      {/* Mobile: hamburger toggle */}
      <button
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-white hover:bg-white/10 focus-visible:outline-white md:hidden"
        aria-expanded={open}
        aria-controls="primary-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {/* Mobile: dropdown panel */}
      {open && (
        <div
          id="primary-menu"
          className="absolute left-0 right-0 top-full z-20 border-t border-white/15 bg-primary px-4 py-3 shadow-lg md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(pathname, href) ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-md px-4 font-medium text-white ${
                    isActive(pathname, href)
                      ? "bg-white/15"
                      : "hover:bg-white/10"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
            <li className="mt-2">
              <Link href="/meetings/new" className={`${cta} w-full justify-center`}>
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
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}
