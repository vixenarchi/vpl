/* vz's published service — GET /p/<code>
 *
 * A project that is published answers here as JSON: one object, key → value.
 * The anon key is public by design (it already ships to every browser in
 * config.local.js); the lock is the RPC, which only returns a project when the
 * owner has switched publishing on.
 *
 * Read-only. There is no POST, no key listing beyond this project and no way to
 * learn that some other project exists.
 */
const SUPABASE = 'https://ebhrjstllsazywbxnbqt.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViaHJqc3RsbHNhenl3YnhuYnF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1NTA0MDIsImV4cCI6MjExMDEyNjQwMn0.AskLuLd0E6bTWibu3VW_Jz04thLSjyWnj9DlCz-BSdY';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      authorization: `Bearer ${ANON}`,
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

export async function onRequestGet({ params }) {
  const code = String(params.code || '');
  let data;
  try {
    data = await rpc('vz_read_public', { p_code: code });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 502, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
  if (!data) {
    return new Response(JSON.stringify({ error: 'not published' }), {
      status: 404, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(data.keys, null, 2), {
    headers: {
      ...CORS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}
