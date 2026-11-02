import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function serverClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {} // called from a context that can't set cookies; proxy refreshes the session
      },
    },
  });
}

/** Returns { db, userId } or null when not signed in. */
export async function currentUser() {
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { db, userId } : null;
}

/** Service role: bypasses RLS. Server only. */
export const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
