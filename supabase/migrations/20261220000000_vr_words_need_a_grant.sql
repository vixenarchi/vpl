-- vpl · vr — a document having a link is not the same as you having it
--
-- `vr_themes_read` and `vr_vocab_read` asked `s.code is not null`: does this
-- project have *any* share row carrying a code. Not "is this code yours" — just
-- "does a code exist anywhere". Registration is open, so `to authenticated` is
-- "anybody", and every document that was ever shared by link published its
-- themes and its vocabulary to the whole suite. The person holding the link
-- never came through here anyway: a guest reads through `vr_read_share(code)`.
--
-- The line is the one `vr_reqs_read` already draws: a grant on this project, or
-- the project is mine. Re-runnable.

drop policy if exists vr_themes_read on public.vr_themes;
create policy vr_themes_read on public.vr_themes for select to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_vocab_read on public.vr_vocab;
create policy vr_vocab_read on public.vr_vocab for select to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

comment on policy vr_themes_read on public.vr_themes is
  'The words follow the document: my project, or somebody who granted me this one.';
