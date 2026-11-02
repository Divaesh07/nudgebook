import { gcalDelete, gcalUpsert } from "@/lib/gcal";
import { currentUser } from "@/lib/supabase/server";

/** { action: "done" | "dismiss" | "snooze", hours?: number }. Also called by push notification buttons. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/reminders/[id]">) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  const { action, hours } = await req.json().catch(() => ({}));

  // shortcut: snooze moves due_at, so a recurring item's next cycle shifts by the snooze; fine for day-level renewals.
  const snoozeHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 30);
  const patch =
    action === "done" ? { status: "done" }
    : action === "dismiss" ? { status: "dismissed" }
    : action === "snooze" ? { due_at: new Date(Date.now() + snoozeHours * 36e5).toISOString() }
    : null;
  if (!patch) return Response.json({ error: "Unknown action" }, { status: 400 });

  const { data: r, error } = await me.db.from("reminders").update(patch).eq("id", id).select().single();
  if (error) return Response.json({ error: "Not found" }, { status: 404 });

  if (action === "snooze") await gcalUpsert(me.userId, r);
  if (action === "dismiss") await gcalDelete(me.userId, r.gcal_event_id);
  if (action === "done" && r.recur) {
    // DB trigger spawned the next cycle; put it on the calendar too
    const { data: next } = await me.db
      .from("reminders").select()
      .eq("entry_id", r.entry_id).eq("status", "pending").is("gcal_event_id", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (next) await gcalUpsert(me.userId, next);
  }
  return Response.json({ ok: true, reminder: r });
}
