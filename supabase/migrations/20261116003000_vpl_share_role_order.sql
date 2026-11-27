-- v2.5 — when two grants cover the same note, the one for *you* wins.
--
-- v2.4's share_role() picked the nearest grant with `order by depth limit 1`.
-- A note can carry a public link and an email grant at once, and both sit at
-- the same depth, so the tie was resolved by whatever the planner returned
-- first. In practice an editor holding an 'edit' grant sometimes got the
-- public row's 'view', which let them read but made every autosave a silent
-- no-op: PostgREST updated zero rows and answered 406.
--
-- The order is now explicit: nearest ancestor first, then a grant addressed to
-- the viewer before a public link, then edit before view. A person's own grant
-- always beats the link they could also use.
--
-- Re-runnable.

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
   where s.code is not null
      or (viewer_email is not null and lower(s.email) = lower(viewer_email))
   order by up.depth,
            (s.email is not null) desc,   -- your own grant beats a public link
            (s.role = 'edit') desc        -- and edit beats view at the same depth
   limit 1;
$$;

comment on function public.share_role(uuid, text) is
  'Nearest grant covering this note or an ancestor; a personal grant wins over a public link.';
