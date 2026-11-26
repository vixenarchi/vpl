-- vpl · the seven findings from the other laptop, 2026-11-26
--
-- Measured over the public REST API as ordinary accounts — an owner, a guest
-- holding `view` and then `edit`, and a third party nobody invited — with no
-- service key anywhere. The two scripts are in the repository
-- (`apps/vn/test/authz-matrix.mjs`, `authz-confirm.mjs`) and the findings are in
-- `docs/security.md` under "2026-11-26".
--
-- Five of the seven are one mistake wearing different tables: a policy asked
-- "may you read this project?" or "is this row yours?" where it should have
-- asked "are you the owner?" or "may you edit it?". This file answers the right
-- question once per table, and it is re-runnable: every policy on these tables is
-- dropped first, so no older, wider rule survives underneath the new one.
--
--   BUG-1  a guest could mint a share, with `edit`, for somebody else
--   BUG-2  a guest could bin the owner's project and its rows
--   BUG-3  a guest could destroy rows for good, in five tables
--   BUG-4  a `view` guest could insert an idea
--   BUG-5  a row a guest wrote was invisible to the project's owner
--   BUG-6  a guest could re-parent and re-order somebody else's note
--   BUG-7  an editor could write a compliance verdict with no run behind it
--
-- The rule this file follows, in one sentence: **an editor writes words; the
-- owner decides what is in the document, where it sits, and whether it goes.**

begin;

-- ── the old rules go first ──────────────────────────────────────────
-- Policies are OR'd, so a permissive rule left behind keeps the hole open no
-- matter what is added next. This drops every policy on the tables below — read,
-- insert, update, delete and `for all` — and the rest of the file puts back
-- exactly four per table. Dropping a policy that does not exist is not an error,
-- so this runs again cleanly.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'vi_shares', 'vr_shares', 'vz_shares', 'vd_shares', 'vc_shares', 'va_shares',
    'vi_ideas', 'vr_reqs', 'vr_themes', 'vr_terms', 'vr_vocab', 'vz_pairs',
    'vd_artifacts', 'vd_outputs',
    'vc_artifacts', 'vc_targets', 'vc_outputs', 'va_artifacts', 'va_outputs', 'va_jobs'
  ] loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end;
$$;

-- ── BUG-1 · a share is the owner's decision ─────────────────────────
-- The insert policy asked only that `owner_id` was the caller, so a guest could
-- make itself the owner of a grant on somebody else's project — and hand out
-- `edit`. vn has had the right shape since the first migration: the row being
-- shared must be mine as well. The same clause, six times.

drop policy if exists vi_shares_own on public.vi_shares;
create policy vi_shares_own on public.vi_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.vi_projects p
                           where p.id = vi_shares.project_id and p.user_id = auth.uid()));

-- the person a document was shared with sees the grant that names them, and
-- nothing else on this table
drop policy if exists vi_shares_mine on public.vi_shares;
create policy vi_shares_mine on public.vi_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists vr_shares_own on public.vr_shares;
create policy vr_shares_own on public.vr_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.vr_projects p
                           where p.id = vr_shares.project_id and p.user_id = auth.uid()));

-- the person a document was shared with sees the grant that names them, and
-- nothing else on this table
drop policy if exists vr_shares_mine on public.vr_shares;
create policy vr_shares_mine on public.vr_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists vz_shares_own on public.vz_shares;
create policy vz_shares_own on public.vz_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.vz_projects p
                           where p.id = vz_shares.project_id and p.user_id = auth.uid()));

-- the person a document was shared with sees the grant that names them, and
-- nothing else on this table
drop policy if exists vz_shares_mine on public.vz_shares;
create policy vz_shares_mine on public.vz_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists vd_shares_own on public.vd_shares;
create policy vd_shares_own on public.vd_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.vd_projects p
                           where p.id = vd_shares.project_id and p.user_id = auth.uid()));

-- the person a document was shared with sees the grant that names them, and
-- nothing else on this table
drop policy if exists vd_shares_mine on public.vd_shares;
create policy vd_shares_mine on public.vd_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists vc_shares_own on public.vc_shares;
create policy vc_shares_own on public.vc_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.vc_projects p
                           where p.id = vc_shares.project_id and p.user_id = auth.uid()));

-- the person a document was shared with sees the grant that names them, and
-- nothing else on this table
drop policy if exists vc_shares_mine on public.vc_shares;
create policy vc_shares_mine on public.vc_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists va_shares_own on public.va_shares;
create policy va_shares_own on public.va_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.va_projects p
                           where p.id = va_shares.project_id and p.user_id = auth.uid()));

-- the person a document was shared with sees the grant that names them, and
-- nothing else on this table
drop policy if exists va_shares_mine on public.va_shares;
create policy va_shares_mine on public.va_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ── BUG-3/4/5 · four questions, answered the same way in every app ──
--   read    me, or the project's owner, or anybody the document is shared with
--   insert  me, into a project I own — or may edit, where the app allows it
--           (only `va_jobs` does not: a job runs code, and VA-1 says the owner)
--   update  the owner of the project, or an editor of it
--   delete  me, or the owner of the project: an editor bins, never destroys
--
-- `vr_terms` and `vr_vocab` are here for one clause of their own: their read
-- policy said "if *anybody* holds a link code for this document, everybody may
-- read this table" — a code is a read for the person holding it, not for the
-- whole internet with an account. (Measured, not guessed: the clause was
-- `s.code is not null or …`, with no reference to the caller.)
--
-- BUG-5 is why `read` names the project's owner: the rows an editor writes carry
-- the editor's `user_id`, and without it an owner could never see what a guest
-- added to their own document. BUG-3 was five tables whose delete policy asked
-- for `edit`; BUG-4 was vi's insert asking for read. Neither question is about
-- reading.

-- vi_ideas
drop policy if exists vi_ideas_read on public.vi_ideas;
create policy vi_ideas_read on public.vi_ideas for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vi_projects p
             where p.id = vi_ideas.project_id
               and (p.user_id = auth.uid()
                    or public.vi_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vi_ideas_add on public.vi_ideas;
create policy vi_ideas_add on public.vi_ideas for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vi_projects p
                   where p.id = vi_ideas.project_id
                     and (p.user_id = auth.uid()
                          or public.vi_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vi_ideas_write on public.vi_ideas;
create policy vi_ideas_write on public.vi_ideas for update to authenticated
  using (exists (select 1 from public.vi_projects p
           where p.id = vi_ideas.project_id
             and (p.user_id = auth.uid()
                  or public.vi_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vi_projects p
                  where p.id = vi_ideas.project_id
                    and (p.user_id = auth.uid()
                         or public.vi_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vi_ideas_drop on public.vi_ideas;
create policy vi_ideas_drop on public.vi_ideas for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vi_projects p
             where p.id = vi_ideas.project_id
               and p.user_id = auth.uid()));

-- vr_reqs
drop policy if exists vr_reqs_read on public.vr_reqs;
create policy vr_reqs_read on public.vr_reqs for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_reqs.project_id
               and (p.user_id = auth.uid()
                    or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_reqs_add on public.vr_reqs;
create policy vr_reqs_add on public.vr_reqs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vr_projects p
                   where p.id = vr_reqs.project_id
                     and (p.user_id = auth.uid()
                          or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_reqs_write on public.vr_reqs;
create policy vr_reqs_write on public.vr_reqs for update to authenticated
  using (exists (select 1 from public.vr_projects p
           where p.id = vr_reqs.project_id
             and (p.user_id = auth.uid()
                  or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vr_projects p
                  where p.id = vr_reqs.project_id
                    and (p.user_id = auth.uid()
                         or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_reqs_drop on public.vr_reqs;
create policy vr_reqs_drop on public.vr_reqs for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_reqs.project_id
               and p.user_id = auth.uid()));

-- vr_themes
drop policy if exists vr_themes_read on public.vr_themes;
create policy vr_themes_read on public.vr_themes for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_themes.project_id
               and (p.user_id = auth.uid()
                    or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_themes_add on public.vr_themes;
create policy vr_themes_add on public.vr_themes for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vr_projects p
                   where p.id = vr_themes.project_id
                     and (p.user_id = auth.uid()
                          or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_themes_write on public.vr_themes;
create policy vr_themes_write on public.vr_themes for update to authenticated
  using (exists (select 1 from public.vr_projects p
           where p.id = vr_themes.project_id
             and (p.user_id = auth.uid()
                  or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vr_projects p
                  where p.id = vr_themes.project_id
                    and (p.user_id = auth.uid()
                         or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_themes_drop on public.vr_themes;
create policy vr_themes_drop on public.vr_themes for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_themes.project_id
               and p.user_id = auth.uid()));

-- vr_terms
drop policy if exists vr_terms_read on public.vr_terms;
create policy vr_terms_read on public.vr_terms for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_terms.project_id
               and (p.user_id = auth.uid()
                    or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_terms_add on public.vr_terms;
create policy vr_terms_add on public.vr_terms for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vr_projects p
                   where p.id = vr_terms.project_id
                     and (p.user_id = auth.uid()
                          or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_terms_write on public.vr_terms;
create policy vr_terms_write on public.vr_terms for update to authenticated
  using (exists (select 1 from public.vr_projects p
           where p.id = vr_terms.project_id
             and (p.user_id = auth.uid()
                  or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vr_projects p
                  where p.id = vr_terms.project_id
                    and (p.user_id = auth.uid()
                         or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_terms_drop on public.vr_terms;
create policy vr_terms_drop on public.vr_terms for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_terms.project_id
               and p.user_id = auth.uid()));

-- vr_vocab
drop policy if exists vr_vocab_read on public.vr_vocab;
create policy vr_vocab_read on public.vr_vocab for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_vocab.project_id
               and (p.user_id = auth.uid()
                    or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_vocab_add on public.vr_vocab;
create policy vr_vocab_add on public.vr_vocab for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vr_projects p
                   where p.id = vr_vocab.project_id
                     and (p.user_id = auth.uid()
                          or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_vocab_write on public.vr_vocab;
create policy vr_vocab_write on public.vr_vocab for update to authenticated
  using (exists (select 1 from public.vr_projects p
           where p.id = vr_vocab.project_id
             and (p.user_id = auth.uid()
                  or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vr_projects p
                  where p.id = vr_vocab.project_id
                    and (p.user_id = auth.uid()
                         or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_vocab_drop on public.vr_vocab;
create policy vr_vocab_drop on public.vr_vocab for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_projects p
             where p.id = vr_vocab.project_id
               and p.user_id = auth.uid()));

-- vz_pairs
drop policy if exists vz_pairs_read on public.vz_pairs;
create policy vz_pairs_read on public.vz_pairs for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vz_projects p
             where p.id = vz_pairs.project_id
               and (p.user_id = auth.uid()
                    or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vz_pairs_add on public.vz_pairs;
create policy vz_pairs_add on public.vz_pairs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vz_projects p
                   where p.id = vz_pairs.project_id
                     and (p.user_id = auth.uid()
                          or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vz_pairs_write on public.vz_pairs;
create policy vz_pairs_write on public.vz_pairs for update to authenticated
  using (exists (select 1 from public.vz_projects p
           where p.id = vz_pairs.project_id
             and (p.user_id = auth.uid()
                  or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vz_projects p
                  where p.id = vz_pairs.project_id
                    and (p.user_id = auth.uid()
                         or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vz_pairs_drop on public.vz_pairs;
create policy vz_pairs_drop on public.vz_pairs for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vz_projects p
             where p.id = vz_pairs.project_id
               and p.user_id = auth.uid()));

-- vd_artifacts
drop policy if exists vd_artifacts_read on public.vd_artifacts;
create policy vd_artifacts_read on public.vd_artifacts for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vd_projects p
             where p.id = vd_artifacts.project_id
               and (p.user_id = auth.uid()
                    or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vd_artifacts_add on public.vd_artifacts;
create policy vd_artifacts_add on public.vd_artifacts for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vd_projects p
                   where p.id = vd_artifacts.project_id
                     and (p.user_id = auth.uid()
                          or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vd_artifacts_write on public.vd_artifacts;
create policy vd_artifacts_write on public.vd_artifacts for update to authenticated
  using (exists (select 1 from public.vd_projects p
           where p.id = vd_artifacts.project_id
             and (p.user_id = auth.uid()
                  or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vd_projects p
                  where p.id = vd_artifacts.project_id
                    and (p.user_id = auth.uid()
                         or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vd_artifacts_drop on public.vd_artifacts;
create policy vd_artifacts_drop on public.vd_artifacts for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vd_projects p
             where p.id = vd_artifacts.project_id
               and p.user_id = auth.uid()));

-- vd_outputs
drop policy if exists vd_outputs_read on public.vd_outputs;
create policy vd_outputs_read on public.vd_outputs for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vd_projects p
             where p.id = vd_outputs.project_id
               and (p.user_id = auth.uid()
                    or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vd_outputs_add on public.vd_outputs;
create policy vd_outputs_add on public.vd_outputs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vd_projects p
                   where p.id = vd_outputs.project_id
                     and (p.user_id = auth.uid()
                          or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vd_outputs_write on public.vd_outputs;
create policy vd_outputs_write on public.vd_outputs for update to authenticated
  using (exists (select 1 from public.vd_projects p
           where p.id = vd_outputs.project_id
             and (p.user_id = auth.uid()
                  or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vd_projects p
                  where p.id = vd_outputs.project_id
                    and (p.user_id = auth.uid()
                         or public.vd_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vd_outputs_drop on public.vd_outputs;
create policy vd_outputs_drop on public.vd_outputs for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vd_projects p
             where p.id = vd_outputs.project_id
               and p.user_id = auth.uid()));

-- vc_artifacts
drop policy if exists vc_artifacts_read on public.vc_artifacts;
create policy vc_artifacts_read on public.vc_artifacts for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vc_projects p
             where p.id = vc_artifacts.project_id
               and (p.user_id = auth.uid()
                    or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vc_artifacts_add on public.vc_artifacts;
create policy vc_artifacts_add on public.vc_artifacts for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vc_projects p
                   where p.id = vc_artifacts.project_id
                     and (p.user_id = auth.uid()
                          or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_artifacts_write on public.vc_artifacts;
create policy vc_artifacts_write on public.vc_artifacts for update to authenticated
  using (exists (select 1 from public.vc_projects p
           where p.id = vc_artifacts.project_id
             and (p.user_id = auth.uid()
                  or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vc_projects p
                  where p.id = vc_artifacts.project_id
                    and (p.user_id = auth.uid()
                         or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_artifacts_drop on public.vc_artifacts;
create policy vc_artifacts_drop on public.vc_artifacts for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vc_projects p
             where p.id = vc_artifacts.project_id
               and p.user_id = auth.uid()));

-- vc_targets
drop policy if exists vc_targets_read on public.vc_targets;
create policy vc_targets_read on public.vc_targets for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vc_projects p
             where p.id = vc_targets.project_id
               and (p.user_id = auth.uid()
                    or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vc_targets_add on public.vc_targets;
create policy vc_targets_add on public.vc_targets for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vc_projects p
                   where p.id = vc_targets.project_id
                     and (p.user_id = auth.uid()
                          or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_targets_write on public.vc_targets;
create policy vc_targets_write on public.vc_targets for update to authenticated
  using (exists (select 1 from public.vc_projects p
           where p.id = vc_targets.project_id
             and (p.user_id = auth.uid()
                  or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vc_projects p
                  where p.id = vc_targets.project_id
                    and (p.user_id = auth.uid()
                         or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_targets_drop on public.vc_targets;
create policy vc_targets_drop on public.vc_targets for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vc_projects p
             where p.id = vc_targets.project_id
               and p.user_id = auth.uid()));

-- vc_outputs
drop policy if exists vc_outputs_read on public.vc_outputs;
create policy vc_outputs_read on public.vc_outputs for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vc_projects p
             where p.id = vc_outputs.project_id
               and (p.user_id = auth.uid()
                    or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vc_outputs_add on public.vc_outputs;
create policy vc_outputs_add on public.vc_outputs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.vc_projects p
                   where p.id = vc_outputs.project_id
                     and (p.user_id = auth.uid()
                          or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_outputs_write on public.vc_outputs;
create policy vc_outputs_write on public.vc_outputs for update to authenticated
  using (exists (select 1 from public.vc_projects p
           where p.id = vc_outputs.project_id
             and (p.user_id = auth.uid()
                  or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.vc_projects p
                  where p.id = vc_outputs.project_id
                    and (p.user_id = auth.uid()
                         or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_outputs_drop on public.vc_outputs;
create policy vc_outputs_drop on public.vc_outputs for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vc_projects p
             where p.id = vc_outputs.project_id
               and p.user_id = auth.uid()));

-- va_artifacts
drop policy if exists va_artifacts_read on public.va_artifacts;
create policy va_artifacts_read on public.va_artifacts for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_artifacts.project_id
               and (p.user_id = auth.uid()
                    or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists va_artifacts_add on public.va_artifacts;
create policy va_artifacts_add on public.va_artifacts for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.va_projects p
                   where p.id = va_artifacts.project_id
                     and (p.user_id = auth.uid()
                          or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_artifacts_write on public.va_artifacts;
create policy va_artifacts_write on public.va_artifacts for update to authenticated
  using (exists (select 1 from public.va_projects p
           where p.id = va_artifacts.project_id
             and (p.user_id = auth.uid()
                  or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.va_projects p
                  where p.id = va_artifacts.project_id
                    and (p.user_id = auth.uid()
                         or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_artifacts_drop on public.va_artifacts;
create policy va_artifacts_drop on public.va_artifacts for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_artifacts.project_id
               and p.user_id = auth.uid()));

-- va_outputs
drop policy if exists va_outputs_read on public.va_outputs;
create policy va_outputs_read on public.va_outputs for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_outputs.project_id
               and (p.user_id = auth.uid()
                    or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists va_outputs_add on public.va_outputs;
create policy va_outputs_add on public.va_outputs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.va_projects p
                   where p.id = va_outputs.project_id
                     and (p.user_id = auth.uid()
                          or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_outputs_write on public.va_outputs;
create policy va_outputs_write on public.va_outputs for update to authenticated
  using (exists (select 1 from public.va_projects p
           where p.id = va_outputs.project_id
             and (p.user_id = auth.uid()
                  or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (select 1 from public.va_projects p
                  where p.id = va_outputs.project_id
                    and (p.user_id = auth.uid()
                         or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_outputs_drop on public.va_outputs;
create policy va_outputs_drop on public.va_outputs for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_outputs.project_id
               and p.user_id = auth.uid()));

-- va_jobs  — an editor may not queue one: a job runs code on the owner's desk
-- (VA-1 in docs/security.md). The app hides the button for a guest and says who
-- starts a job, so the rule and the screen agree.
drop policy if exists va_jobs_read on public.va_jobs;
create policy va_jobs_read on public.va_jobs for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_jobs.project_id
               and (p.user_id = auth.uid()
                    or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists va_jobs_add on public.va_jobs;
create policy va_jobs_add on public.va_jobs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.va_projects p
                   where p.id = va_jobs.project_id
                     and p.user_id = auth.uid()));

drop policy if exists va_jobs_write on public.va_jobs;
create policy va_jobs_write on public.va_jobs for update to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_jobs.project_id
               and p.user_id = auth.uid()))
  with check (user_id = auth.uid()
              or exists (select 1 from public.va_projects p
                   where p.id = va_jobs.project_id
                     and p.user_id = auth.uid()));

drop policy if exists va_jobs_drop on public.va_jobs;
create policy va_jobs_drop on public.va_jobs for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.va_projects p
             where p.id = va_jobs.project_id
               and p.user_id = auth.uid()));

-- ── BUG-2 · only the owner bins ─────────────────────────────────────
-- `deleted_at` is a decision about the whole document, and an editor could make
-- it. A row-level policy cannot say "this column only", so the decision is
-- guarded where the column is — a trigger, exactly as vn_notes has done from the
-- first migration. Restoring is the same decision, so it is guarded too.
create or replace function public.vpl_bin_is_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tbl   text := tg_table_name;
  owner uuid;
begin
  if auth.uid() is null then return new; end if;          -- the worker, not a person
  if new.deleted_at is not distinct from old.deleted_at then return new; end if;

  if right(tbl, 9) = '_projects' or tbl = 'vc_standards' then
    owner := old.user_id;                                 -- a container is its own owner
  else
    execute format('select user_id from public.%I where id = $1',
                   split_part(tbl, '_', 1) || '_projects')
      into owner using old.project_id;
  end if;
  owner := coalesce(owner, old.user_id);

  if owner = auth.uid() then return new; end if;
  raise exception 'only the owner may put this in the bin, or take it out'
    using errcode = 'insufficient_privilege';
end;
$$;
comment on function public.vpl_bin_is_the_owners() is
  'A bin is the owner''s decision. An editor writes text; it does not remove the document.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'vi_projects', 'vr_projects', 'vz_projects', 'vd_projects', 'vc_projects', 'va_projects',
    'vi_ideas', 'vr_reqs', 'vz_pairs', 'vd_artifacts', 'vd_outputs',
    'vc_artifacts', 'vc_targets', 'vc_outputs', 'vc_standards',
    'va_artifacts', 'va_outputs'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_bin_guard', t);
    execute format('create trigger %I before update on public.%I '
                   'for each row execute function public.vpl_bin_is_the_owners()',
                   t || '_bin_guard', t);
  end loop;
end;
$$;

-- ── BUG-6 · a note's place is the owner's ───────────────────────────
-- `parent_id` and `position` are where the note sits: which chapter, in which
-- order. An editor may rewrite the words; moving somebody's note into somebody
-- else's chapter is a structural edit. The generic owner guard cannot carry this
-- one — it refuses a column for everybody, and an owner must be able to move
-- their own notes — so it is its own trigger.
create or replace function public.vn_structure_is_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or old.user_id = auth.uid() then return new; end if;
  if new.parent_id is distinct from old.parent_id
     or new."position" is distinct from old."position" then
    raise exception 'only the owner moves or reorders this note'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
comment on function public.vn_structure_is_the_owners() is
  'Sharing a note shares its words. Its place in the tree is the owner''s.';

drop trigger if exists vn_notes_structure_guard on public.vn_notes;
create trigger vn_notes_structure_guard before update on public.vn_notes
  for each row execute function public.vn_structure_is_the_owners();

-- ── BUG-7 · a verdict comes from a run ──────────────────────────────
-- The three counts on a control are the verdict. An editor may run a check (the
-- app offers `run` to anybody who is not a viewer) and a run writes the counts; a
-- patch with no run behind it does not. The owner may always correct a row by
-- hand — it is their document.
create or replace function public.vc_a_verdict_comes_from_a_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.n_pass is not distinct from old.n_pass
     and new.n_fail is not distinct from old.n_fail
     and new.n_unknown is not distinct from old.n_unknown then
    return new;
  end if;
  if exists (select 1 from public.vc_projects p
              where p.id = new.project_id and p.user_id = auth.uid()) then
    return new;
  end if;
  if exists (select 1 from public.vc_runs r
              where r.project_id = new.project_id
                and r.user_id = auth.uid()
                and r.created_at > now() - interval '1 hour') then
    return new;
  end if;
  raise exception 'a verdict comes from a run, not from a patch'
    using errcode = 'insufficient_privilege';
end;
$$;
comment on function public.vc_a_verdict_comes_from_a_run() is
  'An editor runs a check and the counts follow the run. A hand-written verdict is the owner''s.';

drop trigger if exists vc_targets_verdict_guard on public.vc_targets;
create trigger vc_targets_verdict_guard before update on public.vc_targets
  for each row execute function public.vc_a_verdict_comes_from_a_run();

commit;

-- ── rollback ────────────────────────────────────────────────────────
-- The old policies are in the migrations that made them (20261123 vi_shares,
-- 20261125 vr_core, 20261126 vr_work, 20261128 vz_core, 20261129 vd_core,
-- 20261130 vc_core, 20261205 va_core, 20261206 va_jobs, 20261213 vc_targets).
-- Re-running those statements restores the old rules; this rollback removes only
-- what this file adds.
-- begin;
-- drop trigger if exists vc_targets_verdict_guard on public.vc_targets;
-- drop trigger if exists vn_notes_structure_guard on public.vn_notes;
-- drop function if exists public.vc_a_verdict_comes_from_a_run();
-- drop function if exists public.vn_structure_is_the_owners();
-- drop function if exists public.vpl_bin_is_the_owners();
-- commit;
