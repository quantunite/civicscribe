"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const inputClass =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink shadow-sm placeholder:text-ink-soft/70";
const labelClass = "block font-semibold text-ink";

function extractErrorMessage(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return null;
}

/** Safe internal redirect target: only same-origin absolute paths are honored
 *  so a crafted ?next= cannot bounce the user off-site after login. */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

/** Email + password sign-in. Posts to /api/login, which sets the cs-session
 *  cookie. Reusable: rendered on /login and (later) the home page sign-in. */
export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        throw new Error(
          extractErrorMessage(payload) ??
            "Sign in failed. Check your email and password."
        );
      }
      const dest = safeNext(searchParams.get("next"));
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8"
    >
      <div>
        <label htmlFor="login-email" className={labelClass}>
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="login-password" className={labelClass}>
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className={inputClass}
        />
        {error && (
          <p
            id="login-error"
            role="alert"
            className="mt-2 text-sm font-medium text-red-800"
          >
            {error}
          </p>
        )}
      </div>

      <div className="mt-8">
        <button
          type="submit"
          disabled={submitting || email.trim() === "" || password === ""}
          className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-7 text-lg font-semibold text-white shadow-sm hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
