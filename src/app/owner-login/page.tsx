import type { Metadata } from "next";

import OwnerLoginForm from "@/components/owner/OwnerLoginForm";

export const metadata: Metadata = {
  title: "Admin sign in",
  description: "Sign in with the owner secret to manage CivicScribe.",
};

export const dynamic = "force-dynamic";

export default function OwnerLoginPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-3xl">Admin sign in</h1>
      <p className="mt-2 text-ink-soft">
        Enter the owner secret to manage meetings, schedules, and the public
        library. Public visitors can read and submit without signing in.
      </p>
      <div className="mt-8">
        <OwnerLoginForm />
      </div>
    </div>
  );
}
