import { createBrowserClient } from "@supabase/ssr";

export const supabase = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

/** Google sign-in that also grants Calendar access (refresh token saved in /auth/callback). */
export const googleSignIn = (next = "/") =>
  supabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: "https://www.googleapis.com/auth/calendar.events",
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
