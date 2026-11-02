"use client";

import { Bell, BookOpen, Check, Clock, Home, Search, Settings as Cog, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Capture } from "./capture";
import { Settings } from "./settings";
import {
  api, CategoryBadge, useBrowser, daysUntil, fmtDay, fmtDue, json, RecurBadge, SOURCE_ICON,
  type Entry, type Profile, type Reminder,
} from "./shared";

const TABS = [
  { id: "today", label: "Today", icon: Home },
  { id: "log", label: "Log", icon: BookOpen },
  { id: "upcoming", label: "Upcoming", icon: Bell },
  { id: "settings", label: "Settings", icon: Cog },
] as const;
type Tab = (typeof TABS)[number]["id"];

type Saved = { entry: Entry; reminder: Reminder | null };

export function App() {
  const hash = useBrowser(() => location.hash.slice(1), "", (cb) => {
    addEventListener("hashchange", cb);
    return () => removeEventListener("hashchange", cb);
  });
  const tab: Tab = TABS.some((t) => t.id === hash) ? (hash as Tab) : "today";
  const today = useBrowser(() => new Date().toLocaleDateString("en-CA"), null);
  const dateLabel = useBrowser(() => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }), "");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [last, setLast] = useState<Saved | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const db = supabase();
    const [e, r, p] = await Promise.all([
      db.from("entries").select("id,title,raw_text,source,category,happened_on,created_at").order("happened_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
      db.from("reminders").select("id,entry_id,title,due_at,recur,status").eq("status", "pending").order("due_at"),
      db.from("profiles").select("id,timezone,remind_hour,ingest_token,gcal_enabled").single(),
    ]);
    setEntries(e.data ?? []);
    setReminders(r.data ?? []);
    if (p.data) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (p.data.timezone !== tz) await db.from("profiles").update({ timezone: tz }).eq("id", p.data.id);
      setProfile({ ...p.data, timezone: tz });
    }
  }, []);

  const add = useCallback(async (text: string, source: "text" | "voice" | "share") => {
    const out = await api<Saved & { ignored?: boolean }>("/api/entries", json("POST", { text, source }));
    if (out.ignored) return setNotice("Looks like an OTP or promo, so it wasn't saved.");
    setNotice("");
    setLast(out);
    load(); // pick up auto-closed reminders too
  }, [load]);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js", { scope: "/", updateViaCache: "none" });
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- async fetch on mount; state set after await
    addEventListener("focus", load);

    // Android share target: /?text=...
    const q = new URLSearchParams(location.search);
    const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join(" ").trim();
    if (shared) {
      history.replaceState(null, "", "/");
      add(shared, "share").catch((e) => setNotice(e.message));
    }
    return () => {
      removeEventListener("focus", load);
    };
  }, [load, add]);

  const go = (t: Tab) => {
    history.replaceState(null, "", t === "today" ? "/" : `#${t}`);
    dispatchEvent(new HashChangeEvent("hashchange"));
    scrollTo({ top: 0 });
  };

  async function act(r: Reminder, action: "done" | "dismiss" | "snooze") {
    setReminders((rs) => rs.filter((x) => x.id !== r.id));
    try {
      await api(`/api/reminders/${r.id}`, json("PATCH", { action, hours: 24 }));
    } finally {
      load();
    }
  }

  async function remove(id: string) {
    setEntries((es) => es?.filter((e) => e.id !== id) ?? null);
    setReminders((rs) => rs.filter((r) => r.entry_id !== id));
    if (last?.entry.id === id) setLast(null);
    await api(`/api/entries?id=${id}`, { method: "DELETE" }).finally(load);
  }

  const dueSoon = reminders.filter((r) => daysUntil(r.due_at) <= 7);
  const overdue = reminders.filter((r) => daysUntil(r.due_at) < 0).length;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-28 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-primary">Nudgebook</h1>
        <p className="text-sm text-fg-muted">
          {dateLabel}
        </p>
      </header>

      <main className="flex-1">
        {tab === "today" && (
          <div className="flex flex-col gap-8">
            <div>
              <p className="mb-6 text-center font-display text-3xl font-semibold leading-tight tracking-tight">
                What did you get done?
              </p>
              <Capture onSubmit={add} />
              {notice && <p className="mt-3 text-sm text-fg-muted" aria-live="polite">{notice}</p>}
              {last && <SavedCard saved={last} onUndo={() => remove(last.entry.id)} onClose={() => setLast(null)} />}
            </div>

            <Section title="Due this week" empty="Nothing due this week. Nice." loading={!entries}>
              {dueSoon.map((r) => <ReminderRow key={r.id} r={r} onAct={act} />)}
            </Section>

            <Section title="Today" empty="Nothing logged yet today." loading={!entries}>
              {entries?.filter((e) => e.happened_on === today).map((e) => <EntryRow key={e.id} e={e} onDelete={remove} />)}
            </Section>
          </div>
        )}

        {tab === "log" && <Log entries={entries} onDelete={remove} />}

        {tab === "upcoming" && <Upcoming reminders={reminders} loading={!entries} onAct={act} />}

        {tab === "settings" && (profile
          ? <Settings profile={profile} onProfile={(p) => setProfile({ ...profile, ...p })} />
          : <Skeleton />)}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                onClick={() => go(id)}
                aria-current={tab === id ? "page" : undefined}
                className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${tab === id ? "text-primary" : "text-fg-muted hover:text-fg"}`}
              >
                <Icon className="size-6" aria-hidden strokeWidth={tab === id ? 2.4 : 1.8} />
                {label}
                {id === "upcoming" && overdue > 0 && (
                  <span className="absolute right-[calc(50%-1.4rem)] top-2.5 min-w-5 rounded-full bg-danger px-1 text-[11px] leading-5 text-white">
                    {overdue}<span className="sr-only"> overdue</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function Section({ title, empty, loading, children }: { title: string; empty: string; loading?: boolean; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold">{title}</h2>
      {loading ? <Skeleton /> : has ? <ul className="flex flex-col gap-2">{children}</ul> : <p className="rounded-2xl bg-muted px-4 py-5 text-sm text-fg-muted">{empty}</p>}
    </section>
  );
}

const Skeleton = () => (
  <div className="flex flex-col gap-2" aria-hidden>
    {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
  </div>
);

function SavedCard({ saved, onUndo, onClose }: { saved: Saved; onUndo: () => void; onClose: () => void }) {
  const { entry, reminder } = saved;
  return (
    <div role="status" className="animate-rise mt-5 flex gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <CategoryBadge category={entry.category} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ok"><Check className="size-3.5" aria-hidden /> Saved</p>
        <p className="mt-0.5 font-semibold">{entry.title}</p>
        {reminder ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-1"><Bell className="size-3.5" aria-hidden /> {fmtDue(reminder.due_at)}</span>
            <RecurBadge recur={reminder.recur} />
          </p>
        ) : (
          <p className="mt-1 text-sm text-fg-muted">Logged. No reminder needed.</p>
        )}
      </div>
      <div className="flex flex-col">
        <button onClick={onClose} aria-label="Dismiss" className="grid size-11 place-items-center rounded-xl text-fg-muted hover:bg-muted"><X className="size-4" aria-hidden /></button>
        <button onClick={onUndo} aria-label="Undo save" className="grid size-11 place-items-center rounded-xl text-fg-muted hover:bg-muted"><Undo2 className="size-4" aria-hidden /></button>
      </div>
    </div>
  );
}

function ReminderRow({ r, onAct }: { r: Reminder; onAct: (r: Reminder, a: "done" | "dismiss" | "snooze") => void }) {
  const late = daysUntil(r.due_at) < 0;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-surface py-2 pl-4 pr-2">
      <div className="min-w-0 flex-1 py-1">
        <p className="truncate font-medium">{r.title}</p>
        <p className={`mt-0.5 flex flex-wrap items-center gap-2 text-sm ${late ? "font-medium text-danger" : "text-fg-muted"}`}>
          {fmtDue(r.due_at)} <RecurBadge recur={r.recur} />
        </p>
      </div>
      <button onClick={() => onAct(r, "snooze")} aria-label={`Snooze ${r.title} by a day`} title="Tomorrow"
        className="grid size-11 place-items-center rounded-xl text-fg-muted hover:bg-muted"><Clock className="size-5" aria-hidden /></button>
      <button onClick={() => onAct(r, "done")} aria-label={`Mark ${r.title} done`} title="Done"
        className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent hover:opacity-80"><Check className="size-5" aria-hidden /></button>
    </li>
  );
}

function EntryRow({ e, onDelete }: { e: Entry; onDelete: (id: string) => void }) {
  const Src = SOURCE_ICON[e.source] ?? SOURCE_ICON.text;
  return (
    <li className="group flex items-start gap-3 rounded-2xl border border-border bg-surface p-3">
      <CategoryBadge category={e.category} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{e.title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted">
          <Src className="mr-1 inline size-3.5 align-[-2px]" aria-label={`via ${e.source}`} />
          {e.raw_text}
        </p>
      </div>
      <button onClick={() => confirm(`Delete "${e.title}" and its reminders?`) && onDelete(e.id)} aria-label={`Delete ${e.title}`}
        className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-muted hover:bg-muted hover:text-danger">
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

function Log({ entries, onDelete }: { entries: Entry[] | null; onDelete: (id: string) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, Entry[]>();
    for (const e of entries ?? []) {
      if (needle && !`${e.title} ${e.raw_text} ${e.category}`.toLowerCase().includes(needle)) continue;
      m.set(e.happened_on, [...(m.get(e.happened_on) ?? []), e]);
    }
    return [...m];
  }, [entries, q]);

  return (
    <div className="flex flex-col gap-6">
      <label className="relative block">
        <span className="sr-only">Search your log</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search: insurance, recharge…"
          className="h-12 w-full rounded-2xl border border-border bg-surface pl-11 pr-4 text-base" />
      </label>
      {!entries ? <Skeleton /> : groups.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-5 text-sm text-fg-muted">{q ? "No matches." : "Your log is empty. Add your first entry from Today."}</p>
      ) : groups.map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold text-fg-muted">{fmtDay(day)}</h2>
          <ul className="flex flex-col gap-2">{list.map((e) => <EntryRow key={e.id} e={e} onDelete={onDelete} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function Upcoming({ reminders, loading, onAct }: { reminders: Reminder[]; loading: boolean; onAct: (r: Reminder, a: "done" | "dismiss" | "snooze") => void }) {
  const buckets = [
    { title: "Overdue", items: reminders.filter((r) => daysUntil(r.due_at) < 0) },
    { title: "This week", items: reminders.filter((r) => { const d = daysUntil(r.due_at); return d >= 0 && d <= 7; }) },
    { title: "This month", items: reminders.filter((r) => { const d = daysUntil(r.due_at); return d > 7 && d <= 31; }) },
    { title: "Later", items: reminders.filter((r) => daysUntil(r.due_at) > 31) },
  ].filter((b) => b.items.length);

  if (loading) return <Skeleton />;
  if (!buckets.length) return <p className="rounded-2xl bg-muted px-4 py-5 text-sm text-fg-muted">No reminders yet. Say something like &ldquo;Renewed bike insurance today&rdquo;.</p>;
  return (
    <div className="flex flex-col gap-6">
      {buckets.map((b) => (
        <section key={b.title}>
          <h2 className={`mb-2 text-sm font-semibold ${b.title === "Overdue" ? "text-danger" : "text-fg-muted"}`}>{b.title}</h2>
          <ul className="flex flex-col gap-2">{b.items.map((r) => <ReminderRow key={r.id} r={r} onAct={onAct} />)}</ul>
        </section>
      ))}
    </div>
  );
}
