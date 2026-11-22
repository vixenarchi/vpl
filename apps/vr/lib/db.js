/* vpl · vr — the whole database surface of this app, in one file.
 *
 * Four tables: a document, its rows, its words, its shares. supabase-js comes
 * from a CDN — no bundler, and nothing here knows about the screen.
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

const P = 'id,user_id,title,brief,assumptions,scope,created_at,updated_at';
const R = 'id,project_id,user_id,ref,kind,strength,theme,category,title,statement,detail,'
        + 'asis,tobe,horizon,source,verification,metric,target,conditions,clause,status,pos,'
        + 'created_at,updated_at';
const T = 'id,project_id,term,meaning,created_at';

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

/* ── documents ────────────────────────────────────────────────────── */
export async function listProjects() {
  const db = await client();
  const { data, error } = await db.from('vr_projects').select(P).order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProject(title = 'untitled spec') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vr_projects')
    .insert({ user_id: s.user.id, title }).select(P).single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vr_projects')
    .update(patch).eq('id', id).select(P).single();
  if (error) throw error;
  return data;
}

/* A shared document can become yours. Reading is allowed by the share, writing
 * is allowed because the copy is inserted under your own id — the original's
 * owner keeps their document, and you get one where the names, the strengths
 * and the order are yours to change. */
export async function copyToMe(src, rows = [], terms = []) {
  const db = await client();
  const s = await session();
  const { data: p, error } = await db.from('vr_projects').insert({
    user_id: s.user.id,
    title: `${src.title} (copy)`.slice(0, 120),
    brief: src.brief || '', assumptions: src.assumptions || '', scope: src.scope || '',
  }).select(P).single();
  if (error) throw error;
  const keep = ['ref', 'kind', 'strength', 'theme', 'category', 'title', 'statement', 'detail',
    'asis', 'tobe', 'horizon', 'source', 'verification', 'metric', 'target', 'conditions',
    'clause', 'status', 'pos'];
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40).map((r) => {
      const out = { user_id: s.user.id, project_id: p.id };
      for (const k of keep) out[k] = r[k] ?? '';
      return out;
    });
    const { error: e2 } = await db.from('vr_reqs').insert(chunk);
    if (e2) throw e2;
  }
  if (terms.length) {
    const { error: e3 } = await db.from('vr_terms').insert(terms.map((t) => ({
      user_id: s.user.id, project_id: p.id, term: t.term, meaning: t.meaning || '',
    })));
    if (e3) throw e3;
  }
  return p;
}

export async function deleteProject(id) {
  const db = await client();
  const { error } = await db.from('vr_projects').delete().eq('id', id);
  if (error) throw error;
}

/* ── rows ─────────────────────────────────────────────────────────── */
export async function listReqs(projectId) {
  const db = await client();
  const { data, error } = await db.from('vr_reqs').select(R)
    .eq('project_id', projectId).order('pos', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/* VR-001, VR-002… computed here so a batch of pasted rows gets names in one
 * statement; the trigger fills the same shape in for a single row. */
export function nextRef(reqs, offset = 0) {
  const top = reqs.reduce((n, r) => {
    const m = /\d+/.exec(r.ref || '');
    return m ? Math.max(n, Number(m[0])) : n;
  }, 0);
  return 'VR-' + String(top + offset).padStart(3, '0');
}

export async function addReq(projectId, row = {}) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vr_reqs')
    .insert({ user_id: s.user.id, project_id: projectId, ...row })
    .select(R).single();
  if (error) throw error;
  return data;
}

export async function addReqs(projectId, rows) {
  if (!rows.length) return [];
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vr_reqs')
    .insert(rows.map((r) => ({ user_id: s.user.id, project_id: projectId, ...r })))
    .select(R);
  if (error) throw error;
  return data;
}

export async function updateReq(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vr_reqs')
    .update(patch).eq('id', id).select(R).single();
  if (error) throw error;
  return data;
}

export async function deleteReq(id) {
  const db = await client();
  const { error } = await db.from('vr_reqs').delete().eq('id', id);
  if (error) throw error;
}

/* ── the words a document assumes ─────────────────────────────────── */
export async function listTerms(projectId) {
  const db = await client();
  const { data, error } = await db.from('vr_terms').select(T)
    .eq('project_id', projectId).order('term', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addTerm(projectId, term, meaning = '') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vr_terms')
    .insert({ user_id: s.user.id, project_id: projectId, term, meaning })
    .select(T).single();
  if (error) throw error;
  return data;
}

export async function updateTerm(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vr_terms').update(patch).eq('id', id).select(T).single();
  if (error) throw error;
  return data;
}

export async function deleteTerm(id) {
  const db = await client();
  const { error } = await db.from('vr_terms').delete().eq('id', id);
  if (error) throw error;
}

/* ── sharing: one document, a link or a person ────────────────────── */
const SH = 'id,project_id,owner_id,code,email,role,pending,created_at';

export async function listShares(projectId) {
  const db = await client();
  const { data, error } = await db.from('vr_shares').select(SH)
    .eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export async function makeLink(projectId) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vr_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, code: newCode(), pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function revokeShare(id) {
  const db = await client();
  const { error } = await db.from('vr_shares').delete().eq('id', id);
  if (error) throw error;
}

export async function shareWith(projectId, email, role = 'view') {
  const db = await client();
  const s = await session();
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) throw new Error('that is not an address');
  const { data: had } = await db.from('vr_shares').select(SH)
    .eq('project_id', projectId).eq('email', addr).maybeSingle();
  if (had) {
    const { data, error } = await db.from('vr_shares')
      .update({ role, pending: false }).eq('id', had.id).select(SH).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from('vr_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, email: addr, role, pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function readShare(code) {
  const db = await client();
  const { data, error } = await db.rpc('vr_read_share', { p_code: code });
  if (error) throw error;
  return data || null;
}

export async function roleOn(project) {
  const s = await session();
  if (!s || !project) return null;
  if (project.user_id === s.user.id) return 'owner';
  const db = await client();
  const { data, error } = await db.rpc('vr_share_role', {
    project: project.id, viewer_email: (s.user.email || '').toLowerCase(),
  });
  if (error) return null;
  return data || null;
}
