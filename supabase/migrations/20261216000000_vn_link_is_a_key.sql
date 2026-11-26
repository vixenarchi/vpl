-- vpl · vn — a link is a key, not an index of keys
--
-- `vn_shares_by_code` was `using (code is not null)`, for the role `anon`. It
-- existed so a public link could resolve without an account. The effect was
-- wider than the intent: any visitor holding the public anon key could ask for
-- *every* row that had a code, i.e. every public link in the database, with its
-- note id. A capability that can be listed is a capability that is not one.
--
-- The other seven apps already answer this the right way: the code is handed to
-- a `security definer` function which returns only what that code opens. vn had
-- `vn_read_share(code)` for the rows but a plain SELECT for the root. This adds
-- the missing half and closes the door behind it.
--
-- Re-runnable.

-- ── what one code opens ───────────────────────────────────────────────────
-- The reader needs to know which note is the root, and whether the link is a
-- public one or a grant that happens to arrive by code. Nothing else.
create or replace function public.vn_link_info(p_code text)
returns table (note_id uuid, role text, owner_id uuid)
language sql stable security definer
set search_path = public
as $$
  select s.note_id, s.role, s.owner_id
    from public.vn_shares s
   where s.code = p_code
     and s.code is not null
     and s.pending is not true
   limit 1;
$$;

comment on function public.vn_link_info(text) is
  'What one public code opens: its root and its role. Handed the code, so a reader needs no account and cannot list the codes.';

revoke all on function public.vn_link_info(text) from public;
grant execute on function public.vn_link_info(text) to anon, authenticated;

-- ── the listing goes ─────────────────────────────────────────────────────
-- Anonymous visitors get no SELECT on shares at all: the two functions above are
-- the only way in, and each takes one code.
drop policy if exists vn_shares_by_code on public.vn_shares;

revoke select on public.vn_shares from anon;
grant select on public.vn_shares to authenticated;   -- the owner's own list, under RLS

comment on table public.vn_shares is
  'Public links and person grants. Anon reads nothing from this table: a code is answered by vn_read_share() and vn_link_info().';
