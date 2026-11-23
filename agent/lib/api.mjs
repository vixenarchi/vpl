// The worker's one network dependency: Supabase over plain REST.
//
// No supabase-js, no websockets, no realtime. The agent signs in as itself,
// reads the queue it has been given access to, and moves files in and out of
// the bucket the document already uses. Everything else is local disk.

function trimBase(u) {
  return String(u || '').replace(/\/+$/, '');
}

export function makeApi({ url, anon, email, password }) {
  const base = trimBase(url);
  if (!base || !anon) throw new Error('VPL_SUPABASE_URL and VPL_SUPABASE_ANON are required');
  let token = '';

  async function call(path, { method = 'GET', body, headers = {}, raw = false, absolute } = {}) {
    const res = await fetch(absolute || base + path, {
      method,
      headers: {
        apikey: anon,
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    if (res.status === 401 && email) {
      // A token that has aged out should cost one sign-in, not a lost job.
      await signIn();
      return call(path, { method, body, headers, raw, absolute });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    }
    const type = res.headers.get('content-type') || '';
    if (raw) return res;
    if (type.includes('json')) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    return res.text();
  }

  async function signIn() {
    const res = await fetch(base + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`sign-in failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    token = data.access_token;
    return token;
  }

  const enc = encodeURIComponent;
  const BUCKET = 'va-files';
  // <bucket>/<seg>/<seg>: each segment encoded, slashes kept as separators. An
  // encoded slash is a different path to some proxies, and storage is one of them.
  const obj = (p) => BUCKET + '/' + String(p).split('/').map(enc).join('/');

  return {
    signIn,

    /** queued jobs, oldest first — the agent takes the head of the line */
    async queue(limit = 5) {
      return call(`/rest/v1/va_jobs?status=eq.queued&select=*&order=created_at.asc&limit=${limit}`);
    },

    /** claim without a lock: only a queued row may become running, and the
     *  filter is part of the write, so two agents cannot both win it */
    async claim(id) {
      const rows = await call(`/rest/v1/va_jobs?id=eq.${enc(id)}&status=eq.queued`, {
        method: 'PATCH',
        body: { status: 'running', started_at: new Date().toISOString() },
        headers: { prefer: 'return=representation' },
      });
      return Array.isArray(rows) ? rows[0] || null : rows;
    },

    async finish(id, patch) {
      return call(`/rest/v1/va_jobs?id=eq.${enc(id)}`, {
        method: 'PATCH',
        body: patch,
      });
    },

    async download(path) {
      const res = await call(`/storage/v1/object/authenticated/${obj(path)}`, { raw: true });
      return Buffer.from(await res.arrayBuffer());
    },

    async list(prefix) {
      const rows = await call('/storage/v1/object/list/va-files', {
        method: 'POST',
        body: { prefix, limit: 200, sortBy: { column: 'name', order: 'asc' } },
      });
      return Array.isArray(rows) ? rows.filter((r) => r.name && !r.name.endsWith('/')) : [];
    },

    async upload(path, body, contentType = 'text/plain; charset=utf-8') {
      return call(`/storage/v1/object/${obj(path)}`, {
        method: 'POST',
        body,
        raw: true,
        headers: { 'content-type': contentType, 'x-upsert': 'true' },
      });
    },
  };
}
