-- 0015 — a link is unlisted, not public.
--
-- Found while reading a brand new account's note list: because share_role()
-- answered "view" for any note that had a public code anywhere above it, every
-- signed-in person could see every shared note in their own tree. The content
-- is public to anyone holding the link, so nothing secret leaked — but a link
-- you handed to one person became a note listed for everyone with an account,
-- with its title in a sidebar.
--
-- So the code stops being a grant and becomes a capability:
--
--   * share_role() now only answers for a grant addressed to a person;
--   * reading a link goes through read_share(code), a security definer
--     function that is handed the code and returns that subtree's rows.
--
-- Without the code you cannot read it, and you cannot list it.

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
   where viewer_email is not null
     and s.email is not null
     and lower(s.email) = lower(viewer_email)
   order by up.depth,
            (s.role = 'edit') desc
   limit 1;
$$;

comment on function public.share_role(uuid, text) is
  'Nearest personal grant covering this note or an ancestor. A public code is not a grant; it is read through read_share().';

-- The subtree behind a code, and nothing else. Rows come back in tree order
-- with the fields a reader needs; the note itself may be in the bin, in which
-- case the link is dead and the answer is empty.
create or replace function public.read_share(p_code text)
returns table (
  id uuid,
  title text,
  body text,
  parent_id uuid,
  "position" integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select n.id, n.title, n.body, n.parent_id, n."position", n.updated_at, 0 as depth
      from public.notes n
      join public.note_shares s on s.note_id = n.id
     where s.code = p_code
       and s.code is not null
       and n.deleted_at is null
    union all
    select c.id, c.title, c.body, c.parent_id, c."position", c.updated_at, t.depth + 1
      from public.notes c
      join tree t on c.parent_id = t.id
     where c.deleted_at is null
       and t.depth < 64
  )
  select t.id, t.title, t.body, t.parent_id, t."position", t.updated_at
    from tree t
   order by t.depth, t."position", t.id;
$$;

comment on function public.read_share(text) is
  'The rows behind one public code. Handed the code, so no account and no listing.';

revoke all on function public.read_share(text) from public;
grant execute on function public.read_share(text) to anon, authenticated;

-- and the old policy that let a code-bearing row act as a grant is now moot:
-- share_role no longer looks at codes, so nothing else has to change.
