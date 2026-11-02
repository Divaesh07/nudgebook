-- Nudgebook: whole schema in one migration.
-- profiles · entries (the log) · reminders (what's due) · push_subscriptions · google_tokens
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

-- tables --------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  timezone text not null default 'UTC',
  remind_hour int not null default 9 check (remind_hour between 0 and 23),
  ingest_token uuid not null unique default gen_random_uuid(),  -- secret for the SMS webhook
  gcal_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

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
create index entries_user_idx on public.entries (user_id, happened_on desc, created_at desc);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  entry_id uuid references public.entries on delete cascade,
  title text not null,
  due_at timestamptz not null,
  recur interval,
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  next_ping_at timestamptz,  -- next of: due-7d, due-1d, due (set by trigger, advanced by dispatcher)
  gcal_event_id text,
  created_at timestamptz not null default now()
);
create index reminders_user_idx on public.reminders (user_id, due_at);
create index reminders_entry_idx on public.reminders (entry_id);
create index reminders_ping_idx on public.reminders (next_ping_at) where status = 'pending';

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- server only: never readable from the browser
create table public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

-- RLS: every user sees only their own rows ------------------------------------
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.google_tokens enable row level security;  -- no policies = service role only

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
revoke all on public.google_tokens from anon, authenticated;

-- triggers ------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
insert into public.profiles (id) select id from auth.users on conflict do nothing;  -- existing users

-- first ping = earliest of due-7d / due-1d / due that is still ahead
create function private.set_next_ping() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.next_ping_at := case when new.status = 'pending' then
    (select min(t) from unnest(array[new.due_at - interval '7 days', new.due_at - interval '1 day', new.due_at]) t
     where t > now() - interval '5 minutes') end;
  return new;
end $$;
create trigger reminders_next_ping before insert or update of due_at, status on public.reminders
  for each row execute function private.set_next_ping();

-- marking a recurring reminder done schedules the next cycle
create function private.spawn_next() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status <> 'done' and new.recur is not null then
    insert into public.reminders (user_id, entry_id, title, due_at, recur)
    values (new.user_id, new.entry_id, new.title, new.due_at + new.recur, new.recur);
  end if;
  return new;
end $$;
create trigger reminders_spawn_next after update of status on public.reminders
  for each row execute function private.spawn_next();

-- add_entry: one round trip; due time computed in the user's timezone ---------
-- security invoker: RLS applies to users; the SMS webhook calls it as service role.
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
    -- "renewed X" closes the matching open reminder (no respawn: the new one replaces it)
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

-- claim_due_pings: dispatcher takes due reminders once and advances next_ping_at
create function public.claim_due_pings() returns table (
  reminder_id uuid, user_id uuid, title text, due_at timestamptz, timezone text
)
language sql security invoker set search_path = '' as $$
  with due as (
    select id from public.reminders
    where status = 'pending' and next_ping_at <= now()
    order by next_ping_at limit 500
    for update skip locked
  )
  update public.reminders r
  set next_ping_at = (select min(t) from unnest(array[r.due_at - interval '7 days', r.due_at - interval '1 day', r.due_at]) t
                      where t > r.next_ping_at)
  from due, public.profiles p
  where r.id = due.id and p.id = r.user_id
  returning r.id, r.user_id, r.title, r.due_at, p.timezone;
$$;
revoke execute on function public.claim_due_pings from public, anon, authenticated;
grant execute on function public.claim_due_pings to service_role;

-- every minute, if something is due, ask the app to send pushes.
-- Needs Vault secrets 'app_url' and 'cron_secret' (see README).
select cron.schedule('nudgebook-dispatch', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.reminders where status = 'pending' and next_ping_at <= now());
$$);
