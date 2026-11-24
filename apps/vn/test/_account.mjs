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
 * A stranger without accounts gets a one-line explanation and exit 0 — a build
 * that is red because somebody did not have an account teaches nobody anything.
 */
function account(who, emailVar, passVar) {
  const email = process.env[emailVar] || '';
  const pass = process.env[passVar] || '';
  if (!email || !pass) {
    console.log(`\n${who} account not set — skipping.\n` +
      `  ${emailVar}=you@example.com ${passVar}=… node ${process.argv[1].split('/').pop()}\n` +
      '  (the suite needs two accounts of your own project: one owner, one guest)\n');
    process.exit(0);
  }
  return { email, pass };
}

export const OWNER = account('owner', 'VPL_EMAIL', 'VPL_PASS');
export const GUEST = account('guest', 'VPL_GUEST_EMAIL', 'VPL_GUEST_PASS');
