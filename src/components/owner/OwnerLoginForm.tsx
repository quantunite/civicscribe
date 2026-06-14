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
 *  so a crafted ?next= cannot bounce the admin off-site after login. */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

export default function OwnerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/owner-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        throw new Error(
          extractErrorMessage(payload) ??
            "That secret was not accepted. Check it and try again."
        );
      }
      const dest = safeNext(searchParams.get("next"));
      router.push(dest);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sign in failed. Try again.";
      setError(message);
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
        <label htmlFor="owner-secret" className={labelClass}>
          Owner secret
        </label>
        <input
          id="owner-secret"
          name="secret"
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "owner-secret-error" : undefined}
          className={inputClass}
        />
        {error && (
          <p
            id="owner-secret-error"
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
          disabled={submitting || secret.trim() === ""}
          className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-7 text-lg font-semibold text-white shadow-sm hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
