-- vpl · vp — the guard must let a slip be redeemed
--
-- `vp_codes_guard` from 20261215 refused any change to a code's row by a person,
-- which is right for credits, expiry and the hash — and wrong for the one thing
-- that is supposed to happen to a slip: `vp_redeem` stamps `redeemed_by` and
-- `redeemed_at` on it. That path runs as the caller, so the trigger saw a person
-- and said no. The redemption failed, and the failure read like a broken button.
--
-- A redemption is not an edit: it may only happen once, and only forward. So the
-- guard allows exactly `redeemed_by`/`redeemed_at` going from null to a value,
-- and nothing else. Re-runnable.

create or replace function public.vp_codes_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then return new; end if;               -- service role
  if new.credits      is distinct from old.credits             -- a slip is a promise
     or new.owner_id   is distinct from old.owner_id
     or new.code_hash  is distinct from old.code_hash
     or new.valid_until is distinct from old.valid_until
     or new.created_at is distinct from old.created_at
  then
    raise exception 'a slip is a promise; it is not rewritten after it is given'
      using errcode = 'insufficient_privilege';
  end if;

  /* redeeming is the one forward step: from nobody to somebody, once */
  if old.redeemed_by is not null and new.redeemed_by is distinct from old.redeemed_by then
    raise exception 'a slip is redeemed once' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists vp_codes_guard on public.vp_codes;
create trigger vp_codes_guard before update on public.vp_codes
  for each row execute function public.vp_codes_guard();
