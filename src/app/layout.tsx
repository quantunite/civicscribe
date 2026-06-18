import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteNav from "@/components/dashboard/SiteNav";
import StaffSidebar from "@/components/dashboard/StaffSidebar";
import { getConfig } from "@/lib/config";
import { isStaff } from "@/lib/auth/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "CivicScribe";
const SITE_DESCRIPTION =
  "Capture, transcribe, and summarize public meetings: a searchable archive of civic business with speaker-labeled transcripts.";

// Site-wide metadata. metadataBase makes per-page relative OG/canonical URLs
// absolute; it comes from APP_BASE_URL (config.baseUrl) and falls back to
// localhost in dev. The defaults below are inherited by every page unless a
// route's generateMetadata overrides them.
export const metadata: Metadata = {
  metadataBase: new URL(getConfig().baseUrl),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

// Staff status is read per request (cookie), so the layout is never statically
// cached. Signed-in staff get a left sidebar; the public gets the top bar.
export const dynamic = "force-dynamic";

const FOOTER_TEXT = "© 2026 ATP Consulting LLC · CivicScribe";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isAdmin = await isStaff();

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        {isAdmin ? (
          // Signed-in staff: left vertical sidebar (mobile drawer) + content.
          <div className="flex min-h-screen flex-col md:flex-row">
            <StaffSidebar />
            <div className="page-canvas flex min-h-screen flex-1 flex-col">
              <main
                id="main-content"
                className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
              >
                {children}
              </main>
              <footer className="border-t border-line bg-surface">
                <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-ink-soft sm:px-6">
                  <span>{FOOTER_TEXT}</span>
                  <nav className="flex flex-wrap items-center gap-4">
                    <Link
                      href="/terms"
                      className="underline-offset-4 hover:text-ink hover:underline"
                    >
                      Terms
                    </Link>
                    <Link
                      href="/privacy"
                      className="underline-offset-4 hover:text-ink hover:underline"
                    >
                      Privacy
                    </Link>
                  </nav>
                </div>
              </footer>
            </div>
          </div>
        ) : (
          // Public: top bar.
          <div className="page-canvas flex min-h-screen flex-col">
            <header className="bg-primary text-white">
              <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center gap-3 rounded-md text-xl font-bold tracking-tight text-white focus-visible:outline-white"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-7 w-7 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {/* Simple civic dome mark */}
                    <path d="M4 20h16" />
                    <path d="M5 20v-7h14v7" />
                    <path d="M7 13v7M12 13v7M17 13v7" />
                    <path d="M5 13c0-3.9 3.1-7 7-7s7 3.1 7 7" />
                    <path d="M12 6V3" />
                  </svg>
                  CivicScribe
                </Link>
                <SiteNav isAdmin={false} />
              </div>
            </header>
            <main
              id="main-content"
              className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
            >
              {children}
            </main>
            <footer className="border-t border-line bg-surface">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-sm text-ink-soft sm:px-6">
                <span>{FOOTER_TEXT}</span>
                <nav className="flex flex-wrap items-center gap-4">
                  <Link
                    href="/terms"
                    className="underline-offset-4 hover:text-ink hover:underline"
                  >
                    Terms
                  </Link>
                  <Link
                    href="/privacy"
                    className="underline-offset-4 hover:text-ink hover:underline"
                  >
                    Privacy
                  </Link>
                  <Link
                    href="/login"
                    className="underline-offset-4 hover:text-ink hover:underline"
                  >
                    Sign in
                  </Link>
                </nav>
              </div>
            </footer>
          </div>
        )}
      </body>
    </html>
  );
}
