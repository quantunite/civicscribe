"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Sign-out control shown in the header when auth is enabled and active. */
export default function LogoutButton(): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex min-h-11 items-center rounded-md px-4 font-medium text-white hover:bg-white/10 focus-visible:outline-white disabled:opacity-60"
    >
      Sign out
    </button>
  );
}
