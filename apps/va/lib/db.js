/* vpl · va — the whole database surface of this app, in one file.
 *
 * Five tables: a job, its inputs, its runs, its outputs, its shares.
 * supabase-js comes from a CDN — no bundler, and nothing here knows about
 * the screen.
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

const P = 'id,user_id,title,brief,template,created_at,updated_at';
const A = 'id,project_id,user_id,kind,title,text,file_path,file_name,file_size,file_mime,pos,created_at,updated_at';
const R = 'id,project_id,user_id,template,model,notes,prompt,status,error,took_ms,created_at';
const O = 'id,project_id,run_id,user_id,kind,title,body,pos,created_at,updated_at';
const SH = 'id,project_id,owner_id,code,email,role,pending,created_at';

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

/* ── jobs ─────────────────────────────────────────────────────────── */
export async function listProjects() {
  const db = await client();
  const { data, error } = await db.from('va_projects').select(P)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProject(title = 'untitled job', template = 'context') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('va_projects')
    .insert({ user_id: s.user.id, title, template }).select(P).single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, patch) {
  const db = await client();
  const { data, error } = await db.from('va_projects')
    .update(patch).eq('id', id).select(P).single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const db = await client();
  const { error } = await db.from('va_projects').delete().eq('id', id);
  if (error) throw error;
}

/* ── inputs ───────────────────────────────────────────────────────── */
export async function listArtifacts(projectId) {
  const db = await client();
  const { data, error } = await db.from('va_artifacts').select(A)
    .eq('project_id', projectId).order('pos').order('created_at');
  if (error) throw error;
  return data;
}

export async function addArtifact(projectId, row) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('va_artifacts').insert({
    user_id: s.user.id, project_id: projectId,
    kind: row.kind || 'text',
    title: String(row.title || '').slice(0, 200),
    text: row.text || '',
    file_path: row.file_path || null,
    file_name: row.file_name || null,
    file_size: row.file_size ?? null,
    file_mime: row.file_mime || null,
    pos: row.pos ?? Date.now() % 1000000,
  }).select(A).single();
  if (error) throw error;
  return data;
}

export async function updateArtifact(id, patch) {
  const db = await client();
  const { data, error } = await db.from('va_artifacts')
    .update(patch).eq('id', id).select(A).single();
  if (error) throw error;
  return data;
}

export async function deleteArtifact(id) {
  const db = await client();
  const { error } = await db.from('va_artifacts').delete().eq('id', id);
  if (error) throw error;
}

/* Files live in a private bucket and the path begins with the job's id, which
 * is what the storage policy asks about. A download is a short signed URL. */
const BUCKET = 'va-files';
const MAX_FILE = 10 * 1024 * 1024;

export function fileLimit() { return MAX_FILE; }

export async function uploadFile(projectId, file) {
  const db = await client();
  if (file.size > MAX_FILE) throw new Error('larger than 10 MB — that one has to live somewhere else');
  const safe = String(file.name || 'file').replace(/[^\w.\-]+/g, '-').slice(-80);
  const path = `${projectId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream',
  });
  if (error) throw error;
  return { path, name: file.name, size: file.size, mime: file.type };
}

export async function fileUrl(path) {
  const db = await client();
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

/* ── the transformation ───────────────────────────────────────────── */
export async function startRun(projectId, { template, model, notes, prompt }) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('va_runs').insert({
    user_id: s.user.id, project_id: projectId,
    template, model, notes, prompt, status: 'running',
  }).select(R).single();
  if (error) throw error;
  return data;
}

export async function finishRun(id, patch) {
  const db = await client();
  const { data, error } = await db.from('va_runs')
    .update(patch).eq('id', id).select(R).single();
  if (error) throw error;
  return data;
}

export async function listRuns(projectId, limit = 12) {
  const db = await client();
  const { data, error } = await db.from('va_runs').select(R)
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

/* ── outputs ──────────────────────────────────────────────────────── */
export async function listOutputs(projectId) {
  const db = await client();
  const { data, error } = await db.from('va_outputs').select(O)
    .eq('project_id', projectId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addOutput(projectId, { run_id, kind, title, body }) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('va_outputs').insert({
    user_id: s.user.id, project_id: projectId, run_id: run_id || null,
    kind: kind || 'doc', title: String(title || '').slice(0, 200), body: body || '',
    pos: 0,
  }).select(O).single();
  if (error) throw error;
  return data;
}

export async function updateOutput(id, patch) {
  const db = await client();
  const { data, error } = await db.from('va_outputs')
    .update(patch).eq('id', id).select(O).single();
  if (error) throw error;
  return data;
}

export async function deleteOutput(id) {
  const db = await client();
  const { error } = await db.from('va_outputs').delete().eq('id', id);
  if (error) throw error;
}

/* ── sharing: a link or a person ──────────────────────────────────── */
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export async function listShares(projectId) {
  const db = await client();
  const { data, error } = await db.from('va_shares').select(SH)
    .eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function makeLink(projectId) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('va_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, code: newCode(), pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function revokeShare(id) {
  const db = await client();
  const { error } = await db.from('va_shares').delete().eq('id', id);
  if (error) throw error;
}

export async function shareWith(projectId, email, role = 'view') {
  const db = await client();
  const s = await session();
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) throw new Error('that is not an address');
  const { data: had } = await db.from('va_shares').select(SH)
    .eq('project_id', projectId).eq('email', addr).maybeSingle();
  if (had) {
    const { data, error } = await db.from('va_shares')
      .update({ role, pending: false }).eq('id', had.id).select(SH).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from('va_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, email: addr, role, pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function readShare(code) {
  const db = await client();
  const { data, error } = await db.rpc('va_read_share', { p_code: code });
  if (error) throw error;
  return data || null;
}

export async function roleOn(project) {
  const s = await session();
  if (!s || !project) return null;
  if (project.user_id === s.user.id) return 'owner';
  const db = await client();
  const { data, error } = await db.rpc('va_share_role', {
    project: project.id, viewer_email: (s.user.email || '').toLowerCase(),
  });
  if (error) return null;
  return data || null;
}

/* A shared job can become yours: the same inputs and outputs, new ids, no
 * files (a path belongs to the job it was uploaded into), no shares. */
export async function copyToMe(src, artifacts, outputs) {
  const db = await client();
  const s = await session();
  const { data: p, error } = await db.from('va_projects').insert({
    user_id: s.user.id,
    title: `${src.title} (copy)`.slice(0, 120),
    brief: src.brief || '',
    template: src.template || 'context',
  }).select(P).single();
  if (error) throw error;

  const arts = (artifacts || []).map((a, i) => ({
    user_id: s.user.id, project_id: p.id, kind: a.kind, title: a.title,
    text: a.text,
    file_name: a.file_name || null,
    file_size: a.file_size ?? null,
    file_mime: a.file_mime || null,
    pos: a.pos ?? i,
  }));
  for (let i = 0; i < arts.length; i += 25) {
    const { error: e } = await db.from('va_artifacts').insert(arts.slice(i, i + 25));
    if (e) throw e;
  }

  const outs = (outputs || []).map((o) => ({
    user_id: s.user.id, project_id: p.id, kind: o.kind, title: o.title, body: o.body,
  }));
  for (let i = 0; i < outs.length; i += 25) {
    const { error: e } = await db.from('va_outputs').insert(outs.slice(i, i + 25));
    if (e) throw e;
  }
  return p;
}
