import webpush from "web-push";
import { admin } from "./supabase/server";

let ready = false;

/** Sends to every device of the user; prunes dead subscriptions. Returns devices reached. */
export async function pushTo(userId: string, payload: object) {
  if (!ready) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    ready = true;
  }
  const db = admin();
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  const sent = await Promise.all(
    (subs ?? []).map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400 })
        .then(() => 1)
        .catch(async (e) => {
          if (e.statusCode === 404 || e.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
          else console.warn("push", e.statusCode, e.body);
          return 0;
        }),
    ),
  );
  return sent.reduce((a: number, b) => a + b, 0);
}
