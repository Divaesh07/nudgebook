"use client";

import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./shared";

type Phase = "idle" | "recording" | "transcribing" | "saving";
type SpeechCtor = new () => {
  lang: string; interimResults: boolean; start(): void; stop(): void;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error: string }) => void; onend: () => void;
};

const MAX_MS = 60_000;

/** Big mic + text box. Voice: Deepgram → Groq Whisper (server) → device speech recognition → typing. */
export function Capture({ onSubmit }: { onSubmit: (text: string, source: "text" | "voice") => Promise<void> }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const deviceStt = useRef(false); // flips on when server STT fails

  useEffect(() => {
    if (phase !== "recording") return;
    const t0 = Date.now();
    const id = setInterval(() => {
      setSecs(Math.floor((Date.now() - t0) / 1000));
      if (Date.now() - t0 > MAX_MS) rec.current?.stop();
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  async function send(value: string, source: "text" | "voice") {
    if (!value.trim()) return;
    setPhase("saving");
    setError("");
    try {
      await onSubmit(value, source);
      setText("");
    } catch (e) {
      setText(value);
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  function deviceSpeech() {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return setError("Voice isn't available on this device. Type it instead.");
    const r = new Ctor();
    r.lang = navigator.language;
    r.interimResults = false;
    let heard = "";
    r.onresult = (e) => (heard = Array.from(e.results).map((x) => x[0].transcript).join(" "));
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Mic blocked. Allow it in browser settings." : "Didn't catch that.");
    r.onend = () => (heard ? (setText(heard), send(heard, "voice")) : setPhase("idle"));
    rec.current = { stop: () => r.stop() } as MediaRecorder;
    setPhase("recording");
    r.start();
  }

  async function start() {
    setError("");
    navigator.vibrate?.(10);
    if (deviceStt.current || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return deviceSpeech();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError("Mic blocked. Allow microphone access, or type instead.");
    }
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      if (blob.size < 1000) return setPhase("idle");
      setPhase("transcribing");
      try {
        const { text: heard } = await api<{ text: string }>("/api/transcribe", {
          method: "POST", headers: { "Content-Type": blob.type }, body: blob,
        });
        setText(heard);
        await send(heard, "voice");
      } catch (e) {
        deviceStt.current = true;
        setPhase("idle");
        setError(`${(e as Error).message} Tap the mic to try device voice.`);
      }
    };
    rec.current = r;
    setSecs(0);
    setPhase("recording");
    r.start();
  }

  const stop = () => {
    navigator.vibrate?.(10);
    rec.current?.stop();
  };

  const busy = phase === "transcribing" || phase === "saving";
  const status =
    phase === "recording" ? `Listening… ${secs}s · tap to stop`
    : phase === "transcribing" ? "Turning speech into text…"
    : phase === "saving" ? "Understanding and saving…"
    : "Tap the mic and say what you did";

  return (
    <section aria-labelledby="capture-h" className="flex flex-col items-center gap-5">
      <h2 id="capture-h" className="sr-only">Add an entry</h2>

      <div className="relative grid size-28 place-items-center">
        {phase === "recording" && <span className="animate-ring absolute inset-0 rounded-full bg-primary" aria-hidden />}
        <button
          type="button"
          onClick={phase === "recording" ? stop : start}
          disabled={busy}
          aria-label={phase === "recording" ? "Stop recording" : "Start voice entry"}
          aria-pressed={phase === "recording"}
          className="relative grid size-24 place-items-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/25 transition-transform active:scale-95 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-9 animate-spin" aria-hidden />
            : phase === "recording" ? <Square className="size-8 fill-current" aria-hidden />
            : <Mic className="size-10" aria-hidden />}
        </button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">{status}</p>

      <form
        className="flex w-full items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-accent"
        onSubmit={(e) => { e.preventDefault(); send(text, "text"); }}
      >
        <label htmlFor="note" className="sr-only">Or type what you did</label>
        <textarea
          id="note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text, "text"); } }}
          rows={1}
          placeholder="e.g. Renewed car insurance today"
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-fg-muted/70"
        />
        <button
          disabled={busy || !text.trim()}
          aria-label="Save entry"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-white transition-opacity disabled:opacity-40 dark:text-bg"
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      </form>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </section>
  );
}
