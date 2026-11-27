-- 0012 — an invitation may wait for its person.
--
-- 0008 refused a grant for an address with no account, which closed the "type a
-- guessable address and wait for a stranger to claim it" hole. It also made
-- inviting a friend who has not signed up yet impossible: first tell them to
-- register, then come back.
--
-- A waiting grant is the middle way. It names the address, it is visible to the
-- owner, and it grants **nothing** — `share_role` skips it. The owner activates
-- it later, and only when the account exists; the trigger refuses the
-- activation for an address nobody has. So the person still cannot be a
-- stranger, and the owner still makes the decision by hand.

alter table public.note_shares
  add column if not exists pending boolean not null default false;

comment on column public.note_shares.pending is
  'Waiting for its address to have an account. Grants nothing until the owner clears it.';

-- ── 1. a waiting grant does not let anyone read ───────────────────────
create or replace function public.share_role(note uuid, viewer_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with recursive up as (
    select n.id, n.parent_id, 0 as depth
      from public.notes n
     where n.id = note
    union all
    select p.id, p.parent_id, up.depth + 1
      from public.notes p
      join up on p.id = up.parent_id
     where up.depth < 64
  )
  select s.role
    from up
    join public.note_shares s on s.note_id = up.id
   where not s.pending
     and (s.code is not null
          or (viewer_email is not null and lower(s.email) = lower(viewer_email)))
   order by up.depth,
            (s.email is not null) desc,   -- your own grant beats a public link
            (s.role = 'edit') desc        -- and edit beats view at the same depth
   limit 1;
$$;

-- ── 2. activation is what needs the account to exist ──────────────────
create or replace function public.note_shares_known_target()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is not null
     and not coalesce(new.pending, false)
     and not exists (select 1 from auth.users u
                      where lower(u.email) = lower(btrim(new.email))) then
    raise exception 'no account with that address yet'
      using errcode = 'check_violation',
            hint = 'leave the grant waiting, then allow it once they sign up';
  end if;
  return new;
end;
$$;

drop trigger if exists note_shares_known_target on public.note_shares;
create trigger note_shares_known_target
  before insert or update of email, pending on public.note_shares
  for each row execute function public.note_shares_known_target();

-- existing rows: a grant whose address has no account becomes a waiting grant
-- rather than quietly disappearing
update public.note_shares s
   set pending = true
 where s.email is not null
   and not s.pending
   and not exists (select 1 from auth.users u
                    where lower(u.email) = lower(s.email));
