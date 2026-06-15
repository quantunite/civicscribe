"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Signed-in staff navigation. A vertical left rail on desktop; a slide-in
// drawer (with a slim top bar) on mobile. Keeps the staff menu off the cramped
// top bar so there's more room to work.
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/library", label: "Library" },
  { href: "/topics", label: "Topics" },
  { href: "/schedules", label: "Schedules" },
  { href: "/study-notes", label: "Study Notes" },
  { href: "/search", label: "Search" },
  { href: "/review", label: "Review" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Dome() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h16" />
      <path d="M5 20v-7h14v7" />
      <path d="M7 13v7M12 13v7M17 13v7" />
      <path d="M5 13c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M12 6V3" />
    </svg>
  );
}

export default function StaffSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close the drawer after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function signOut() {
    setOpen(false);
    await Promise.allSettled([
      fetch("/api/logout", { method: "POST" }),
      fetch("/api/owner-logout", { method: "POST" }),
    ]);
    router.push("/");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `flex min-h-11 items-center rounded-md px-3 font-medium text-white ${
      isActive(pathname, href) ? "bg-white/15" : "hover:bg-white/10"
    }`;

  const nav = (
    <nav aria-label="Staff" className="flex h-full flex-col gap-1 p-4">
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-2 px-1 text-xl font-bold text-white focus-visible:outline-white"
      >
        <Dome />
        CivicScribe
      </Link>
      <span className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-white/55">
        Staff
      </span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className={linkClass(l.href)}
        >
          {l.label}
        </Link>
      ))}
      <Link
        href="/meetings/new"
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-white shadow-sm hover:bg-accent-strong"
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
      <button
        type="button"
        onClick={signOut}
        className="mt-auto flex min-h-11 items-center rounded-md px-3 text-left font-medium text-white hover:bg-white/10 focus-visible:outline-white"
      >
        Sign out
      </button>
    </nav>
  );

  return (
    <>
      {/* Mobile: slim top bar + drawer trigger */}
      <div className="flex items-center justify-between bg-primary px-4 py-3 text-white md:hidden">
        <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold">
          <Dome />
          CivicScribe
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="staff-drawer"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-white"
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
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {/* Mobile: drawer */}
      {open && (
        <div className="fixed inset-0 z-30 md:hidden" id="staff-drawer">
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 bg-primary shadow-xl">
            {nav}
          </div>
        </div>
      )}

      {/* Desktop: fixed left rail */}
      <aside className="hidden w-60 shrink-0 bg-primary md:block">
        <div className="sticky top-0 h-screen overflow-y-auto">{nav}</div>
      </aside>
    </>
  );
}
