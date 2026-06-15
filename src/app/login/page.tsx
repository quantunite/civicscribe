import type { Metadata } from "next";

import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage CivicScribe.",
};

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-3xl">Sign in</h1>
      <p className="mt-2 text-ink-soft">
        Sign in to manage meetings, schedules, and the public library. Public
        visitors can read and submit without signing in.
      </p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </div>
  );
}
