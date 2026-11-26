/* vpl · vz — the whole database surface of this app, in one file.
 *
 * Three tables: a project, its keys, its shares. supabase-js comes from a CDN —
 * no bundler, and nothing here knows about the screen.
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

const P = 'id,user_id,title,note,hide_values,published,publish_code,created_at,updated_at,deleted_at';
const K = 'id,project_id,key,value,deleted_at,created_at,updated_at';
const SH = 'id,project_id,owner_id,code,email,role,pending,created_at';

/* ── auth ─────────────────────────────────────────────────────────── */
export async function session() {
  const db = await client();
  const { data } = await db.auth.getSession();
  return data.session ?? null;
}

export async function onAuthChange(fn) {
  const db = await client();
  db.auth.onAuthStateChange((_e, s) => fn(s));
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

/* ── projects ─────────────────────────────────────────────────────── */
export async function listProjects({ bin = false } = {}) {
  const db = await client();
  let q = db.from('vz_projects').select(P);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('deleted_at', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

/* a dictionary is the container; ✕ bins it. Publishing is separate: a binned
 * project stops answering at its public address, because the read function only
 * serves live rows. */
export async function binProject(id) {
  return updateProject(id, { deleted_at: new Date().toISOString() });
}

export async function restoreProject(id) {
  return updateProject(id, { deleted_at: null });
}

export async function createProject(title = 'untitled') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vz_projects')
    .insert({ user_id: s.user.id, title }).select(P).single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vz_projects')
    .update(patch).eq('id', id).select(P).single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const db = await client();
  const { error } = await db.from('vz_projects').delete().eq('id', id);
  if (error) throw error;
}

/* Publishing is a promise, not a share: the project answers at /p/<code> and
 * anybody may read it. The code is made once, so a URL that was handed out
 * keeps working when the switch is turned off and on again. */
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export async function setPublished(project, on) {
  const patch = on
    ? { published: true, publish_code: project.publish_code || newCode() }
    : { published: false };
  return updateProject(project.id, patch);
}

export async function setHideValues(project, hide) {
  return updateProject(project.id, { hide_values: !!hide });
}

/* ── keys ─────────────────────────────────────────────────────────── */
export async function listPairs(projectId, { bin = false } = {}) {
  const db = await client();
  let q = db.from('vz_pairs').select(K).eq('project_id', projectId);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('key', { ascending: true });
  if (error) throw error;
  return data;
}

/* A key is a name that ignores case, so "DB_HOST" and "db_host" are one row.
 * The caller has the project's keys in hand and checks there first; this is
 * the write either way. */
export async function addPair(projectId, key, value = '') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vz_pairs')
    .insert({ user_id: s.user.id, project_id: projectId, key, value })
    .select(K).single();
  if (error) throw error;
  return data;
}

export async function addPairs(projectId, rows) {
  if (!rows.length) return [];
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vz_pairs')
    .insert(rows.map((r) => ({ user_id: s.user.id, project_id: projectId, key: r.key, value: r.value })))
    .select(K);
  if (error) throw error;
  return data;
}

export async function updatePair(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vz_pairs')
    .update(patch).eq('id', id).select(K).single();
  if (error) throw error;
  return data;
}

/* The bin is a timestamp, not a second table: a marked row keeps its key so a
 * restore never collides with a living one. */
export async function binPair(id) {
  return updatePair(id, { deleted_at: new Date().toISOString() });
}

export async function restorePair(id) {
  return updatePair(id, { deleted_at: null });
}

export async function purgePair(id) {
  const db = await client();
  const { error } = await db.from('vz_pairs').delete().eq('id', id);
  if (error) throw error;
}

export async function emptyBin(projectId) {
  const db = await client();
  const { error } = await db.from('vz_pairs').delete()
    .eq('project_id', projectId).not('deleted_at', 'is', null);
  if (error) throw error;
}

/* ── sharing: a link or a person ──────────────────────────────────── */
export async function listShares(projectId) {
  const db = await client();
  const { data, error } = await db.from('vz_shares').select(SH)
    .eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function makeLink(projectId) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vz_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, code: newCode(), pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function revokeShare(id) {
  const db = await client();
  const { error } = await db.from('vz_shares').delete().eq('id', id);
  if (error) throw error;
}

export async function shareWith(projectId, email, role = 'view') {
  const db = await client();
  const s = await session();
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) throw new Error('that is not an address');
  const { data: had } = await db.from('vz_shares').select(SH)
    .eq('project_id', projectId).eq('email', addr).maybeSingle();
  if (had) {
    const { data, error } = await db.from('vz_shares')
      .update({ role, pending: false }).eq('id', had.id).select(SH).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from('vz_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, email: addr, role, pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function readShare(code) {
  const db = await client();
  const { data, error } = await db.rpc('vz_read_share', { p_code: code });
  if (error) throw error;
  return data || null;
}

export async function readPublic(code) {
  const db = await client();
  const { data, error } = await db.rpc('vz_read_public', { p_code: code });
  if (error) throw error;
  return data || null;
}

export async function roleOn(project) {
  const s = await session();
  if (!s || !project) return null;
  if (project.user_id === s.user.id) return 'owner';
  const db = await client();
  const { data, error } = await db.rpc('vz_share_role', {
    project: project.id, viewer_email: (s.user.email || '').toLowerCase(),
  });
  if (error) return null;
  return data || null;
}

/* A shared dictionary can become yours: same keys, same values, new project,
 * fresh ids. The bin stays home and so do the shares — a copy starts private. */
export async function copyToMe(src, pairs) {
  const db = await client();
  const s = await session();
  const { data: p, error } = await db.from('vz_projects').insert({
    user_id: s.user.id,
    title: `${src.title} (copy)`.slice(0, 120),
    note: src.note || '',
    hide_values: src.hide_values !== false,
  }).select(P).single();
  if (error) throw error;

  const rows = (pairs || []).map((r) => ({ user_id: s.user.id, project_id: p.id, key: r.key, value: r.value }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error: e } = await db.from('vz_pairs').insert(rows.slice(i, i + 50));
    if (e) throw e;
  }
  return p;
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
