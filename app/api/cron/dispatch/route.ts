import { timingSafeEqual } from "node:crypto";
import { pushTo } from "@/lib/push";
import { todayIn } from "@/lib/rules";
import { admin } from "@/lib/supabase/server";

const authorized = (req: Request) => {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  return !!process.env.CRON_SECRET && got.length === want.length && timingSafeEqual(got, want);
};

function when(dueAt: string, tz: string) {
  const due = new Date(dueAt);
  const days = Math.round((Date.parse(todayIn(tz, due)) - Date.parse(todayIn(tz))) / 864e5);
  const time = due.toLocaleTimeString("en", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const date = due.toLocaleDateString("en", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  return days <= 0 ? `Due today, ${time}` : days === 1 ? `Due tomorrow, ${time}` : `Due in ${days} days · ${date}`;
}

type Row = { reminder_id: string; user_id: string; title: string; due_at: string; timezone: string };

/** Called every minute by pg_cron. Sends due pings (claimed once: at-most-once delivery). */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await admin().rpc("claim_due_pings");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Row[];
  await Promise.all(
    rows.map((r) =>
      pushTo(r.user_id, {
        title: r.title,
        body: when(r.due_at, r.timezone),
        url: "/#upcoming",
        reminderId: r.reminder_id,
        tag: r.reminder_id,
      }),
    ),
  );
  return Response.json({ sent: rows.length });
}
