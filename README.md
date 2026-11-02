# Nudgebook

**Log what you did. Get nudged when it's due again.**

Say or type *"Renewed car insurance today"* and Nudgebook files it in your life log, works out that it's due again in a year, and pings you 7 days before, 1 day before, and on the day, by push notification and (optionally) Google Calendar. Texts like *"Recharge of ₹299 successful, valid 28 days"* can flow in automatically from your phone's SMS.

- 🎙️ **Voice or text**: Deepgram (nova-3, multilingual) → Groq Whisper → on-device speech → typing
- 🧠 **Understands notes**: Groq `gpt-oss-20b` → `gpt-oss-120b` → offline rules (chrono-node + keywords). Dates are computed in code, not by the LLM.
- 🔔 **Reminders**: Web Push (installable PWA) with Done / Tomorrow buttons, plus Google Calendar events
- 🔁 **Recurring**: marking a renewal done schedules the next one; logging "renewed X" closes the open reminder
- 📩 **SMS auto-capture**: private webhook for Android forwarders / iPhone Shortcuts; OTPs and promos are ignored
- 👨‍👩‍👧 **Multi-user**: Supabase Auth + row-level security; every family member has their own book

Stack: Next.js 16 · Tailwind 4 · Supabase (Postgres, Auth, pg_cron, pg_net) · Vercel. No UI kit, no state library.

## Self-host in ~15 minutes

1. **Supabase**: create a project. Run both files in `supabase/migrations/` (SQL editor, or `supabase db push`).
   - Auth → URL Configuration: Site URL = your app URL; add `http://localhost:3000/**` and `https://your-app.vercel.app/**` to Redirect URLs.
2. **Keys**: `cp .env.example .env.local` and fill it in (`npx web-push generate-vapid-keys` for VAPID).
3. **Run**: `npm install && npm run dev` → http://localhost:3000
4. **Deploy**: push to GitHub → import in Vercel → paste the same env vars.
5. **Reminder clock**: in the Supabase SQL editor (once, after deploy):
   ```sql
   select vault.create_secret('https://your-app.vercel.app', 'app_url');
   select vault.create_secret('<your CRON_SECRET>', 'cron_secret');
   ```
   pg_cron then calls `/api/cron/dispatch` every minute (only when something is due).

### Optional: Google sign-in + Calendar sync

1. Google Cloud Console → APIs & Services → enable **Google Calendar API**.
2. OAuth consent screen (External, Testing) → add your family's emails as test users → scope `.../auth/calendar.events`.
3. Credentials → OAuth client (Web) → redirect URI `https://YOUR_REF.supabase.co/auth/v1/callback`.
4. Supabase → Auth → Providers → Google: paste client ID + secret. Put the same pair in `.env.local` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## SMS auto-capture

Settings → *Auto-add from SMS* shows your private link: `POST /api/ingest?token=…` with JSON `{"text": "...", "from": "..."}` (also accepts `message`/`body`/`msg`, or plain text).

- **Android**: an SMS-to-webhook app (e.g. open-source *SMS Forwarder*, or MacroDroid / Tasker) with a keyword filter: recharge, renew, premium, due, paid, booked. Or long-press any SMS → Share → Nudgebook.
- **iPhone**: Shortcuts → Automation → Message → "contains *recharge*" → Run Immediately → *Get Contents of URL* (POST, JSON `text` = message content).

```bash
curl -X POST "https://your-app.vercel.app/api/ingest?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" -d '{"text":"Jio recharge of Rs 349 successful. Validity 28 days","from":"JIO"}'
```

## How it works

```
voice/text/SMS ─▶ /api/entries | /api/ingest ─▶ parse (Groq → rules) ─▶ add_entry() SQL
                                                                        ├─ entries   (the log)
                                                                        ├─ reminders (due_at in your timezone)
                                                                        └─ trigger → reminder_pings (‑7d, ‑1d, 0)
pg_cron (1/min) ─▶ /api/cron/dispatch ─▶ claim_due_pings() ─▶ web-push ─▶ phone
```

## Develop

```bash
npm run dev      # app
npm test         # parser tests (live Groq test runs only if GROQ_API_KEY is set)
npx next build   # production build
```

MIT licensed.
