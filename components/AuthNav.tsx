import Link from "next/link";
import { getSessionInfo } from "@/lib/auth";

export async function AuthNav() {
  const session = await getSessionInfo();

  if (!session) {
    return (
      <Link
        href="/auth/sign-in"
        className="text-sm text-neutral-600 hover:text-neutral-900"
      >
        Sign in
      </Link>
    );
  }

  const role = session.profile?.role ?? "customer";

  return (
    <div className="flex items-center gap-4 text-sm text-neutral-600">
      {(role === "admin" || role === "submitter") && (
        <Link href="/submit" className="hover:text-neutral-900">
          Submit
        </Link>
      )}
      {role === "admin" && (
        <Link href="/admin" className="hover:text-neutral-900">
          Admin
        </Link>
      )}
      <span className="text-neutral-400">·</span>
      <span className="text-neutral-500 hidden sm:inline">{session.email}</span>
      <form action="/auth/sign-out" method="post">
        <button type="submit" className="hover:text-neutral-900">
          Sign out
        </button>
      </form>
    </div>
  );
}
