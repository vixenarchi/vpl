/* vpl · vi — the whole database surface of this app, in one file.
 *
 * Kept in one place on purpose: if the suite ever grows a second backend
 * (local PostgreSQL, or SQLite for an offline build), this is the only file
 * that has to change. supabase-js arrives from a CDN because there is no
 * bundler.
 */

let _client = null;

function cfg() {
  const c = window.__VPL_CONFIG__;
  if (!c) throw new Error('missing config.local.js');
  return c;
}

async function client() {
  if (_client) return _client;
  const c = cfg();
  if (!window.supabase) await loadScript(c.lib);
  _client = window.supabase.createClient(c.url, c.anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return _client;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load supabase-js'));
    document.head.append(s);
  });
}

const FIELDS = 'id,text,done,created_at,updated_at';

export async function session() {
  const db = await client();
  const { data } = await db.auth.getSession();
  return data.session ?? null;
}

export async function onAuthChange(fn) {
  const db = await client();
  db.auth.onAuthStateChange((_event, s) => fn(s));
}

export async function signIn(email, password) {
  const db = await client();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  const db = await client();
  const { data, error } = await db.auth.signUp({
    email, password, options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  if (!data.session) throw new Error('confirm your address first');
}

export async function signOut() {
  const db = await client();
  await db.auth.signOut();
}

export async function listIdeas() {
  const db = await client();
  const { data, error } = await db.from('vi_ideas').select(FIELDS).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addIdea(text) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vi_ideas')
    .insert({ user_id: s.user.id, text }).select(FIELDS).single();
  if (error) throw error;
  return data;
}

export async function setIdeaDone(id, done) {
  const db = await client();
  const { data, error } = await db.from('vi_ideas')
    .update({ done }).eq('id', id).select(FIELDS).single();
  if (error) throw error;
  return data;
}

export async function deleteIdea(id) {
  const db = await client();
  const { error } = await db.from('vi_ideas').delete().eq('id', id);
  if (error) throw error;
}
