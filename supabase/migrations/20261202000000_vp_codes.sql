-- vpl · vp — keys, codes and the door (stage 2)
--
-- A code is a slip: N calls, valid until a date, shown once and stored hashed.
-- Redeeming it turns it into a key. The key is used as a model key against
-- https://api.terg.hr/vp, which spends the *issuer's* provider key and charges
-- one credit per call.
--
-- The rules that keep this from becoming a billing system:
--   * one credit = one call, whatever its size (the tokens are logged, not priced)
--   * credits and expiry are checked and spent in ONE function, under a row lock
--   * a call that fails upstream gives the credit back
--   * the proxy sees a hash, never the code or the key as text

create table if not exists public.vp_codes (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  code_hash    text not null unique,
  label        text not null default 'code',
  credits      int  not null check (credits > 0),
  valid_until  date,
  revoked      boolean not null default false,
  redeemed_by  uuid references auth.users(id) on delete set null,
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.vp_keys (
  id           uuid primary key default gen_random_uuid(),
  code_id      uuid references public.vp_codes(id) on delete set null,
  owner_id     uuid not null references auth.users(id) on delete cascade,   -- whose provider key is spent
  holder_id    uuid not null references auth.users(id) on delete cascade,   -- who may use it
  key_hash     text not null unique,
  label        text not null default 'code',
  credits_left int  not null check (credits_left >= 0),
  valid_until  date,
  calls        int  not null default 0,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.vp_charges (
  id         uuid primary key default gen_random_uuid(),
  key_id     uuid not null references public.vp_keys(id) on delete cascade,
  app        text not null default '',
  model      text not null default '',
  in_tokens  int  not null default 0,
  out_tokens int  not null default 0,
  ms         int  not null default 0,
  status     int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists vp_charges_key_idx on public.vp_charges(key_id, created_at desc);
create index if not exists vp_keys_holder_idx on public.vp_keys(holder_id);
create index if not exists vp_codes_owner_idx on public.vp_codes(owner_id);

alter table public.vp_codes   enable row level security;
alter table public.vp_keys    enable row level security;
alter table public.vp_charges enable row level security;

-- the issuer sees the slips they made (never the plaintext code) and may revoke
drop policy if exists vp_codes_own on public.vp_codes;
create policy vp_codes_own on public.vp_codes
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists vp_codes_revoke on public.vp_codes;
create policy vp_codes_revoke on public.vp_codes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- a key is visible to the person using it and to the person paying for it
drop policy if exists vp_keys_read on public.vp_keys;
create policy vp_keys_read on public.vp_keys
  for select to authenticated
  using (holder_id = (select auth.uid()) or owner_id = (select auth.uid()));

drop policy if exists vp_keys_revoke on public.vp_keys;
create policy vp_keys_revoke on public.vp_keys
  for update to authenticated
  using (holder_id = (select auth.uid()) or owner_id = (select auth.uid()))
  with check (holder_id = (select auth.uid()) or owner_id = (select auth.uid()));

drop policy if exists vp_charges_read on public.vp_charges;
create policy vp_charges_read on public.vp_charges
  for select to authenticated
  using (exists (
    select 1 from public.vp_keys k
     where k.id = key_id
       and (k.holder_id = (select auth.uid()) or k.owner_id = (select auth.uid()))
  ));

revoke all on public.vp_codes, public.vp_keys, public.vp_charges from anon;
grant select, update on public.vp_codes, public.vp_keys to authenticated;
grant select on public.vp_charges to authenticated;

-- ── making slips ──────────────────────────────────────────────────────────
-- The plaintext code exists exactly once: in this answer, on the screen.
-- Nothing in the database can print it again.

create or replace function public.vp_make_codes(
  p_count int,
  p_credits int,
  p_until date,
  p_label text
)
returns table (code text, credits int, valid_until date, label text)
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
  i int;
  c text;
  l text := coalesce(nullif(trim(p_label), ''), 'code');
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_count is null or p_count < 1 or p_count > 50 then
    raise exception 'one to fifty codes at a time';
  end if;
  if p_credits is null or p_credits < 1 then
    raise exception 'at least one call per code';
  end if;
  if p_until is not null and p_until < current_date then
    raise exception 'that date has already passed';
  end if;

  for i in 1..p_count loop
    c := 'vpc_' || substr(md5(random()::text || clock_timestamp()::text || i::text || me::text), 1, 24);
    insert into public.vp_codes (owner_id, code_hash, label, credits, valid_until)
    values (me, encode(sha256(convert_to(c, 'UTF8')), 'hex'), l, p_credits, p_until);
    code := c; credits := p_credits; valid_until := p_until; label := l;
    return next;
  end loop;
end;
$$;

revoke all on function public.vp_make_codes(int, int, date, text) from public, anon;
grant execute on function public.vp_make_codes(int, int, date, text) to authenticated;

-- ── redeeming one ─────────────────────────────────────────────────────────

create or replace function public.vp_redeem(p_code text)
returns table (api_key text, label text, credits int, valid_until date, model text)
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
  raw text := trim(coalesce(p_code, ''));
  slip public.vp_codes;
  fresh text;
  them text;
begin
  if me is null then
    raise exception 'sign in first, so the calls are yours' using errcode = 'insufficient_privilege';
  end if;
  if raw = '' then
    raise exception 'paste the code first';
  end if;

  select * into slip from public.vp_codes
   where code_hash = encode(sha256(convert_to(raw, 'UTF8')), 'hex')
   for update;

  if not found then raise exception 'that code is not one of ours'; end if;
  if slip.revoked then raise exception 'that code was revoked'; end if;
  if slip.redeemed_by is not null then raise exception 'that code has already been used'; end if;
  if slip.valid_until is not null and slip.valid_until < current_date then
    raise exception 'that code expired on %', slip.valid_until;
  end if;

  fresh := 'vp_' || substr(md5(random()::text || clock_timestamp()::text || me::text), 1, 32);

  insert into public.vp_keys (code_id, owner_id, holder_id, key_hash, label, credits_left, valid_until)
  values (slip.id, slip.owner_id, me,
          encode(sha256(convert_to(fresh, 'UTF8')), 'hex'), slip.label, slip.credits, slip.valid_until);

  update public.vp_codes set redeemed_by = me, redeemed_at = now() where id = slip.id;

  select a.model into them from public.vpl_ai a where a.user_id = slip.owner_id;

  api_key := fresh; label := slip.label; credits := slip.credits;
  valid_until := slip.valid_until; model := coalesce(them, 'gemini-3.1-flash-lite');
  return next;
end;
$$;

revoke all on function public.vp_redeem(text) from public, anon;
grant execute on function public.vp_redeem(text) to authenticated;

-- ── the door: spend one credit and hand back the provider's key ───────────
-- service_role only. This function is the one place that can read somebody
-- else's provider key, so it answers once, for one call, and forgets.

create or replace function public.vp_spend(p_hash text, p_app text, p_model text)
returns table (ok boolean, reason text, key_id uuid, provider_url text,
               provider_model text, provider_key text, credits_left int, calls_left int)
language plpgsql security definer
set search_path = public, auth
as $$
declare
  k public.vp_keys;
  a public.vpl_ai;
begin
  select * into k from public.vp_keys
   where key_hash = p_hash for update;
  if not found then
    ok := false; reason := 'that key is not one of ours'; return next; return;
  end if;
  if k.revoked then
    ok := false; reason := 'that key was revoked'; return next; return;
  end if;
  if k.valid_until is not null and k.valid_until < current_date then
    ok := false; reason := 'that key expired on ' || k.valid_until; return next; return;
  end if;
  if k.credits_left < 1 then
    ok := false; reason := 'that key is out of calls'; return next; return;
  end if;

  select * into a from public.vpl_ai where user_id = k.owner_id;
  if not found or a.api_key = '' then
    ok := false; reason := 'the person who made this code has no model key saved'; return next; return;
  end if;

  update public.vp_keys
     set credits_left = credits_left - 1,
         calls = calls + 1,
         last_used_at = now()
   where id = k.id;

  ok := true; reason := null; key_id := k.id;
  provider_url := a.url; provider_key := a.api_key;
  provider_model := coalesce(nullif(trim(p_model), ''), a.model);
  credits_left := k.credits_left - 1; calls_left := k.calls + 1;
  return next;
end;
$$;

revoke all on function public.vp_spend(text, text, text) from public, anon, authenticated;
grant execute on function public.vp_spend(text, text, text) to service_role;

-- ── settle: log the call, and give the credit back if it failed ───────────

create or replace function public.vp_settle(
  p_hash text, p_status int, p_app text, p_model text,
  p_in int, p_out int, p_ms int
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  k public.vp_keys;
begin
  select * into k from public.vp_keys where key_hash = p_hash for update;
  if not found then return; end if;

  insert into public.vp_charges (key_id, app, model, in_tokens, out_tokens, ms, status)
  values (k.id, coalesce(p_app, ''), coalesce(p_model, ''),
          coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_ms, 0), coalesce(p_status, 0));

  -- an error upstream is not the holder's fault: the call did not happen
  if coalesce(p_status, 0) >= 400 then
    update public.vp_keys set credits_left = credits_left + 1 where id = k.id;
  end if;
end;
$$;

revoke all on function public.vp_settle(text, int, text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.vp_settle(text, int, text, text, int, int, int) to service_role;

-- ── the prefix guard learns vp_ ───────────────────────────────────────────

create or replace function public.vpl_prefix_check()
returns table (kind text, name text)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  with allowed as (
    select unnest(array['vn_', 'vi_', 'vr_', 'vz_', 'vd_', 'vc_', 'va_', 'vg_', 'vp_', 'vpl_']) as p
  ),
  shared as (
    select unnest(array['touch_updated_at', 'rls_auto_enable']) as n
  ),
  tables as (
    select 'table'::text as kind, c.relname::text as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  ),
  functions as (
    select 'function'::text as kind, p.proname::text as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ),
  triggers as (
    select 'trigger'::text as kind, t.tgname::text as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  )
  select * from (
    select * from tables union all select * from functions union all select * from triggers
  ) o
   where not exists (select 1 from allowed a where o.name like a.p || '%')
     and not exists (select 1 from shared s where s.n = o.name)
   order by 1, 2;
$$;

revoke all on function public.vpl_prefix_check() from public, anon;
grant execute on function public.vpl_prefix_check() to authenticated;

-- ── account deletion takes the slips with it ─────────────────────────────

create or replace function public.vpl_delete_my_account()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  delete from public.vn_shares where owner_id = me;
  delete from public.vn_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vn_notes where user_id = me;

  delete from public.vi_projects where user_id = me;

  delete from public.vr_shares where owner_id = me;
  delete from public.vr_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vr_projects where user_id = me;

  delete from public.vz_shares where owner_id = me;
  delete from public.vz_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vz_projects where user_id = me;

  delete from public.vd_shares where owner_id = me;
  delete from public.vd_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vd_projects where user_id = me;

  delete from public.vc_shares where owner_id = me;
  delete from public.vc_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vc_projects where user_id = me;

  -- keys and codes, both as issuer and as holder (charges fall with the key)
  delete from public.vp_keys where owner_id = me or holder_id = me;
  delete from public.vp_codes where owner_id = me;

  delete from public.vpl_ai where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;
