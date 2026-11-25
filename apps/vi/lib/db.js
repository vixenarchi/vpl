/* vpl · vi — the whole database surface of this app, in one file.
 *
 * Two tables, one level of nesting, owner-only through RLS. Kept in one place
 * because if the suite ever grows a second backend, this is the file that
 * changes and nothing else. supabase-js arrives from a CDN: no bundler.
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

const P = 'id,user_id,title,context,exploration,simulation,chosen_id,created_at,updated_at';
const I = 'id,project_id,text,stage,color,reason,exploration,explored_at,position,created_at,updated_at,deleted_at';

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

/* Signing out must leave nothing behind that could sign anybody back in: the
 * client drops its session, and every chunk of it still in storage goes too.
 * supabase-js writes sb-<ref>-auth-token plus .0/.1 for a large session, and a
 * leftover chunk is what makes "log out" a suggestion rather than an event. */
export async function signOut() {
  const db = await client();
  try { await db.auth.signOut({ scope: 'local' }); } catch { /* already gone */ }
  const c = cfg();
  const ref = String(c.url || '').replace(/^https?:\/\//, '').split('.')[0];
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === `sb-${ref}-auth-token` || k.startsWith(`sb-${ref}-auth-token.`)) localStorage.removeItem(k);
    }
  } catch { /* private mode */ }
}

/** The live token, from the client that owns the session. Storage can lag; this
 *  cannot, and it is what the account key and the settings test ask for. */
export async function currentToken() {
  const db = await client();
  const { data } = await db.auth.getSession();
  return data?.session?.access_token || null;
}

/** One callback per change of person: (event, userId). */
export async function watchAuth(cb) {
  const db = await client();
  db.auth.onAuthStateChange((event, session) => {
    cb(event, session?.user?.id || null);
  });
}

/* ── projects: one row is one funnel ──────────────────────────────── */
export async function listProjects() {
  const db = await client();
  const { data, error } = await db.from('vi_projects').select(P).order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProject(title = 'untitled funnel') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vi_projects')
    .insert({ user_id: s.user.id, title }).select(P).single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vi_projects')
    .update(patch).eq('id', id).select(P).single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const db = await client();
  const { error } = await db.from('vi_projects').delete().eq('id', id);
  if (error) throw error;
}

/* ── ideas: one row is one sticky note ────────────────────────────── */
/* A note that was deleted is not gone: it is in the bin, with its words, and it
 * only leaves when somebody says "for good". `bin: true` reads that drawer. */
export async function listIdeas(projectId, { bin = false } = {}) {
  const db = await client();
  let q = db.from('vi_ideas').select(I).eq('project_id', projectId);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addIdea(projectId, text, color = 'butter') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vi_ideas')
    .insert({ user_id: s.user.id, project_id: projectId, text, color })
    .select(I).single();
  if (error) throw error;
  return data;
}

export async function addIdeas(projectId, list, colorFor = () => 'butter') {
  const db = await client();
  const s = await session();
  const rows = list.map((text, i) => ({
    user_id: s.user.id, project_id: projectId, text, color: colorFor(i),
  }));
  const { data, error } = await db.from('vi_ideas').insert(rows).select(I);
  if (error) throw error;
  return data;
}

export async function updateIdea(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vi_ideas')
    .update(patch).eq('id', id).select(I).single();
  if (error) throw error;
  return data;
}

/* The bin is a timestamp, not a second table. */
export async function binIdea(id) {
  return updateIdea(id, { deleted_at: new Date().toISOString() });
}

export async function restoreIdea(id) {
  return updateIdea(id, { deleted_at: null });
}

/* Deleting for good is the only place a note is removed by anything but its id. */
export async function deleteIdea(id) {
  const db = await client();
  const { error } = await db.from('vi_ideas').delete().eq('id', id);
  if (error) throw error;
}

export async function emptyBin(projectId) {
  const db = await client();
  const { error } = await db.from('vi_ideas').delete()
    .eq('project_id', projectId).not('deleted_at', 'is', null);
  if (error) throw error;
}

/* A funnel someone shared can become yours. Every row is inserted under your
 * own id, so the stages, the reasons and the choice are yours to change — the
 * owner's funnel is not touched, and this is not an import but a copy. */
export async function copyToMe(project, ideas) {
  const db = await client();
  const s = await session();
  const title = (project.title || 'untitled funnel').trim() || 'untitled funnel';
  const made = await createProject(title);

  const patch = {};
  for (const k of ['context', 'exploration', 'simulation']) {
    if (project[k]) patch[k] = project[k];
  }
  if (Object.keys(patch).length) await updateProject(made.id, patch);

  if (!ideas.length) return made;

  const rows = ideas.map((i, n) => ({
    user_id: s.user.id,
    project_id: made.id,
    text: i.text,
    stage: i.stage || 'ideation',
    color: i.color || 'butter',
    reason: i.reason || '',
    exploration: i.exploration || '',
    position: n,
  }));
  const { data, error } = await db.from('vi_ideas').insert(rows).select(I);
  if (error) throw error;

  /* the choice travels with the copy, but it points at the copy's own row */
  const at = ideas.findIndex((i) => i.id === project.chosen_id);
  if (at >= 0 && data[at]) await updateProject(made.id, { chosen_id: data[at].id });
  return made;
}

/* ── sharing: one funnel, a link or a person ──────────────────────── */
const SH = 'id,project_id,owner_id,code,email,role,pending,created_at';

export async function listShares(projectId) {
  const db = await client();
  const { data, error } = await db.from('vi_shares').select(SH)
    .eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/* Sixteen characters of randomness that a person can paste; the check
 * constraint on the table refuses anything shorter. */
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export async function makeLink(projectId) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vi_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, code: newCode() })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function revokeShare(id) {
  const db = await client();
  const { error } = await db.from('vi_shares').delete().eq('id', id);
  if (error) throw error;
}

/* One person, one role. Re-sharing with the same address changes the role
 * instead of making a second row. */
export async function shareWith(projectId, email, role = 'view') {
  const db = await client();
  const s = await session();
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) throw new Error('that is not an address');
  // the unique index on email is partial and case-folded, so PostgREST cannot
  // upsert on it: ask first, then change the role or add the row
  const { data: had } = await db.from('vi_shares').select(SH)
    .eq('project_id', projectId).eq('email', addr).maybeSingle();
  if (had) {
    const { data, error } = await db.from('vi_shares')
      .update({ role }).eq('id', had.id).select(SH).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from('vi_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, email: addr, role })
    .select(SH).single();
  if (error) throw error;
  return data;
}

/* What a public code shows, without an account and without RLS. */
export async function readShare(code) {
  const db = await client();
  const { data, error } = await db.rpc('vi_read_share', { p_code: code });
  if (error) throw error;
  return data || [];
}

/* 'owner' | 'edit' | 'view' | null, asked once when a funnel opens. */
export async function roleOn(project) {
  const s = await session();
  if (!s || !project) return null;
  if (project.user_id === s.user.id) return 'owner';
  const db = await client();
  const { data, error } = await db.rpc('vi_share_role', {
    project: project.id, viewer_email: (s.user.email || '').toLowerCase(),
  });
  if (error) return null;
  return data || null;
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
