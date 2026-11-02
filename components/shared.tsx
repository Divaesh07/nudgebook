"use client";

import {
  Briefcase, Car, FileText, HeartPulse, House, Landmark, MessageSquare, Mic, Receipt, Repeat, Share2,
  ShieldCheck, Smartphone, Sparkles, Type, User, type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";

const never = () => () => {};
/** Browser-only value (location, clock…); `server` during prerender. */
export const useBrowser = <T,>(get: () => T, server: T, subscribe: (cb: () => void) => () => void = never) =>
  useSyncExternalStore(subscribe, get, () => server);

export type Entry = {
  id: string; title: string; raw_text: string; source: string; category: string; happened_on: string; created_at: string;
};
export type Reminder = {
  id: string; entry_id: string | null; title: string; due_at: string; recur: string | null; status: string;
};
export type Profile = {
  id: string; timezone: string; remind_hour: number; ingest_token: string; gcal_enabled: boolean;
};

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  insurance: ShieldCheck, recharge: Smartphone, bill: Receipt, vehicle: Car, health: HeartPulse,
  document: FileText, finance: Landmark, home: House, work: Briefcase, personal: User, other: Sparkles,
};
export const SOURCE_ICON: Record<string, LucideIcon> = { voice: Mic, sms: MessageSquare, share: Share2, text: Type };

export function CategoryBadge({ category }: { category: string }) {
  const Icon = CATEGORY_ICON[category] ?? Sparkles;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-primary" title={category}>
      <Icon className="size-5" aria-hidden />
      <span className="sr-only">{category}</span>
    </span>
  );
}

const DAY = 864e5;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const daysUntil = (iso: string) => Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / DAY);

/** "Today, 9:00 AM" · "Tomorrow" · "In 5 days · Sat, 7 Nov" · "3 days late" · "2 Nov 2027" */
export function fmtDue(iso: string) {
  const d = new Date(iso);
  const n = daysUntil(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", ...(n > 300 || n < -300 ? { year: "numeric" } : {}),
  });
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} late · ${date}`;
  if (n === 0) return `Today, ${time}`;
  if (n === 1) return `Tomorrow, ${time}`;
  if (n < 14) return `In ${n} days · ${date}`;
  return date;
}

export const fmtDay = (ymd: string) => {
  const n = daysUntil(ymd + "T12:00:00");
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  return new Date(ymd + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", ...(n < -300 ? { year: "numeric" } : {}),
  });
};

export const fmtRecur = (r: string | null) =>
  !r ? null
  : r === "1 year" || r === "1 yr" || r === "1 years" || r === "12 mons" ? "Yearly"
  : r === "1 mon" || r === "1 month" ? "Monthly"
  : `Every ${r.replace(/mons?\b/, "months").replace(/^(\d+) day$/, "$1 days")}`;

export function RecurBadge({ recur }: { recur: string | null }) {
  const label = fmtRecur(recur);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
      <Repeat className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
