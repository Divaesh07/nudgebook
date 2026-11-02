import { admin } from "./supabase/server";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
type Reminder = { id: string; title: string; due_at: string; gcal_event_id?: string | null };

async function token(userId: string) {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  const db = admin();
  const { data: p } = await db.from("profiles").select("gcal_enabled").eq("id", userId).single();
  if (!p?.gcal_enabled) return null;
  const { data } = await db.from("google_tokens").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return console.warn("gcal token", res.status), null;
  return (await res.json()).access_token as string;
}

/** Create or move the calendar event for a reminder (popups 7d / 1d / on time). Never throws. */
export async function gcalUpsert(userId: string, r: Reminder) {
  try {
    const t = await token(userId);
    if (!t) return;
    const start = new Date(r.due_at);
    const res = await fetch(r.gcal_event_id ? `${API}/${r.gcal_event_id}` : API, {
      method: r.gcal_event_id ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: r.title,
        description: "Added by Nudgebook",
        start: { dateTime: start.toISOString() },
        end: { dateTime: new Date(start.getTime() + 30 * 60e3).toISOString() },
        reminders: { useDefault: false, overrides: [10080, 1440, 0].map((minutes) => ({ method: "popup", minutes })) },
      }),
    });
    if (!res.ok) return console.warn("gcal upsert", res.status, await res.text());
    if (!r.gcal_event_id) await admin().from("reminders").update({ gcal_event_id: (await res.json()).id }).eq("id", r.id);
  } catch (e) {
    console.warn("gcal upsert", e);
  }
}

export async function gcalDelete(userId: string, eventId?: string | null) {
  if (!eventId) return;
  try {
    const t = await token(userId);
    if (t) await fetch(`${API}/${eventId}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } });
  } catch (e) {
    console.warn("gcal delete", e);
  }
}
