import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { gcalUpsert } from "./gcal";
import { parse } from "./parse";

export type Source = "text" | "voice" | "sms" | "share";

/** Parse a note and store entry (+ reminder). `db` is the user's client, or admin for webhooks. */
export async function addEntry(db: SupabaseClient, userId: string, raw: string, source: Source) {
  const text = raw.trim().slice(0, 4000);
  const { data: prof } = await db.from("profiles").select("timezone").eq("id", userId).single();
  const p = await parse(text, prof?.timezone ?? "UTC");
  if (p.ignore) return { ignored: true as const, via: p.via };

  const { data, error } = await db.rpc("add_entry", {
    p_user_id: userId,
    p_raw: text,
    p_source: source,
    p_title: p.title,
    p_category: p.category,
    p_happened_on: p.happened_on,
    p_due_date: p.due_date,
    p_due_time: p.due_time,
    p_recur: p.recur,
  });
  if (error) throw error;
  if (data.reminder) after(() => gcalUpsert(userId, data.reminder));
  return { ...data, via: p.via };
}
