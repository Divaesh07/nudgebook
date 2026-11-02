import { pushTo } from "@/lib/push";
import { admin, currentUser } from "@/lib/supabase/server";

/** Save this device's push subscription, then send a test push. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in first" }, { status: 401 });
  const sub = await req.json().catch(() => null);
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth)
    return Response.json({ error: "Bad subscription" }, { status: 400 });
  const { error } = await admin()
    .from("push_subscriptions")
    .upsert(
      { user_id: me.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      { onConflict: "endpoint" },
    );
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const sent = await pushTo(me.userId, { title: "Nudgebook is on", body: "Reminders will show up here.", url: "/" });
  return Response.json({ ok: true, sent });
}

export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({}));
  await me.db.from("push_subscriptions").delete().eq("endpoint", String(endpoint ?? ""));
  return Response.json({ ok: true });
}
