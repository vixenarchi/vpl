-- vp_spend: the model is the issuer's, never the caller's guess.
--
-- The door documented "uses the issuer's model, not the caller's guess" and the
-- SQL did the opposite:
--
--   provider_model := coalesce(nullif(trim(p_model), ''), a.model)
--
-- so any name the caller sent went upstream, and an agent that calls its model
-- `nemotron` (or `vpl/gemini-…`) made the provider answer 404 for a model that
-- does not exist. The caller's `model` is now only a label for the ledger row;
-- what reaches the provider is exactly what the person who saved the key chose.

create or replace function public.vp_spend(p_hash text, p_app text, p_model text)
returns table (ok boolean, reason text, key_id uuid, provider_url text,
               provider_model text, provider_key text, credits_left int, calls_left int)
language plpgsql security definer
set search_path = public, auth
as $$
declare
  k public.vp_keys;
  a public.vpl_ai;
begin
  select * into k from public.vp_keys
   where key_hash = p_hash for update;
  if not found then
    ok := false; reason := 'that key is not one of ours'; return next; return;
  end if;
  if k.revoked then
    ok := false; reason := 'that key was revoked'; return next; return;
  end if;
  if k.valid_until is not null and k.valid_until < current_date then
    ok := false; reason := 'that key expired on ' || k.valid_until; return next; return;
  end if;
  if k.credits_left < 1 then
    ok := false; reason := 'that key is out of calls'; return next; return;
  end if;

  select * into a from public.vpl_ai where user_id = k.owner_id;
  if not found or a.api_key = '' or a.model = '' then
    ok := false; reason := 'the person who made this code has no model saved'; return next; return;
  end if;

  update public.vp_keys
     set credits_left = public.vp_keys.credits_left - 1,
         calls = public.vp_keys.calls + 1,
         last_used_at = now()
   where id = k.id;

  ok := true; reason := null; key_id := k.id;
  provider_url := a.url;
  provider_key := a.api_key;
  provider_model := a.model;
  credits_left := k.credits_left - 1; calls_left := k.calls + 1;
  return next;
end;
$$;

revoke all on function public.vp_spend(text, text, text) from public, anon, authenticated;
grant execute on function public.vp_spend(text, text, text) to service_role;
