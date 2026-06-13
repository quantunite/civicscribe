"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({
  next,
}: {
  next: string;
}): React.ReactElement {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      if (res.ok) {
        const data = (await res.json()) as { next?: string };
        router.push(data.next ?? "/");
        router.refresh();
        return;
      }
      setError("Incorrect password. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="font-semibold">
          Access password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-line-strong bg-surface px-4 py-3 text-base"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>

      {error ? (
        <p id="login-error" role="alert" className="font-medium text-accent-strong">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-strong focus-visible:outline-white disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
