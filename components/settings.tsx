"use client";

import { Bell, CalendarDays, Check, Copy, LogOut, MessageSquare, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { googleSignIn, supabase } from "@/lib/supabase/client";
import { api, json, type Profile } from "./shared";

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

function Card({ icon: Icon, title, children }: { icon: typeof Bell; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <Icon className="size-5 text-primary" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

const btn = "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 font-medium transition-colors";

export function Settings({ profile, onProfile }: { profile: Profile; onProfile: (p: Partial<Profile>) => void }) {
  // Settings mounts only after data loads in the browser, so reading navigator here is safe.
  const [push, setPush] = useState<"unsupported" | "ios-install" | "off" | "on" | "busy">(() =>
    /iPhone|iPad/.test(navigator.userAgent) && !matchMedia("(display-mode: standalone)").matches ? "ios-install"
    : !("serviceWorker" in navigator) || !("PushManager" in window) ? "unsupported"
    : "off");
  const [pushMsg, setPushMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const origin = location.origin;

  useEffect(() => {
    if (push !== "off") return;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => s && setPush("on"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial check only

  async function enablePush() {
    setPush("busy");
    setPushMsg("");
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked in browser settings.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      await api("/api/push", json("POST", sub.toJSON()));
      setPush("on");
      setPushMsg("Done. A test notification is on its way.");
    } catch (e) {
      setPush("off");
      setPushMsg((e as Error).message);
    }
  }

  async function disablePush() {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await api("/api/push", json("DELETE", { endpoint: sub.endpoint }));
      await sub.unsubscribe();
    }
    setPush("off");
  }

  const save = async (patch: Partial<Profile>) => {
    onProfile(patch);
    await supabase().from("profiles").update(patch).eq("id", profile.id);
  };

  const hook = `${origin}/api/ingest?token=${profile.ingest_token}`;

  return (
    <div className="flex flex-col gap-4">
      <Card icon={Bell} title="Notifications">
        <p className="text-sm text-fg-muted">Pings 7 days before, 1 day before, and on the day.</p>
        {push === "ios-install" ? (
          <p className="mt-3 rounded-xl bg-muted p-3 text-sm">
            On iPhone, tap <b>Share → Add to Home Screen</b>, open Nudgebook from there, then turn notifications on.
          </p>
        ) : push === "unsupported" ? (
          <p className="mt-3 text-sm text-danger">This browser can&apos;t do push notifications.</p>
        ) : (
          <button
            onClick={push === "on" ? disablePush : enablePush}
            disabled={push === "busy"}
            className={`${btn} mt-3 w-full ${push === "on" ? "border border-border hover:bg-muted" : "bg-primary text-on-primary"} disabled:opacity-50`}
          >
            {push === "on" ? <><Check className="size-4" aria-hidden /> On for this device · turn off</> : "Turn on notifications"}
          </button>
        )}
        {pushMsg && <p className="mt-2 text-sm" aria-live="polite">{pushMsg}</p>}

        <label className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span>Default reminder time</span>
          <select
            value={profile.remind_hour}
            onChange={(e) => save({ remind_hour: Number(e.target.value) })}
            className="h-11 rounded-xl border border-border bg-surface px-3"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}</option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-fg-muted">Timezone: {profile.timezone} (from this device)</p>
      </Card>

      <Card icon={CalendarDays} title="Google Calendar">
        <p className="text-sm text-fg-muted">Each reminder becomes a Calendar event with phone alerts.</p>
        {profile.gcal_enabled ? (
          <label className="mt-3 flex h-11 items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ok"><Check className="size-4" aria-hidden /> Connected</span>
            <button onClick={() => save({ gcal_enabled: false })} className={`${btn} border border-border hover:bg-muted`}>
              Pause sync
            </button>
          </label>
        ) : (
          <button onClick={() => googleSignIn("/#settings")} className={`${btn} mt-3 w-full border border-border hover:bg-muted`}>
            Connect Google Calendar
          </button>
        )}
      </Card>

      <Card icon={MessageSquare} title="Auto-add from SMS">
        <p className="text-sm text-fg-muted">
          Forward texts like &ldquo;Recharge successful&rdquo; to this private link. OTPs and promos get ignored.
        </p>
        <div className="mt-3 flex gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-3 text-xs" title={hook}>{hook}</code>
          <button
            aria-label="Copy webhook link"
            onClick={() => navigator.clipboard.writeText(hook).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
            className={`${btn} w-11 border border-border px-0 hover:bg-muted`}
          >
            {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
          <button
            aria-label="Make a new link (old one stops working)"
            onClick={() => confirm("Make a new link? The old one stops working.") && save({ ingest_token: crypto.randomUUID() })}
            className={`${btn} w-11 border border-border px-0 hover:bg-muted`}
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer py-2 font-medium">Android setup</summary>
          <ol className="ml-5 list-decimal space-y-1 text-fg-muted">
            <li>Install an SMS-to-webhook app, e.g. <b>SMS Forwarder</b> (open source) or <b>MacroDroid</b>.</li>
            <li>Add a rule: message contains <i>recharge, renew, premium, due, paid, booked</i>.</li>
            <li>Action: HTTP POST to the link above, JSON body <code>{`{"text":"%body%","from":"%sender%"}`}</code>.</li>
            <li>Or just long-press any SMS → Share → Nudgebook.</li>
          </ol>
        </details>
        <details className="text-sm">
          <summary className="cursor-pointer py-2 font-medium">iPhone setup</summary>
          <ol className="ml-5 list-decimal space-y-1 text-fg-muted">
            <li>Shortcuts → Automation → <b>Message</b> → &ldquo;Message contains&rdquo; recharge (one per keyword).</li>
            <li>Choose <b>Run Immediately</b>.</li>
            <li>Add action <b>Get Contents of URL</b>: the link above, Method POST, JSON body key <code>text</code> = Shortcut Input → Message content.</li>
          </ol>
        </details>
      </Card>

      <button
        onClick={() => supabase().auth.signOut().then(() => location.replace("/login"))}
        className={`${btn} mt-2 text-danger hover:bg-muted`}
      >
        <LogOut className="size-4" aria-hidden /> Sign out
      </button>
    </div>
  );
}
