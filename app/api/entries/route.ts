import { addEntry, type Source } from "@/lib/add";
import { gcalDelete } from "@/lib/gcal";
import { currentUser } from "@/lib/supabase/server";

const SOURCES = ["text", "voice", "share"];

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { text, source } = await req.json().catch(() => ({}));
  if (typeof text !== "string" || !text.trim()) return Response.json({ error: "Say or type something" }, { status: 400 });
  try {
    return Response.json(await addEntry(me.db, me.userId, text, (SOURCES.includes(source) ? source : "text") as Source));
  } catch (e) {
    console.error("add entry", e);
    return Response.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}

/** Undo / delete: also removes calendar events of its reminders. */
export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in first" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const { data: rems } = await me.db.from("reminders").select("gcal_event_id").eq("entry_id", id);
  const { error } = await me.db.from("entries").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await Promise.all((rems ?? []).map((r) => gcalDelete(me.userId, r.gcal_event_id)));
  return Response.json({ ok: true });
}
