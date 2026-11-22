-- Projects that existed before vocabularies did get the default words, and rows
-- whose category had no matching subtheme fall back to their theme's root.

insert into public.vr_vocab (project_id, user_id, axis, value, color, pos)
select p.id, p.user_id, v.axis, v.value, v.color, v.pos
  from public.vr_projects p
  cross join (values
    ('importance', 'must',     'red',    1),
    ('importance', 'optional', 'amber',  2),
    ('importance', 'wish',     'slate',  3),
    ('status', 'draft',    'grey',   1),
    ('status', 'agreed',   'blue',   2),
    ('status', 'built',    'violet', 3),
    ('status', 'verified', 'green',  4),
    ('status', 'dropped',  'grey',   5),
    ('kind', 'functional',    'grey', 1),
    ('kind', 'nonfunctional', 'grey', 2),
    ('kind', 'constraint',    'grey', 3),
    ('kind', 'rule',          'grey', 4)
  ) as v(axis, value, color, pos)
 where not exists (select 1 from public.vr_vocab x where x.project_id = p.id);

update public.vr_reqs r
   set theme_id = (
     select t.id from public.vr_themes t
      where t.project_id = r.project_id and t.parent_id is null and t.name = r.theme
      limit 1)
 where r.theme_id is null and r.theme <> '';
