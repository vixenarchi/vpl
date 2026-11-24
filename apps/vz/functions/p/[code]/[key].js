/* vz's published service — GET /p/<code>/<key>
 *
 * The value as text, exactly as it was written: a setting, a JSON blob, a
 * password, a joke. 404 when the key is not there, so a client can tell an
 * empty value from a missing one.
 */
/* Which project this answers for is a deployment's business, not the
 * repository's: a stranger cloning the suite must not read our shares, and we
 * must not have to edit code to move to another project. Both values are Pages
 * secrets (VPL_SUPABASE_URL, VPL_SUPABASE_ANON); the anon key is public by
 * design, the address is not a secret either — they are simply not ours. */
const config = (env) => ({
  url: env?.VPL_SUPABASE_URL || '',
  anon: env?.VPL_SUPABASE_ANON || '',
});

const NOT_CONFIGURED = () => new Response(
  JSON.stringify({ error: 'this deployment has no project: set VPL_SUPABASE_URL and VPL_SUPABASE_ANON' }),
  { status: 500, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } },
);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

async function rpc(name, args, cfg) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: cfg.anon,
      authorization: `Bearer ${cfg.anon}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status}`);
  return res.json();
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, env }) {
  const cfg = config(env);
  if (!cfg.url || !cfg.anon) return NOT_CONFIGURED();
  const code = String(params.code || '');
  const key = decodeURIComponent(String(params.key || ''));
  let data;
  try {
    data = await rpc('vz_read_public', { p_code: code, p_key: key }, cfg);
  } catch (err) {
    return new Response(String(err.message || err), {
      status: 502, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (!data || data.found !== true) {
    return new Response('no such key', {
      status: 404, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(String(data.value ?? ''), {
    headers: {
      ...CORS,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}
