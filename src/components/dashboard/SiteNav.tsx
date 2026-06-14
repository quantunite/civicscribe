"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Links every visitor sees. /library is the public entry point into the
// curated library; / remains the operator dashboard.
const PUBLIC_LINKS = [
  { href: "/", label: "Meetings" },
  { href: "/library", label: "Library" },
  { href: "/crash-course", label: "Crash Course Corner" },
  { href: "/search", label: "Search" },
] as const;

// Admin-only links (Schedules + the moderation queue are admin-gated routes).
const ADMIN_LINKS = [
  { href: "/schedules", label: "Schedules" },
  { href: "/review", label: "Review" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Primary site navigation. Inline on desktop; collapses to a disclosure menu
 *  on mobile so the links + CTA never overflow a narrow viewport. The Review +
 *  Schedules links and the sign-out control render only for the admin. */
export default function SiteNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = isAdmin ? [...PUBLIC_LINKS, ...ADMIN_LINKS] : PUBLIC_LINKS;

  async function signOut() {
    setOpen(false);
    try {
      await fetch("/api/owner-logout", { method: "POST" });
    } catch {
      // Best-effort: a failed network call still drops the client-side menu.
    }
    router.push("/");
    router.refresh();
  }

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

  const signOutClass =
    "inline-flex min-h-11 items-center rounded-md px-4 font-medium text-white hover:bg-white/10 hover:underline hover:decoration-2 hover:underline-offset-8 focus-visible:outline-white";

  return (
    <nav aria-label="Primary" className="flex items-center">
      {/* Desktop: inline links + CTA */}
      <ul className="hidden items-center gap-1 md:flex lg:gap-2">
        {links.map(({ href, label }) => (
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
        {isAdmin && (
          <li>
            <button type="button" onClick={signOut} className={signOutClass}>
              Sign out
            </button>
          </li>
        )}
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
            {links.map(({ href, label }) => (
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
            {isAdmin && (
              <li>
                <button
                  type="button"
                  onClick={signOut}
                  className="flex min-h-11 w-full items-center rounded-md px-4 font-medium text-white hover:bg-white/10"
                >
                  Sign out
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </nav>
  );
}
