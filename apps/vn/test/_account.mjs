/* Who a suite signs in as — and what a suite does when nobody is signed in.
 *
 * Nothing here is a secret, and nothing here is a default. A test account's
 * address and password belong to whoever runs the tests, in their environment:
 *
 *   VPL_EMAIL / VPL_PASS                 the owner
 *   VPL_GUEST_EMAIL / VPL_GUEST_PASS     a second person, for sharing
 *
 * We keep ours in ~/.config/vpl/test.env, which is not in the repository (the
 * same rule as the model keys: a backup of the code is not a backup of the keys).
 *
 * With no account this file prints why and exits 78 (EX_CONFIG) — it does NOT
 * exit 0. A missing account used to read as "green" to anything that only looks
 * at an exit code, and an agent that believes a gate it did not run is worse off
 * than one that was never told about the gate. 78 is a third answer: not passed,
 * not failed, not configured. tools/test-all.sh counts it as skipped and says so
 * in the summary; VPL_ALLOW_ANON=1 turns it back into a quiet exit 0 for the
 * cases where a person really does want to see the anon-only suites run.
 */
function account(who, emailVar, passVar) {
  const email = process.env[emailVar] || '';
  const pass = process.env[passVar] || '';
  if (!email || !pass) {
    console.log(`\n${who} account not set — cannot run.\n` +
      `  ${emailVar}=you@example.com ${passVar}=… node ${process.argv[1].split('/').pop()}\n` +
      '  (the suite needs two accounts of your own project: one owner, one guest)\n' +
      '  VPL_ALLOW_ANON=1 skips instead of stopping, when you know that is what you want.\n');
    process.exit(process.env.VPL_ALLOW_ANON === '1' ? 0 : 78);
  }
  return { email, pass };
}

export const OWNER = account('owner', 'VPL_EMAIL', 'VPL_PASS');
export const GUEST = account('guest', 'VPL_GUEST_EMAIL', 'VPL_GUEST_PASS');
