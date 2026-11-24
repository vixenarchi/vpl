/* Copy this file to config.local.js and fill in your project.
 * The anon key is public by design — RLS is the lock, not the key. */
window.__VPL_CONFIG__ = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anon: 'YOUR-ANON-KEY',
  lib: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',

  /* optional: your own doors. With none, the app uses its own /api/chat and
   * stops there — nothing points at anybody else's server.
   *   proxy:  'https://api.example.com/chat'     model calls, from apps/api
   *   search: 'https://api.example.com/search'   evidence, for vi
   *   door:   'https://api.example.com/vp'       credit codes, for vp
   */
};
