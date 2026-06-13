import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  // No password configured → nothing to sign in to.
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const { next } = await searchParams;
  const target =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl">Sign in</h1>
        <p className="text-ink-soft">
          This CivicScribe archive is private. Enter the access password to
          continue.
        </p>
      </div>
      <LoginForm next={target} />
    </div>
  );
}
