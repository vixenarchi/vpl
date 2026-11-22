/* vz's published service — GET /p/<code>/<key>
 *
 * The value as text, exactly as it was written: a setting, a JSON blob, a
 * password, a joke. 404 when the key is not there, so a client can tell an
 * empty value from a missing one.
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
  const key = decodeURIComponent(String(params.key || ''));
  let data;
  try {
    data = await rpc('vz_read_public', { p_code: code, p_key: key });
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
