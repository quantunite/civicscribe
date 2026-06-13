import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteNav from "@/components/dashboard/SiteNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CivicScribe",
    template: "%s · CivicScribe",
  },
  description:
    "Capture, transcribe, and summarize public meetings — a searchable archive of civic business with speaker-labeled transcripts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
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
            <SiteNav />
          </div>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-ink-soft sm:px-6">
            CivicScribe — a personal archive of public meetings, built accessibility-first.
          </div>
        </footer>
      </body>
    </html>
  );
}
