import { currentUser } from "@/lib/supabase/server";

const MAX = 8 * 1024 * 1024;

async function deepgram(audio: ArrayBuffer, type: string) {
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=multi", {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": type },
    body: audio,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`deepgram ${res.status}`);
  return (await res.json()).results?.channels?.[0]?.alternatives?.[0]?.transcript as string;
}

async function groqWhisper(audio: ArrayBuffer, type: string) {
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("file", new Blob([audio], { type }), `audio.${ext}`);
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`groq whisper ${res.status}`);
  return (await res.json()).text as string;
}

const ENGINES = [
  ["deepgram", deepgram, "DEEPGRAM_API_KEY"],
  ["groq", groqWhisper, "GROQ_API_KEY"],
] as const;

/** Audio blob in, text out. Deepgram first, Groq Whisper second. */
export async function POST(req: Request) {
  if (!(await currentUser())) return Response.json({ error: "Sign in first" }, { status: 401 });
  const type = (req.headers.get("content-type") ?? "audio/webm").split(";")[0];
  const audio = await req.arrayBuffer();
  if (!audio.byteLength) return Response.json({ error: "No audio" }, { status: 400 });
  if (audio.byteLength > MAX) return Response.json({ error: "Recording too long" }, { status: 413 });

  for (const [name, fn, key] of ENGINES) {
    if (!process.env[key]) continue;
    try {
      const text = (await fn(audio, type))?.trim();
      if (text) return Response.json({ text, via: name });
    } catch (e) {
      console.warn("transcribe", e);
    }
  }
  return Response.json({ error: "Couldn't catch that. Try again or type it." }, { status: 502 });
}
