-- 0001 — the schema vpl runs on, as one file.
--
-- Taken from the live database with `supabase db dump` once the schema stopped
-- moving, so a new project can be built in one step:
--
--   npx supabase link --project-ref <ref>
--   npx supabase db push --remote
--
-- The project that is live at vn.terg.hr applied the same schema as a series of
-- small migrations; this file is that series with the history folded in. From
-- here on, changes are new numbered files beside it — never edits to this one.
--
-- Everything below is plain Postgres: two tables, a handful of functions and
-- triggers, row level security as the only lock, and grants that say out loud
-- who may execute what.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';









CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";












CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."account_exists"("who" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(who))
  );
$$;


ALTER FUNCTION "public"."account_exists"("who" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."account_hint"("who" "text") RETURNS TABLE("found" boolean, "name" "text", "made" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select true,
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''),
                  nullif(u.raw_user_meta_data ->> 'name', '')),
         u.created_at
    from auth.users u
   where lower(u.email) = lower(btrim(who))
   limit 1;
$$;


ALTER FUNCTION "public"."account_hint"("who" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_my_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  me   uuid := auth.uid();
  mine text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select u.email into mine from auth.users u where u.id = me;

  -- grants I handed out, and grants handed to me
  delete from public.note_shares where owner_id = me;
  delete from public.note_shares where lower(email) = lower(coalesce(mine, ''));

  delete from public.notes where user_id = me;
  delete from auth.users where id = me;
end;
$$;


ALTER FUNCTION "public"."delete_my_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_shares_known_target"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
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


ALTER FUNCTION "public"."note_shares_known_target"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_shares_mint_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.code is null and new.email is null then
    /* 64 bits of the same generator the primary keys use */
    new.code := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16);
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."note_shares_mint_code"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."note_shares_mint_code"() IS 'A public link needs a code, a person grant must not have one. Decided here, not by the client.';



CREATE OR REPLACE FUNCTION "public"."notes_only_owner_bins"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and auth.uid() <> old.user_id then
    raise exception 'only the owner may delete or restore this note'
      using errcode = '42501';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."notes_only_owner_bins"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notes_only_owner_bins"() IS 'A shared editor may change content; only the owner may bin or restore.';



CREATE OR REPLACE FUNCTION "public"."purge_test_accounts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  doomed uuid[];
begin
  select coalesce(array_agg(id), '{}') into doomed
    from auth.users
   where email ~ '^(own|view|edit|nos|del|pal|friend|dnd|tree|plain|fresh|schema|shot|vpl-a|vpl-b|e2e)-?[0-9]{9,}@example\.com$'
      or email ~ '^miki[0-9]{9,}@vpl\.local$';

  if array_length(doomed, 1) is null then
    return 0;
  end if;

  delete from public.note_shares
   where owner_id = any(doomed)
      or note_id in (select id from public.notes where user_id = any(doomed));
  delete from public.note_shares
   where lower(email) in (select lower(email) from auth.users where id = any(doomed));

  delete from public.notes where user_id = any(doomed);
  delete from auth.users where id = any(doomed);

  return array_length(doomed, 1);
end;
$_$;


ALTER FUNCTION "public"."purge_test_accounts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."read_share"("p_code" "text") RETURNS TABLE("id" "uuid", "title" "text", "body" "text", "parent_id" "uuid", "position" integer, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."read_share"("p_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."read_share"("p_code" "text") IS 'The rows behind one public code. Handed the code, so no account and no listing.';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."share_role"("note" "uuid", "viewer_email" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."share_role"("note" "uuid", "viewer_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."share_role"("note" "uuid", "viewer_email" "text") IS 'Nearest personal grant covering this note or an ancestor. A public code is not a grant; it is read through read_share().';



CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."note_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "code" "text",
    "email" "text",
    "role" "text" DEFAULT 'view'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pending" boolean DEFAULT false NOT NULL,
    CONSTRAINT "note_shares_one_target" CHECK ((("code" IS NULL) <> ("email" IS NULL))),
    CONSTRAINT "note_shares_role_check" CHECK (("role" = ANY (ARRAY['view'::"text", 'edit'::"text"])))
);


ALTER TABLE "public"."note_shares" OWNER TO "postgres";


COMMENT ON COLUMN "public"."note_shares"."code" IS 'Public link token. Read-only for anyone, signed in or not.';



COMMENT ON COLUMN "public"."note_shares"."email" IS 'Lowercased address of the one account this grant is for.';



COMMENT ON COLUMN "public"."note_shares"."role" IS 'view = read and render. edit = also change the content.';



COMMENT ON COLUMN "public"."note_shares"."pending" IS 'Waiting for its address to have an account. Grants nothing until the owner clears it.';



CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "parent_id" "uuid",
    "is_public" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "notes_no_self_parent" CHECK ((("parent_id" IS NULL) OR ("parent_id" <> "id")))
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."notes"."parent_id" IS 'null = a root note. Otherwise this note sits under that note.';



COMMENT ON COLUMN "public"."notes"."deleted_at" IS 'null = live. Non-null = in the recycle bin. Rows are never removed from the app.';



COMMENT ON COLUMN "public"."notes"."position" IS 'Order among siblings under the same parent. Lower comes first.';



ALTER TABLE ONLY "public"."note_shares"
    ADD CONSTRAINT "note_shares_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."note_shares"
    ADD CONSTRAINT "note_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



CREATE INDEX "note_shares_email_idx" ON "public"."note_shares" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "note_shares_note_email_key" ON "public"."note_shares" USING "btree" ("note_id", "lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "note_shares_note_idx" ON "public"."note_shares" USING "btree" ("note_id");



CREATE INDEX "notes_deleted_idx" ON "public"."notes" USING "btree" ("user_id", "deleted_at" DESC) WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "notes_live_idx" ON "public"."notes" USING "btree" ("user_id", "updated_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "notes_parent_id_idx" ON "public"."notes" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "notes_parent_idx" ON "public"."notes" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "notes_sibling_idx" ON "public"."notes" USING "btree" ("user_id", "parent_id", "position");



CREATE INDEX "notes_user_updated_idx" ON "public"."notes" USING "btree" ("user_id", "updated_at" DESC);



CREATE OR REPLACE TRIGGER "note_shares_code" BEFORE INSERT ON "public"."note_shares" FOR EACH ROW EXECUTE FUNCTION "public"."note_shares_mint_code"();



CREATE OR REPLACE TRIGGER "note_shares_known_target" BEFORE INSERT OR UPDATE OF "email", "pending" ON "public"."note_shares" FOR EACH ROW EXECUTE FUNCTION "public"."note_shares_known_target"();



CREATE OR REPLACE TRIGGER "notes_only_owner_bins" BEFORE UPDATE ON "public"."notes" FOR EACH ROW EXECUTE FUNCTION "public"."notes_only_owner_bins"();



CREATE OR REPLACE TRIGGER "notes_touch" BEFORE UPDATE ON "public"."notes" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."note_shares"
    ADD CONSTRAINT "note_shares_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."note_shares"
    ADD CONSTRAINT "note_shares_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."note_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notes_owner_purges" ON "public"."notes" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND ("deleted_at" IS NOT NULL)));



COMMENT ON POLICY "notes_owner_purges" ON "public"."notes" IS 'a binned note may be deleted for good, by its owner only';



CREATE POLICY "own all" ON "public"."notes" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "shared edit" ON "public"."notes" FOR UPDATE TO "authenticated" USING (("public"."share_role"("id", "lower"(("auth"."jwt"() ->> 'email'::"text"))) = 'edit'::"text")) WITH CHECK (("public"."share_role"("id", "lower"(("auth"."jwt"() ->> 'email'::"text"))) = 'edit'::"text"));



CREATE POLICY "shared read" ON "public"."notes" FOR SELECT TO "authenticated", "anon" USING (("public"."share_role"("id", "lower"(("auth"."jwt"() ->> 'email'::"text"))) IS NOT NULL));



CREATE POLICY "shares by code" ON "public"."note_shares" FOR SELECT TO "authenticated", "anon" USING (("code" IS NOT NULL));



CREATE POLICY "shares by owner" ON "public"."note_shares" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."notes" "n"
  WHERE (("n"."id" = "note_shares"."note_id") AND ("n"."user_id" = "auth"."uid"()))))));



CREATE POLICY "shares for me" ON "public"."note_shares" FOR SELECT TO "authenticated" USING ((("email" IS NOT NULL) AND ("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."account_exists"("who" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."account_exists"("who" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."account_exists"("who" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."account_hint"("who" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."account_hint"("who" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."account_hint"("who" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_my_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "service_role";



GRANT ALL ON FUNCTION "public"."note_shares_known_target"() TO "anon";
GRANT ALL ON FUNCTION "public"."note_shares_known_target"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."note_shares_known_target"() TO "service_role";



GRANT ALL ON FUNCTION "public"."note_shares_mint_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."note_shares_mint_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."note_shares_mint_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notes_only_owner_bins"() TO "anon";
GRANT ALL ON FUNCTION "public"."notes_only_owner_bins"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notes_only_owner_bins"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_test_accounts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_test_accounts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."read_share"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."read_share"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."read_share"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."read_share"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."share_role"("note" "uuid", "viewer_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."share_role"("note" "uuid", "viewer_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."share_role"("note" "uuid", "viewer_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."note_shares" TO "anon";
GRANT ALL ON TABLE "public"."note_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."note_shares" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notes" TO "authenticated";
GRANT ALL ON TABLE "public"."notes" TO "service_role";



GRANT UPDATE("title") ON TABLE "public"."notes" TO "authenticated";



GRANT UPDATE("body") ON TABLE "public"."notes" TO "authenticated";



GRANT UPDATE("tags") ON TABLE "public"."notes" TO "authenticated";



GRANT UPDATE("parent_id") ON TABLE "public"."notes" TO "authenticated";



GRANT UPDATE("deleted_at") ON TABLE "public"."notes" TO "authenticated";



GRANT UPDATE("position") ON TABLE "public"."notes" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































