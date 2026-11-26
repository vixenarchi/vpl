-- vpl · vp — a holder may spend a credit, not mint one
--
-- RLS is a permission on a ROW, not on a COLUMN. `vp_keys_revoke` let the holder
-- of a key UPDATE their own row, and the only constraint on `credits_left` was
-- `>= 0`. So one PATCH — `{ "credits_left": 100000 }` — turned a slip for five
-- calls into an unlimited draw on somebody else's provider key. The same request
-- could rewrite `owner_id`, which is the same trick aimed at a third person's
-- account.
--
-- The row that a person is allowed to touch has exactly one settable column:
-- `revoked`. Everything else is the issuer's, the door's, or arithmetic.
--
-- Two halves: take the UPDATE privilege away from the client, and put a trigger
-- in front of the columns that the door and the issuer own, so the rule holds
-- even if a future grant forgets it.

revoke update on public.vp_keys from authenticated;
revoke update on public.vp_codes from authenticated;

-- Reading is trimmed to the columns the holder needs. `key_hash` and `owner_id`
-- are not among them: the hash of your own key is not a secret, but the uuid of
-- the person paying for it is somebody else's identifier (VP-2).
revoke select on public.vp_keys from authenticated;
grant select (id, code_id, holder_id, label, credits_left, valid_until, calls,
              revoked, created_at, last_used_at)
  on public.vp_keys to authenticated;

-- ── the only update a person may make ─────────────────────────────────────
-- `revoked` is a switch, and both sides of the exchange may throw it: the holder
-- who wants the key to stop working, and the issuer who sold it. The function
-- checks the row, changes one column, and returns nothing.
create or replace function public.vp_revoke_key(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  update public.vp_keys
     set revoked = true
   where id = p_id
     and (holder_id = me or owner_id = me);
  if not found then
    raise exception 'no such key' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.vp_revoke_code(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  update public.vp_codes
     set revoked = true
   where id = p_id
     and owner_id = me;
  if not found then
    raise exception 'no such code' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.vp_revoke_key(uuid) from public, anon;
revoke all on function public.vp_revoke_code(uuid) from public, anon;
grant execute on function public.vp_revoke_key(uuid) to authenticated;
grant execute on function public.vp_revoke_code(uuid) to authenticated;

-- ── the guard: the columns that are not the holder's ──────────────────────
-- A trigger, not a policy, because a policy cannot say "this column". The door
-- and the migrations run without a JWT (auth.uid() is null) and pass straight
-- through; a signed-in person does not.
create or replace function public.vp_keys_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then return new; end if;   -- service role, the door
  if new.credits_left is distinct from old.credits_left
     or new.owner_id  is distinct from old.owner_id
     or new.holder_id is distinct from old.holder_id
     or new.valid_until is distinct from old.valid_until
     or new.key_hash  is distinct from old.key_hash
     or new.code_id   is distinct from old.code_id
     or new.calls     is distinct from old.calls
  then
    raise exception 'a credit is spent at the door, not written by hand'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists vp_keys_guard on public.vp_keys;
create trigger vp_keys_guard before update on public.vp_keys
  for each row execute function public.vp_keys_guard();

-- A code is a promise: N calls. If the issuer could raise `credits` after the
-- slip was handed out, a redeemed key would be minted with more than it said.
create or replace function public.vp_codes_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.credits     is distinct from old.credits
     or new.owner_id is distinct from old.owner_id
     or new.code_hash is distinct from old.code_hash
     or new.valid_until is distinct from old.valid_until
     or new.redeemed_by is distinct from old.redeemed_by
  then
    raise exception 'a slip is a promise; it is not rewritten after it is given'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists vp_codes_guard on public.vp_codes;
create trigger vp_codes_guard before update on public.vp_codes
  for each row execute function public.vp_codes_guard();

comment on function public.vp_revoke_key(uuid) is
  'the holder or the issuer, and only the revoked switch';
