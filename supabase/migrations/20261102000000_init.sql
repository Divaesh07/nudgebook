-- Nudgebook schema: profiles, entries (life log), reminders, pings, push subs, google tokens.
create extension if not exists pg_trgm with schema extensions;
create schema if not exists private;

-- profiles ------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  timezone text not null default 'UTC',
  remind_hour int not null default 9 check (remind_hour between 0 and 23),
  ingest_token uuid not null unique default gen_random_uuid(),
  gcal_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- users who signed up before this migration
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- entries: what happened ----------------------------------------------------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  raw_text text not null check (length(raw_text) <= 4000),
  source text not null default 'text' check (source in ('text','voice','sms','share')),
  title text not null,
  category text not null default 'other',
  happened_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index entries_user_created_idx on public.entries (user_id, created_at desc);

-- reminders: what is due ----------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  entry_id uuid references public.entries on delete cascade,
  title text not null,
  due_at timestamptz not null,
  recur interval,
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  gcal_event_id text,
  created_at timestamptz not null default now()
);
create index reminders_user_due_idx on public.reminders (user_id, due_at);
create index reminders_entry_idx on public.reminders (entry_id);

-- pings: 7d / 1d / on-day push schedule (server only) -----------------------
create table public.reminder_pings (
  id bigint generated always as identity primary key,
  reminder_id uuid not null references public.reminders on delete cascade,
  send_at timestamptz not null,
  sent_at timestamptz
);
create index reminder_pings_due_idx on public.reminder_pings (send_at) where sent_at is null;
create index reminder_pings_reminder_idx on public.reminder_pings (reminder_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- server only: Google OAuth refresh tokens
create table public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

-- RLS -----------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.reminders enable row level security;
alter table public.reminder_pings enable row level security;      -- no policies: service role only
alter table public.push_subscriptions enable row level security;
alter table public.google_tokens enable row level security;       -- no policies: service role only

create policy "own profile read" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own entries" on public.entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own reminders" on public.reminders for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own push subs" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.entries, public.reminders, public.push_subscriptions to authenticated;
grant all on all tables in schema public to service_role;
revoke all on public.reminder_pings, public.google_tokens from anon, authenticated;

-- ping schedule: rebuild unsent pings whenever due_at/status changes --------
create function private.schedule_pings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reminder_pings where reminder_id = new.id and sent_at is null;
  if new.status = 'pending' then
    insert into public.reminder_pings (reminder_id, send_at)
    select new.id, new.due_at - o
    from unnest(array[interval '7 days', interval '1 day', interval '0']) as o
    where new.due_at - o > now() - interval '5 minutes';
  end if;
  return new;
end $$;

create trigger reminders_schedule_pings
  after insert or update of due_at, status on public.reminders
  for each row execute function private.schedule_pings();

-- recurring: marking done spawns the next one --------------------------------
create function private.spawn_next() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status <> 'done' and new.recur is not null then
    insert into public.reminders (user_id, entry_id, title, due_at, recur)
    values (new.user_id, new.entry_id, new.title, new.due_at + new.recur, new.recur);
  end if;
  return new;
end $$;

create trigger reminders_spawn_next
  after update of status on public.reminders
  for each row execute function private.spawn_next();

-- add_entry: one round trip, due time computed in the user's timezone --------
-- security invoker: RLS applies for users; service role (SMS webhook) passes p_user_id.
create function public.add_entry(
  p_user_id uuid, p_raw text, p_source text, p_title text, p_category text,
  p_happened_on date, p_due_date date, p_due_time time, p_recur interval
) returns json
language plpgsql security invoker set search_path = '' as $$
declare
  prof public.profiles;
  e public.entries;
  r public.reminders;
begin
  select * into prof from public.profiles where id = p_user_id;
  if prof.id is null then raise exception 'profile not found'; end if;

  insert into public.entries (user_id, raw_text, source, title, category, happened_on)
  values (p_user_id, p_raw, p_source, p_title, coalesce(p_category, 'other'),
          coalesce(p_happened_on, (now() at time zone prof.timezone)::date))
  returning * into e;

  if p_due_date is not null then
    -- logging a renewal closes the matching pending reminder (no respawn: new one below replaces it)
    update public.reminders set status = 'done', recur = null
    where user_id = p_user_id and status = 'pending'
      and due_at < now() + interval '60 days'
      and extensions.similarity(lower(title), lower(p_title)) > 0.5;

    insert into public.reminders (user_id, entry_id, title, due_at, recur)
    values (p_user_id, e.id, p_title,
            (p_due_date + coalesce(p_due_time, make_time(prof.remind_hour, 0, 0))) at time zone prof.timezone,
            p_recur)
    returning * into r;
  end if;

  return json_build_object('entry', row_to_json(e), 'reminder', row_to_json(r));
end $$;

revoke execute on function public.add_entry from public, anon;
grant execute on function public.add_entry to authenticated, service_role;

-- claim_due_pings: dispatcher grabs due pings once (at-most-once delivery) ----
create function public.claim_due_pings() returns table (
  reminder_id uuid, user_id uuid, title text, due_at timestamptz, timezone text
)
language sql security invoker set search_path = '' as $$
  with due as (
    select p.id from public.reminder_pings p
    where p.sent_at is null and p.send_at <= now()
    order by p.send_at limit 500
    for update skip locked
  ), claimed as (
    update public.reminder_pings p set sent_at = now()
    from due where p.id = due.id
    returning p.reminder_id
  )
  select distinct on (r.id) r.id, r.user_id, r.title, r.due_at, pr.timezone
  from claimed c
  join public.reminders r on r.id = c.reminder_id and r.status = 'pending'
  join public.profiles pr on pr.id = r.user_id;
$$;

revoke execute on function public.claim_due_pings from public, anon, authenticated;
grant execute on function public.claim_due_pings to service_role;
