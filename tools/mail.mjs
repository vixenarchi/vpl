/* the mailbox, from a shell.
 *
 * A confirmation e-mail is the one part of this suite that cannot be checked by
 * looking at the page: somebody has to open the letter. This reads and sends, so
 * a test — or a person at 2am — can answer "did it arrive, and does the link
 * work?" without a browser.
 *
 * The password is an **app password** (16 characters, Account → Security →
 * 2-Step Verification → App passwords). The account's own password does not work
 * for IMAP or SMTP, and Google says so out loud:
 *   [ALERT] Application-specific password required
 *
 *   node tools/mail.mjs list [n]              # the newest n subjects
 *   node tools/mail.mjs find <word> [n]       # subject or sender contains word
 *   node tools/mail.mjs body <n|id>           # one message, text only
 *   node tools/mail.mjs send <to> <subject> <body…>
 *
 * Credentials: MAIL_ACCOUNT + MAIL_APP_PASS in the environment, else the pairs
 * `mail.account` / `mail.app` in the vz dictionary "Test account" (which is how
 * they arrived), else ~/.config/vpl/agent.env.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , verb = 'list', ...args] = process.argv;

async function creds() {
  let account = process.env.MAIL_ACCOUNT;
  let pass = process.env.MAIL_APP_PASS;
  if (!account || !pass) {
    const envFile = path.join(homedir(), '.config/vpl/agent.env');
    try {
      const text = readFileSync(envFile, 'utf8');
      account ||= text.match(/^MAIL_ACCOUNT=(.+)$/m)?.[1]?.trim();
      pass ||= text.match(/^MAIL_APP_PASS=(.+)$/m)?.[1]?.trim();
    } catch {}
  }
  if (!account || !pass) {
    /* the dictionary, as the agent — the pairs are the person's own record */
    const here = path.dirname(new URL(import.meta.url).pathname);
    const out = spawnSync(process.execPath, [path.join(here, 'vpl-api.mjs'), 'get', 'vz_pairs',
      'select=key,value&project_id=eq.bc174e13-9628-40fe-b6cf-4ca90bc17e5a'], { encoding: 'utf8' });
    try {
      const pairs = JSON.parse(out.stdout);
      const of = (k) => pairs.find((p) => p.key === k)?.value;
      account = of('mail.account');
      pass = of('mail.app') || of('mail.apppass');
    } catch {}
  }
  if (!account || !pass) {
    console.log('no mailbox: set MAIL_ACCOUNT and MAIL_APP_PASS (an app password, not the account password)');
    process.exit(78);
  }
  return { account, pass: String(pass).replace(/\s+/g, '') };
}

const { account, pass } = await creds();

/* IMAP and SMTP are not in node, and a client library is a dependency this repo
 * does not need: python3 is here and its stdlib has both. */
const script = {
  list: `
import imaplib, sys
m = imaplib.IMAP4_SSL('imap.gmail.com', 993, timeout=30)
m.login(ACCOUNT, PASS); m.select('INBOX', readonly=True)
t, d = m.search(None, 'ALL'); ids = d[0].split()
for i in ids[-COUNT:][::-1]:
    t2, d2 = m.fetch(i, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
    txt = b' '.join(x[1] for x in d2 if isinstance(x, tuple)).decode('utf-8','replace')
    rows = {k.lower(): v for k, v in (l.split(':', 1) for l in txt.splitlines() if ':' in l)}
    print(i.decode(), '|', rows.get('date','').strip()[:31], '|', rows.get('from','').strip()[:40], '|', rows.get('subject','').strip()[:70])
m.logout()`,
  find: `
import imaplib
m = imaplib.IMAP4_SSL('imap.gmail.com', 993, timeout=30)
m.login(ACCOUNT, PASS); m.select('INBOX', readonly=True)
t, d = m.search(None, 'OR', '(SUBJECT "%s")' % WORD, '(FROM "%s")' % WORD)
ids = d[0].split()
print(len(ids), 'mail(s)')
for i in ids[-COUNT:][::-1]:
    t2, d2 = m.fetch(i, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
    txt = b' '.join(x[1] for x in d2 if isinstance(x, tuple)).decode('utf-8','replace')
    rows = {k.lower(): v for k, v in (l.split(':', 1) for l in txt.splitlines() if ':' in l)}
    print(i.decode(), '|', rows.get('date','').strip()[:31], '|', rows.get('from','').strip()[:40], '|', rows.get('subject','').strip()[:70])
m.logout()`,
  body: `
import imaplib, email
m = imaplib.IMAP4_SSL('imap.gmail.com', 993, timeout=30)
m.login(ACCOUNT, PASS); m.select('INBOX', readonly=True)
t, d = m.fetch(NUM.encode(), '(RFC822)')
msg = email.message_from_bytes(d[0][1])
print('From:', msg['From']); print('Subject:', msg['Subject']); print('Date:', msg['Date']); print()
for part in msg.walk():
    if part.get_content_type() == 'text/plain':
        print(part.get_payload(decode=True).decode('utf-8','replace')[:4000]); break
else:
    print('(no plain text part)')
m.logout()`,
  send: `
import smtplib, sys
from email.message import EmailMessage
msg = EmailMessage(); msg['From'] = ACCOUNT; msg['To'] = TO
msg['Subject'] = SUBJECT; msg.set_content(BODY)
s = smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30)
s.login(ACCOUNT, PASS); s.send_message(msg); s.quit()
print('sent to', TO)`,
};

function run(name, vars) {
  const code = script[name];
  if (!code) { console.log('unknown verb ' + name); process.exit(2); }
  const lit = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(String(v)));
  const r = spawnSync('python3', ['-c', `ACCOUNT=${JSON.stringify(account)}\nPASS=${JSON.stringify(pass)}\n`
    + Object.entries(vars).map(([k, v]) => `${k}=${lit(v)}\n`).join('') + code],
  { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  process.exit(r.status ?? 1);
}

if (verb === 'list') run('list', { COUNT: Number(args[0] || 8) });
else if (verb === 'find') {
  if (!args[0]) { console.log('find what?'); process.exit(2); }
  run('find', { WORD: args[0], COUNT: Number(args[1] || 5) });
} else if (verb === 'body') {
  if (!args[0]) { console.log('which message? a number from list'); process.exit(2); }
  run('body', { NUM: args[0] });
} else if (verb === 'send') {
  const [to, subject, ...rest] = args;
  if (!to || !subject) { console.log('send <to> <subject> <body…>'); process.exit(2); }
  run('send', { TO: to, SUBJECT: subject, BODY: rest.join(' ') || '(no body)' });
} else {
  console.log('verbs: list [n] · find <word> [n] · body <n> · send <to> <subject> <body>');
  process.exit(2);
}
