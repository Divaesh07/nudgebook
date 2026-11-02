import { NextResponse } from "next/server";
import { admin, serverClient } from "@/lib/supabase/server";

/** OAuth / email-link landing. Keeps Google's refresh token for Calendar sync. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  if (code) {
    const { data, error } = await (await serverClient()).auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url));
    const refresh = data.session?.provider_refresh_token;
    if (refresh && data.user) {
      const db = admin();
      await db.from("google_tokens").upsert({ user_id: data.user.id, refresh_token: refresh, updated_at: new Date().toISOString() });
      await db.from("profiles").update({ gcal_enabled: true }).eq("id", data.user.id);
    }
  }
  return NextResponse.redirect(new URL(next, url));
}
