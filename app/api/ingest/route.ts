import { addEntry } from "@/lib/add";
import { admin } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SMS / automation webhook. Auth: ?token=<ingest_token> or "Authorization: Bearer <token>".
 * Body: JSON {text|message|body|msg|content, from?} or plain text.
 * shortcut: no rate limit (token is a secret uuid); add one if tokens ever get shared.
 */
export async function POST(req: Request) {
  const token =
    new URL(req.url).searchParams.get("token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !UUID.test(token)) return Response.json({ error: "Bad token" }, { status: 401 });

  const raw = await req.text();
  let text: unknown = raw;
  let from = "";
  try {
    const j = JSON.parse(raw);
    text = j.text ?? j.message ?? j.body ?? j.msg ?? j.content ?? "";
    from = typeof j.from === "string" ? j.from : typeof j.sender === "string" ? j.sender : "";
  } catch {}
  if (typeof text !== "string" || !text.trim()) return Response.json({ error: "No text" }, { status: 400 });

  const db = admin();
  const { data: prof } = await db.from("profiles").select("id").eq("ingest_token", token).maybeSingle();
  if (!prof) return Response.json({ error: "Bad token" }, { status: 401 });

  try {
    const out = await addEntry(db, prof.id, (from ? `SMS from ${from.slice(0, 40)}: ` : "") + text.slice(0, 2000), "sms");
    if ("ignored" in out) return Response.json({ ignored: true });
    return Response.json({ ok: true, title: out.entry.title, due: out.reminder?.due_at ?? null });
  } catch (e) {
    console.error("ingest", e);
    return Response.json({ error: "Could not save" }, { status: 500 });
  }
}
