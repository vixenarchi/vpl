/* vpl · vp — three tables and five calls. Nothing here knows about the screen.
 *
 * vp_codes  slips an owner makes (hashed at rest; the plaintext came back once)
 * vp_keys   what a slip becomes after redeeming (hashed at rest)
 * vp_charges one row per call made through the door — metadata only
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

const C = 'id,owner_id,label,credits,valid_until,revoked,redeemed_by,redeemed_at,created_at';
const K = 'id,code_id,owner_id,holder_id,label,credits_left,valid_until,calls,revoked,created_at,last_used_at';
const H = 'id,key_id,app,model,in_tokens,out_tokens,ms,status,created_at';

/* ── auth ─────────────────────────────────────────────────────────── */
export async function session() {
  const db = await client();
  const { data } = await db.auth.getSession();
  return data.session ?? null;
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
  await db.auth.signOut();
}

export function onAuthChange(fn) {
  client().then((db) => db.auth.onAuthStateChange((_e, s) => fn(s)));
}

/* ── slips ────────────────────────────────────────────────────────── */
export async function makeCodes({ count, credits, until, label }) {
  const db = await client();
  const { data, error } = await db.rpc('vp_make_codes', {
    p_count: count, p_credits: credits, p_until: until || null, p_label: label || '',
  });
  if (error) throw error;
  return data || [];
}

export async function listCodes() {
  const db = await client();
  const { data, error } = await db.from('vp_codes').select(C)
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

export async function revokeCode(id) {
  const db = await client();
  const { error } = await db.from('vp_codes').update({ revoked: true }).eq('id', id);
  if (error) throw error;
}

/* ── keys ─────────────────────────────────────────────────────────── */
export async function redeem(code) {
  const db = await client();
  const { data, error } = await db.rpc('vp_redeem', { p_code: code });
  if (error) throw error;
  return (data || [])[0] || null;
}

export async function listKeys() {
  const db = await client();
  const { data, error } = await db.from('vp_keys').select(K)
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

export async function revokeKey(id) {
  const db = await client();
  const { error } = await db.from('vp_keys').update({ revoked: true }).eq('id', id);
  if (error) throw error;
}

export async function charges() {
  const db = await client();
  const { data, error } = await db.from('vp_charges').select(H)
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

/* ── the account itself ──────────────────────────────────────────────
 * The person is the suite's, not this app's: a name and a password are auth
 * calls against the same user, so they work from any app that is signed in. */
export async function setAccount(patch) {
  const db = await client();
  const body = {};
  if (patch.name !== undefined) body.data = { full_name: patch.name };
  if (patch.password !== undefined) body.password = patch.password;
  const { data, error } = await db.auth.updateUser(body);
  if (error) throw error;
  return data.user;
}
