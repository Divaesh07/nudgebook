"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useBrowser } from "@/components/shared";
import { googleSignIn, supabase } from "@/lib/supabase/client";

const nextPath = () => {
  const n = new URLSearchParams(location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
};

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")), password = String(f.get("password"));
    setBusy(true);
    setMsg(null);
    const db = supabase();
    const { data, error } =
      mode === "in"
        ? await db.auth.signInWithPassword({ email, password })
        : await db.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setBusy(false);
    if (error) return setMsg({ text: error.message, bad: true });
    if (!data.session) return setMsg({ text: "Check your inbox to confirm your email, then sign in." });
    location.replace(nextPath());
  }

  const err = useBrowser(() => new URLSearchParams(location.search).get("error"), null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-primary">Nudgebook</h1>
      <p className="mt-2 text-fg-muted">Log what you did. Get nudged when it&apos;s due again.</p>

      <button
        type="button"
        onClick={() => googleSignIn(nextPath())}
        className="mt-10 flex h-12 items-center justify-center gap-3 rounded-xl border border-border bg-surface font-medium transition-colors hover:bg-muted"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </button>
      <p className="mt-2 text-center text-xs text-fg-muted">Google also syncs reminders to your Calendar.</p>

      <div className="my-6 flex items-center gap-3 text-xs text-fg-muted">
        <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <input name="email" type="email" required autoComplete="email"
            className="h-12 rounded-xl border border-border bg-surface px-4 text-base font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input name="password" type="password" required minLength={6}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            className="h-12 rounded-xl border border-border bg-surface px-4 text-base font-normal" />
        </label>
        <button disabled={busy}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-on-primary transition-opacity disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p role="status" aria-live="polite" className={`mt-4 min-h-5 text-sm ${msg?.bad || err ? "text-danger" : "text-ok"}`}>
        {msg?.text ?? err}
      </p>

      <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")}
        className="mt-2 h-11 text-sm text-fg-muted underline-offset-4 hover:underline">
        {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </main>
  );
}
