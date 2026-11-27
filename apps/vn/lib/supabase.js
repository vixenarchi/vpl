/* lib/supabase.js — one client, one wrapper.
 *
 * The database is the API (§5). This file exists only to hold the client and
 * to give the rest of the app a small, honest vocabulary: list, get, create,
 * update, remove. No query builder escapes this module.
 */

const cfg = window.__VPL_CONFIG__;
if (!cfg || !cfg.url || !cfg.anon) {
  throw new Error('missing config.local.js — copy config.example.js and fill it in');
}

/* supabase-js is loaded from a CDN because there is no bundler (§4.4).
 * Loaded once, lazily, so the sign-in screen can paint before the network. */
let _client = null;

async function client() {
  if (_client) return _client;
  if (!window.supabase) {
    await loadScript(cfg.lib);
  }
  _client = window.supabase.createClient(cfg.url, cfg.anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return _client;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

/* ── auth ─────────────────────────────────────────────────────────── */

export async function session() {
  const db = await client();
  const { data, error } = await db.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

/** The session's token, for the parts of the shell that speak REST directly
 *  (the model settings' "keep the key on my account"). Null when nobody is
 *  signed in — the caller decides what that means. */
export async function currentToken() {
  const db = await client();
  const { data } = await db.auth.getSession();
  return data?.session?.access_token || null;
}

export async function onAuthChange(fn) {
  const db = await client();
  const { data } = db.auth.onAuthStateChange((_event, s) => fn(s));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const db = await client();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const db = await client();
  const { data, error } = await db.auth.signUp({
    email,
    password,
    // the link in the mail must come back here, not to the project's Site URL
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;

  // With confirmations off, signUp already returns a session. With them on it
  // returns a user and no session, and the account is unusable until the link
  // in the mail is clicked — say so instead of failing at the next call.
  if (!data?.session) return { needsConfirm: true, user: data?.user || null };

  await signIn(email, password);
  return { needsConfirm: false, user: data.user };
}

export async function signInWithGoogle() {
  const db = await client();
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  const db = await client();
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

/* ── notes (§4.1, one table) ──────────────────────────────────────── */

/* position orders siblings in the tree and must be part of every read, or
 * the returned row has no such key and the tree sorts on undefined. */
const FIELDS = 'id,user_id,title,body,tags,parent_id,position,is_public,deleted_at,created_at,updated_at';

/* R8: newest first. Title and a hint of body, not the whole body.
 * Deleted notes are returned too — the app separates them, so one request
 * feeds both the list and the recycle bin. */
export async function listNotes() {
  const db = await client();
  const { data, error } = await db
    .from('vn_notes')
    /* created_at is needed to keep sibling order stable. Without it the
     * tie-break compared Invalid Date and the tree came out in an arbitrary
     * order that changed between renders. */
    /* user_id is part of every read because a note you do not own is drawn
     * differently: read-only, no share button, not draggable. */
    .select('id,user_id,title,body,parent_id,position,deleted_at,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getNote(id) {
  const db = await client();
  const { data, error } = await db.from('vn_notes').select(FIELDS).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createNote(patch = {}) {
  const db = await client();
  const s = await session();
  if (!s?.user) throw new Error('not signed in');

  /* The user_id default was removed in v1's fix migration because
   * auth.uid() is NULL before confirmation, which turned a policy check into
   * an unknown and failed confusingly. Send it explicitly. */
  const row = { user_id: s.user.id, title: '', body: '', ...patch };
  const { data, error } = await db.from('vn_notes').insert(row).select(FIELDS).single();
  if (error) throw error;
  return data;
}

export async function updateNote(id, patch) {
  const db = await client();
  const { data, error } = await db
    .from('vn_notes').update(patch).eq('id', id).select(FIELDS).single();
  if (error) throw error;
  return data;
}

export async function deleteNote(id) {
  const db = await client();
  const { error } = await db.from('vn_notes').delete().eq('id', id);
  if (error) throw error;
}

/* Delete for good — only what is already in the bin. The database enforces
 * that (`notes_owner_purges` requires deleted_at is not null): this is the
 * second, deliberate act, never the first. */
export async function purgeNote(id) {
  const db = await client();
  const { error } = await db.from('vn_notes').delete().eq('id', id);
  if (error) throw error;
}

/* The whole bin, in one trip. Postgres takes the ids; the app passes what it
 * already knows is binned, so nothing live can be caught by a stale list. */
export async function purgeNotes(ids) {
  if (!ids.length) return;
  const db = await client();
  const { error } = await db.from('vn_notes').delete().in('id', ids);
  if (error) throw error;
}

/* ── sharing (one grant table, §4.1 of the spec) ─────────────────────
 * A grant names a note and either a public `code` or an `email` + role.
 * It covers that note and everything under it, so one link shares a whole
 * chapter. The database generates the code; the client never chooses one.
 */

const SHARE_FIELDS = 'id,note_id,owner_id,code,email,role,pending,created_at';

/* Everything this viewer may see: grants it owns, grants addressed to it, and
 * any public code (a public link has to resolve without an account). The app
 * sorts the three apart; the database decides which ones exist here. */
export async function listShares() {
  const db = await client();
  const { data, error } = await db.from('vn_shares')
    .select(SHARE_FIELDS)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/* A code is handed to a function, never used as a filter on a table: a filter
 * on a table means the table can be read, and a table of codes is a list of
 * everybody's public links. `vn_link_info` answers with the one root this code
 * opens (or nothing). No account needed, and nothing to enumerate. */
export async function getShareByCode(code) {
  const db = await client();
  const { data, error } = await db.rpc('vn_link_info', { p_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

/* The rows behind a link: a security definer function handed the code, so a
 * reader needs no account and no note ever appears in someone else's list. */
export async function readShare(code) {
  const db = await client();
  const { data, error } = await db.rpc('vn_read_share', { p_code: code });
  if (error) throw error;
  return data || [];
}

/* code is left out on purpose so the column default generates it */
export async function addPublicLink(noteId) {
  const db = await client();
  const { data, error } = await db.from('vn_shares')
    .insert({ note_id: noteId })
    .select(SHARE_FIELDS).single();
  if (error) throw error;
  return data;
}

/* A grant for an address with no account is stored as waiting: it grants
 * nothing until it is allowed, and only then must the account exist. */
export async function addEmailShare(noteId, email, role, pending = false) {
  const db = await client();
  const { data, error } = await db.from('vn_shares')
    .insert({ note_id: noteId, email: email.trim().toLowerCase(), role, pending })
    .select(SHARE_FIELDS).single();
  if (error) throw error;
  return data;
}

/* Turns a waiting invitation into a real grant. The database refuses it if the
 * address still has no account, so this cannot be used to guess one. */
export async function allowShare(id) {
  const db = await client();
  const { data, error } = await db.from('vn_shares')
    .update({ pending: false })
    .eq('id', id)
    .select(SHARE_FIELDS).single();
  if (error) throw error;
  return data;
}

export async function setShareRole(id, role) {
  const db = await client();
  const { data, error } = await db.from('vn_shares')
    .update({ role }).eq('id', id).select(SHARE_FIELDS).single();
  if (error) throw error;
  return data;
}

export async function removeShare(id) {
  const db = await client();
  const { error } = await db.from('vn_shares').delete().eq('id', id);
  if (error) throw error;
}

/* Is this address registered? Sharing is only allowed with an existing account,
 * so the dialog can explain instead of silently storing a grant nobody can use. */
export async function accountExists(email) {
  const db = await client();
  const { data, error } = await db.rpc('vn_account_exists', { who: email });
  if (error) throw error;
  return data === true;
}

/* Name and age of the account behind an address, if there is one. Used only to
 * show the owner what they are about to trust. */
export async function accountHint(email) {
  const db = await client();
  const { data, error } = await db.rpc('vn_account_hint', { who: email });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { name: row.name || '', made: row.made };
}

/* Removes the account, its notes and every grant it handed out. Runs in the
 * database as the table owner, keyed on the caller's JWT, so it can only ever
 * delete the caller's own rows. */
export async function deleteAccount() {
  const db = await client();
  const { error } = await db.rpc('vn_delete_my_account');
  if (error) throw error;
}

/* A new password for the account you are already signed into. Nothing is
 * emailed and nothing is confirmed: you are the person holding the session. */
export async function setPassword(password) {
  const db = await client();
  const { data, error } = await db.auth.updateUser({ password });
  if (error) throw error;
  return data.user;
}

/* Optional name, used only to greet you. Google already fills it in. */
export async function setName(name) {
  const db = await client();
  const { data, error } = await db.auth.updateUser({ data: { full_name: name } });
  if (error) throw error;
  return data.user;
}
