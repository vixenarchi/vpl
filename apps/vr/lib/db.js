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
const R = 'id,project_id,user_id,ref,kind,strength,theme,theme_id,category,title,statement,detail,'
        + 'asis,tobe,horizon,source,verification,metric,target,conditions,clause,status,pos,'
        + 'file_path,file_name,file_size,file_mime,deleted_at,created_at,updated_at';
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
/* ── one attachment per row ────────────────────────────────────────── */
/* Two megabytes, and the bucket enforces it too: a limit that only exists in
 * the screen is a suggestion. */
export const BUCKET = 'vr-files';
export const MAX_FILE = 2 * 1024 * 1024;

function safeName(name) {
  return String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-60) || 'file';
}

export async function uploadFile(projectId, reqId, file) {
  const db = await client();
  const s = await session();
  if (!s?.user) throw new Error('sign in first — a file needs an owner');
  if (!file) throw new Error('no file chosen');
  if (file.size > MAX_FILE) throw new Error('2 MB is the limit — a scan or a photo is enough');
  const path = `${projectId}/${reqId}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await db.storage.from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return path;
}

/* A private bucket means the screen has to ask for a link every time. An hour
 * is longer than anybody looks at a proof. */
export async function signFile(path, seconds = 3600) {
  const db = await client();
  if (!path) throw new Error('nothing attached');
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFile(path) {
  if (!path) return;
  const db = await client();
  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export async function copyToMe(src, rows = [], terms = [], themes = [], vocab = []) {
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
  /* the tree comes with the document: same names, same shape, new ids */
  const map = new Map();
  for (const t of (themes || []).slice().sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0))) {
    const { data: nt, error: e0 } = await db.from('vr_themes')
      .insert({ user_id: s.user.id, project_id: p.id, name: t.name, parent_id: map.get(t.parent_id) || null })
      .select(TH).single();
    if (e0) throw e0;
    map.set(t.id, nt.id);
  }
  if (vocab && vocab.length) {
    /* the new document arrives with the default words; the source's words win */
    await db.from('vr_vocab').delete().eq('project_id', p.id);
    const { error: e1 } = await db.from('vr_vocab').insert(vocab.map((v) => ({
      user_id: s.user.id, project_id: p.id, axis: v.axis, value: v.value, color: v.color, pos: v.pos,
    })));
    if (e1) throw e1;
  }
  const made = [];               // new id, by ref, so a file can follow its row
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40).map((r) => {
      const out = { user_id: s.user.id, project_id: p.id };
      for (const k of keep) out[k] = r[k] ?? '';
      out.theme_id = map.get(r.theme_id) || null;
      return out;
    });
    const { data, error: e2 } = await db.from('vr_reqs').insert(chunk).select('id,ref');
    if (e2) throw e2;
    made.push(...(data || []));
  }

  /* the proof comes with the document: sign the source file, download it, put
   * it in the copy's own folder. A blocked download must not lose the copy, so
   * this is best-effort and quiet. */
  const byRef = new Map(made.map((m) => [m.ref, m.id]));
  for (const r of rows) {
    if (!r.file_path) continue;
    const to = byRef.get(r.ref);
    if (!to) continue;
    try {
      const url = await signFile(r.file_path);
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size > MAX_FILE) continue;
      const path = `${p.id}/${to}/${Date.now()}-${safeName(r.file_name)}`;
      const up = await db.storage.from(BUCKET)
        .upload(path, blob, { contentType: r.file_mime || blob.type || 'application/octet-stream' });
      if (up.error) continue;
      await db.from('vr_reqs').update({
        file_path: path, file_name: r.file_name, file_size: blob.size, file_mime: r.file_mime || blob.type,
      }).eq('id', to);
    } catch { /* a copy without its proof is still a copy */ }
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

/* ── the tree: a theme, and a subtheme under it ───────────────────── */
const TH = 'id,project_id,parent_id,name,pos,created_at';

export async function listThemes(projectId) {
  const db = await client();
  const { data, error } = await db.from('vr_themes').select(TH)
    .eq('project_id', projectId).order('pos', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addTheme(projectId, name, parentId = null) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vr_themes')
    .insert({ user_id: s.user.id, project_id: projectId, name, parent_id: parentId })
    .select(TH).single();
  if (error) throw error;
  return data;
}

export async function renameTheme(id, name) {
  const db = await client();
  const { data, error } = await db.from('vr_themes').update({ name }).eq('id', id).select(TH).single();
  if (error) throw error;
  return data;
}

export async function deleteTheme(id) {
  const db = await client();
  const { error } = await db.from('vr_themes').delete().eq('id', id);
  if (error) throw error;
}

/* ── the document's words: importance, status, kind ───────────────── */
const V = 'id,project_id,axis,value,color,pos';

export async function listVocab(projectId) {
  const db = await client();
  const { data, error } = await db.from('vr_vocab').select(V)
    .eq('project_id', projectId).order('axis', { ascending: true }).order('pos', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addVocab(projectId, axis, value, color = 'grey') {
  const db = await client();
  const s = await session();
  const { data: have } = await db.from('vr_vocab').select(V)
    .eq('project_id', projectId).eq('axis', axis).order('pos', { ascending: false }).limit(1);
  const pos = (have && have[0] ? have[0].pos : 0) + 1;
  const { data, error } = await db.from('vr_vocab')
    .insert({ user_id: s.user.id, project_id: projectId, axis, value, color, pos })
    .select(V).single();
  if (error) throw error;
  return data;
}

/* ── rows ─────────────────────────────────────────────────────────── */
/* A deleted requirement keeps its words and its name in the bin: refs are never
 * reused, so a row that comes back is still R12, not a new R12. */
export async function listReqs(projectId, { bin = false } = {}) {
  const db = await client();
  let q = db.from('vr_reqs').select(R).eq('project_id', projectId);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('pos', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function binReq(id) {
  return updateReq(id, { deleted_at: new Date().toISOString() });
}

export async function restoreReq(id) {
  return updateReq(id, { deleted_at: null });
}

export async function emptyBin(projectId) {
  const db = await client();
  const { error } = await db.from('vr_reqs').delete()
    .eq('project_id', projectId).not('deleted_at', 'is', null);
  if (error) throw error;
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
