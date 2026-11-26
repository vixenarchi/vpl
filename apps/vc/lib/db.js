/* vpl · vd — the whole database surface of this app, in one file.
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

const P = 'id,user_id,title,brief,template,deleted_at,created_at,updated_at';
const A = 'id,project_id,user_id,kind,title,text,file_path,file_name,file_size,file_mime,pos,from_standard,target_id,deleted_at,created_at,updated_at';
const T = 'id,project_id,user_id,name,status,error,n_pass,n_fail,n_unknown,pos,deleted_at,created_at,updated_at';
const ST = 'id,user_id,title,kind,source_url,text,file_path,file_name,file_size,file_mime,chars,deleted_at,created_at,updated_at';
const R = 'id,project_id,user_id,template,model,notes,prompt,status,error,took_ms,created_at';
const O = 'id,project_id,run_id,user_id,kind,title,body,pos,target_id,created_at,updated_at';
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

/* ── jobs ─────────────────────────────────────────────────────────── */
/* A job in the bin is still a job: same row, same words, deleted_at set. The
 * rail asks for the live ones, the bin asks for the other side. */
export async function listProjects({ bin = false } = {}) {
  const db = await client();
  let q = db.from('vc_projects').select(P);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('deleted_at', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function binProject(id) {
  return updateProject(id, { deleted_at: new Date().toISOString() });
}

export async function restoreProject(id) {
  return updateProject(id, { deleted_at: null });
}

/* "empty the bin" is the only call that removes a job without a name being read
 * out loud, and it is behind a question that says how many jobs it takes. */
export async function emptyProjectBin() {
  const db = await client();
  const { error } = await db.from('vc_projects').delete().not('deleted_at', 'is', null);
  if (error) throw error;
}

export async function createProject(title = 'untitled job', template = 'offer') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_projects')
    .insert({ user_id: s.user.id, title, template }).select(P).single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vc_projects')
    .update(patch).eq('id', id).select(P).single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const db = await client();
  const { error } = await db.from('vc_projects').delete().eq('id', id);
  if (error) throw error;
}

/* ── inputs ───────────────────────────────────────────────────────── */
/* An input that was removed is in the bin, with its text — and a file's path
 * stays valid, so a restore does not need the bucket again. */
export async function listArtifacts(projectId, { bin = false, targetId = null } = {}) {
  const db = await client();
  let q = db.from('vc_artifacts').select(A).eq('project_id', projectId);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  /* null is the check itself: the rules, and the evidence of a check without
   * targets. A target id is that candidate's own pile. */
  q = targetId ? q.eq('target_id', targetId) : q.is('target_id', null);
  const { data, error } = await q.order('pos').order('created_at');
  if (error) throw error;
  return data;
}

export async function addArtifact(projectId, row) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_artifacts').insert({
    user_id: s.user.id, project_id: projectId,
    kind: row.kind || 'text',
    title: String(row.title || '').slice(0, 200),
    text: row.text || '',
    file_path: row.file_path || null,
    file_name: row.file_name || null,
    file_size: row.file_size ?? null,
    file_mime: row.file_mime || null,
    from_standard: row.from_standard || null,
    target_id: row.target_id || null,
    pos: row.pos ?? Date.now() % 1000000,
  }).select(A).single();
  if (error) throw error;
  return data;
}

export async function updateArtifact(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vc_artifacts')
    .update(patch).eq('id', id).select(A).single();
  if (error) throw error;
  return data;
}

/* ✕ removes it from the job, not from the world: the text and the file stay. */
export async function binArtifact(id) {
  return updateArtifact(id, { deleted_at: new Date().toISOString() });
}

export async function restoreArtifact(id) {
  return updateArtifact(id, { deleted_at: null });
}

export async function deleteArtifact(id) {
  const db = await client();
  const { error } = await db.from('vc_artifacts').delete().eq('id', id);
  if (error) throw error;
}

export async function emptyBin(projectId) {
  const db = await client();
  const { error } = await db.from('vc_artifacts').delete()
    .eq('project_id', projectId).not('deleted_at', 'is', null);
  if (error) throw error;
}

/* Files live in a private bucket and the path begins with the job's id, which
 * is what the storage policy asks about. A download is a short signed URL. */
const BUCKET = 'vc-files';
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

/* ── the library ──────────────────────────────────────────────────── */
/* A drawer, not a catalogue: the person's own laws, standards, policies, terms
 * and job ads, private, reused across their checks. Nothing here is shared and
 * nothing is pointed at — "add to this check" copies the text. */
export async function listStandards({ bin = false } = {}) {
  const db = await client();
  let q = db.from('vc_standards').select(ST);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addStandard(row) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_standards').insert({
    user_id: s.user.id,
    title: String(row.title || '').slice(0, 200),
    kind: row.kind || 'law',
    source_url: row.source_url ? String(row.source_url).slice(0, 2000) : null,
    text: row.text || '',
    file_path: row.file_path || null,
    file_name: row.file_name || null,
    file_size: row.file_size ?? null,
    file_mime: row.file_mime || null,
  }).select(ST).single();
  if (error) throw error;
  return data;
}

export async function updateStandard(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vc_standards')
    .update(patch).eq('id', id).select(ST).single();
  if (error) throw error;
  return data;
}

/* ✕ puts it in the bin, like every other ✕ in the suite: a 200-page law is the
 * last thing that should vanish because a finger slipped. */
export async function binStandard(id) {
  return updateStandard(id, { deleted_at: new Date().toISOString() });
}

export async function restoreStandard(id) {
  return updateStandard(id, { deleted_at: null });
}

/* A standard's own file. The path begins with the standard's id, which is what
 * the storage policy asks about — a standard is not a project, so it has its own
 * question (20261212000000_vc_standard_files.sql). */
export async function uploadStandardFile(standardId, file) {
  const db = await client();
  if (file.size > MAX_FILE) throw new Error('larger than 10 MB — keep the part you are held to');
  const safe = String(file.name || 'file').replace(/[^\w.\-]+/g, '-').slice(-80);
  const path = `${standardId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream',
  });
  if (error) throw error;
  return { path, name: file.name, size: file.size, mime: file.type };
}

export async function deleteStandard(id) {
  const db = await client();
  const { error } = await db.from('vc_standards').delete().eq('id', id);
  if (error) throw error;
}

/* ── the batch: a queue of independent targets ─────────────────────── */
/* status is a queue position. Nothing here runs on its own: `running` is only
 * true while a person is watching, and a reload turns it back into `queued`. */
export async function listTargets(projectId, { bin = false } = {}) {
  const db = await client();
  let q = db.from('vc_targets').select(T).eq('project_id', projectId);
  q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data, error } = await q.order('pos').order('created_at');
  if (error) throw error;
  return data;
}

export async function addTarget(projectId, name = '') {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_targets').insert({
    user_id: s.user.id, project_id: projectId,
    name: String(name || '').slice(0, 200), status: 'queued',
    pos: Date.now() % 1000000,
  }).select(T).single();
  if (error) throw error;
  return data;
}

export async function updateTarget(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vc_targets')
    .update(patch).eq('id', id).select(T).single();
  if (error) throw error;
  return data;
}

export async function binTarget(id) {
  return updateTarget(id, { deleted_at: new Date().toISOString() });
}

export async function restoreTarget(id) {
  return updateTarget(id, { deleted_at: null });
}

export async function deleteTarget(id) {
  const db = await client();
  const { error } = await db.from('vc_targets').delete().eq('id', id);
  if (error) throw error;
}

/* A queue that was interrupted: the row that was running is not running any
 * more — nobody is watching it — so it goes back to the queue, in its place. */
export async function requeueRunning(projectId) {
  const db = await client();
  const { error } = await db.from('vc_targets')
    .update({ status: 'queued' })
    .eq('project_id', projectId).eq('status', 'running');
  if (error) throw error;
}

/* ── the transformation ───────────────────────────────────────────── */
export async function startRun(projectId, { template, model, notes, prompt, targetId }) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_runs').insert({
    user_id: s.user.id, project_id: projectId, target_id: targetId || null,
    template, model, notes, prompt, status: 'running',
  }).select(R).single();
  if (error) throw error;
  return data;
}

export async function finishRun(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vc_runs')
    .update(patch).eq('id', id).select(R).single();
  if (error) throw error;
  return data;
}

export async function listRuns(projectId, limit = 12) {
  const db = await client();
  const { data, error } = await db.from('vc_runs').select(R)
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

/* ── outputs ──────────────────────────────────────────────────────── */
export async function listOutputs(projectId, { targetId = null } = {}) {
  const db = await client();
  let q = db.from('vc_outputs').select(O).eq('project_id', projectId);
  q = targetId ? q.eq('target_id', targetId) : q.is('target_id', null);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addOutput(projectId, { run_id, kind, title, body, target_id }) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_outputs').insert({
    user_id: s.user.id, project_id: projectId, run_id: run_id || null,
    kind: kind || 'doc', title: String(title || '').slice(0, 200), body: body || '',
    target_id: target_id || null,
    pos: 0,
  }).select(O).single();
  if (error) throw error;
  return data;
}

export async function updateOutput(id, patch) {
  const db = await client();
  const { data, error } = await db.from('vc_outputs')
    .update(patch).eq('id', id).select(O).single();
  if (error) throw error;
  return data;
}

export async function deleteOutput(id) {
  const db = await client();
  const { error } = await db.from('vc_outputs').delete().eq('id', id);
  if (error) throw error;
}

/* ── sharing: a link or a person ──────────────────────────────────── */
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export async function listShares(projectId) {
  const db = await client();
  const { data, error } = await db.from('vc_shares').select(SH)
    .eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function makeLink(projectId) {
  const db = await client();
  const s = await session();
  const { data, error } = await db.from('vc_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, code: newCode(), pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function revokeShare(id) {
  const db = await client();
  const { error } = await db.from('vc_shares').delete().eq('id', id);
  if (error) throw error;
}

export async function shareWith(projectId, email, role = 'view') {
  const db = await client();
  const s = await session();
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) throw new Error('that is not an address');
  const { data: had } = await db.from('vc_shares').select(SH)
    .eq('project_id', projectId).eq('email', addr).maybeSingle();
  if (had) {
    const { data, error } = await db.from('vc_shares')
      .update({ role, pending: false }).eq('id', had.id).select(SH).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from('vc_shares')
    .insert({ project_id: projectId, owner_id: s.user.id, email: addr, role, pending: false })
    .select(SH).single();
  if (error) throw error;
  return data;
}

export async function readShare(code) {
  const db = await client();
  const { data, error } = await db.rpc('vc_read_share', { p_code: code });
  if (error) throw error;
  return data || null;
}

export async function roleOn(project) {
  const s = await session();
  if (!s || !project) return null;
  if (project.user_id === s.user.id) return 'owner';
  const db = await client();
  const { data, error } = await db.rpc('vc_share_role', {
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
  const { data: p, error } = await db.from('vc_projects').insert({
    user_id: s.user.id,
    title: `${src.title} (copy)`.slice(0, 120),
    brief: src.brief || '',
    template: src.template || 'offer',
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
    const { error: e } = await db.from('vc_artifacts').insert(arts.slice(i, i + 25));
    if (e) throw e;
  }

  /* A copy keeps each version's own timestamp. Without it every row of the copy
   * is created in the same statement, all with the same now(), and "the newest
   * document" stops being a fact — the desk would open whichever came back
   * first. */
  const outs = (outputs || []).map((o) => ({
    user_id: s.user.id, project_id: p.id, kind: o.kind, title: o.title, body: o.body,
    ...(o.created_at ? { created_at: o.created_at } : {}),
  }));
  for (let i = 0; i < outs.length; i += 25) {
    const { error: e } = await db.from('vc_outputs').insert(outs.slice(i, i + 25));
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
