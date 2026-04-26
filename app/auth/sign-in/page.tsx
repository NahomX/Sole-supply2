"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const redirectTo =
      (process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin) +
      "/auth/callback";
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="max-w-sm mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold mb-3">Check your email</h1>
        <p className="text-sm text-neutral-600">
          We sent a magic sign-in link to <strong>{email}</strong>. Open it on
          this device to finish signing in.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-16">
      <h1 className="text-xl font-semibold mb-2">Sign in</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Enter your email. We&apos;ll send a one-tap link — no password needed.
      </p>
      <form onSubmit={sendLink} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full border border-neutral-300 rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !email}
          className="w-full px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send magic link"}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </form>
    </div>
  );
}
