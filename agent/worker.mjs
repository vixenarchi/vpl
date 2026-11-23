#!/usr/bin/env node
// va-agent worker: takes a job directory, hands it to pi, writes out/.
//
// A job is a directory holding task.md (and optionally inputs/):
//
//   jobs/2026-12-03-1422/
//     task.md          ---  template: context  ---  plus prose
//     inputs/          documents, diagrams, inventories
//     out/report.md    written by this worker
//     out/files/       anything the agent created
//     out/state.json   status, model, milliseconds, file list
//
// The worker never talks to a browser and opens no port. It reads a directory
// and writes a directory. In the suite it reads a document shared with the
// agent's own account; here it is a folder, which is the same contract.

import { spawn } from 'node:child_process';
import { parseBoxList } from './lib/boxes.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const env = process.env;

const cfg = {
  jobs: path.resolve(env.VPL_JOBS || path.join(ROOT, 'jobs')),
  prompts: path.resolve(env.VPL_PROMPTS || path.join(ROOT, 'prompts')),
  piDir: path.resolve(env.VPL_PI_DIR || path.join(ROOT, 'var', 'pi')),
  // Empty base means: use pi's own provider for this model (e.g. google/…),
  // which is what a direct provider key wants. A base means an OpenAI-shaped
  // endpoint: our vp door, or anything compatible.
  base: (env.VPL_MODEL_BASE || '').replace(/\/+$/, ''),
  // pi's own providers by default (google/… with GEMINI_API_KEY), because a
  // plain key is the least machinery. A vp key is the shared-meters option.
  model: env.VPL_MODEL || 'google/gemini-3.1-flash-lite',
  poll: Number(env.VPL_POLL || 5000),
  timeout: Number(env.VPL_TIMEOUT || 15 * 60 * 1000),
  retries: Number(env.VPL_RETRIES || 2),
  once: process.argv.includes('--once'),
  dry: process.argv.includes('--dry'),
  prune: (() => {
    const i = process.argv.indexOf('--prune');
    return i > 0 ? process.argv[i + 1] : null;
  })(),
  quiet: process.argv.includes('--quiet'),
};

const say = (...a) => {
  if (!cfg.quiet) console.log(new Date().toISOString().slice(11, 19), ...a);
};

const modelId = cfg.model.includes('/') ? cfg.model.split('/').slice(1).join('/') : cfg.model;

// pi reads its providers from $PI_CODING_AGENT_DIR/models.json. The key is a
// reference, never the value: the token stays in the environment.
async function preparePi() {
  await fs.mkdir(cfg.piDir, { recursive: true });
  let models = { $schema: 'https://pi.dev/schemas/models.schema.json', providers: {} };

  if (cfg.base) {
    if (!env.VPL_MODEL_KEY && !env.OPENAI_API_KEY) {
      throw new Error('no model key: set VPL_MODEL_KEY (a vp key, or a provider key)');
    }
    models.providers.vpl = {
      baseUrl: cfg.base,
      api: 'openai-completions',
      // a reference, never the value: the token stays in the environment
      apiKey: '$VPL_MODEL_KEY',
      models: [{ id: modelId }],
    };
  } else if (cfg.model.startsWith('google/') && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
    throw new Error('model is google/… but GEMINI_API_KEY is not in the environment');
  }
  // Empty providers clears stale entries and leaves pi's own providers intact.
  await fs.writeFile(path.join(cfg.piDir, 'models.json'), JSON.stringify(models, null, 2) + '\n');
}

// --- a job ---------------------------------------------------------------

function splitFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

async function readConfig(name) {
  try {
    return await fs.readFile(path.join(cfg.prompts, name), 'utf8');
  } catch {
    return '';
  }
}

async function listInputs(jobDir) {
  const out = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, path.join(prefix, e.name));
      else out.push(path.join(prefix, e.name));
    }
  }
  await walk(path.join(jobDir, 'inputs'), '');
  return out;
}

async function buildPrompt(jobDir, taskText) {
  const { meta, body } = splitFrontMatter(taskText);
  const template = (meta.template || 'default').toLowerCase();
  const parts = [
    await readConfig('base.md'),
    await readConfig(`${template}.md`),
    '',
    `# The job${meta.title ? `: ${meta.title}` : ''}`,
    '',
    body.trim(),
  ];
  const inputs = await listInputs(jobDir);
  if (inputs.length) {
    parts.push('', '# Inputs', '', 'These files are in `inputs/` — read them before answering:', ...inputs.map((f) => `- \`inputs/${f}\``));
  }
  parts.push(
    '',
    '# Where things go',
    '',
    'You are in the job directory. Write the deliverable to `out/report.md`',
    '(the worker also captures your final message as the report). Put code,',
    'terraform and documents you create in `out/files/`, keeping their real',
    'names and subdirectories. Do not create or modify anything outside this',
    'job directory. When you are done, stop — a person reviews the result.',
  );
  return { template, prompt: parts.filter(Boolean).join('\n') };
}

function runPi(jobDir, prompt) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ['-p', '--model', cfg.model, '--session-dir', path.join(jobDir, '.session'), prompt];
    const child = spawn('pi', args, {
      cwd: jobDir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: cfg.piDir,
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      err += `\n[worker] killed after ${cfg.timeout} ms`;
    }, cfg.timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, ms: Date.now() - started });
    });
  });
}

// An agent that ran `terraform init` or `npm i` leaves megabytes of provider
// binaries in the deliverable. The files a person wants are the ones it wrote.
const JUNK = new Set(['.terraform', 'node_modules', '.git', '__pycache__', '.venv', '.pytest_cache']);
const MAX_FILE = 5 * 1024 * 1024;

async function pruneOut(dir) {
  const removed = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (JUNK.has(e.name)) {
        await fs.rm(p, { recursive: true, force: true });
        removed.push(e.name + '/');
      } else {
        removed.push(...(await pruneOut(p)).map((r) => path.join(e.name, r)));
      }
    } else if (e.isFile()) {
      const st = await fs.stat(p);
      if (st.size > MAX_FILE) {
        await fs.rm(p, { force: true });
        removed.push(`${e.name} (${(st.size / 1048576).toFixed(1)} MB)`);
      }
    }
  }
  return removed;
}

async function walkOut(dir, prefix = '') {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = path.join(prefix, e.name);
    if (e.isDirectory()) out.push(...(await walkOut(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function runJob(jobDir) {
  const name = path.basename(jobDir);
  const taskText = await fs.readFile(path.join(jobDir, 'task.md'), 'utf8');
  const { template, prompt } = await buildPrompt(jobDir, taskText);
  const outDir = path.join(jobDir, 'out');
  await fs.mkdir(path.join(outDir, 'files'), { recursive: true });

  say(`job ${name} · template ${template} · model ${cfg.model}`);
  let res = await runPi(jobDir, prompt);

  // A free tier answers 429 after a handful of tool calls; a job is not a
  // single request. Wait and take the job again rather than lose the work.
  const transient = /429|rate limit|RESOURCE_EXHAUSTED|overloaded|50[234]|connection reset|timeout/i;
  for (let attempt = 1; res.code !== 0 && attempt <= cfg.retries && transient.test(res.err); attempt++) {
    const wait = Math.min(90000, 20000 * attempt);
    say(`job ${name} · provider busy, retrying in ${Math.round(wait / 1000)}s (${attempt}/${cfg.retries})`);
    await new Promise((r) => setTimeout(r, wait));
    res = await runPi(jobDir, prompt);
  }

  const ok = res.code === 0 && res.out.trim().length > 0;
  let report = ok
    ? res.out.trim()
    : `# failed\n\nThe agent did not finish.\n\n\`\`\`\n${(res.err || res.out || '').trim().slice(-4000)}\n\`\`\`\n`;
  // The prompts ask for a box list. Asking is not checking: a list that drifts
  // from the shape is found here, in words a person can act on, and the report
  // says so before the drawing is believed.
  const checks = [];
  for (const f of ['boxes.yaml', 'context.yaml', 'deployment.yaml']) {
    const p = path.join(outDir, 'files', f);
    let text;
    try {
      text = await fs.readFile(p, 'utf8');
    } catch {
      continue;
    }
    const { boxes, arrows, problems } = parseBoxList(text);
    checks.push({ file: `out/files/${f}`, boxes: boxes.length, arrows: arrows.length, problems });
  }
  const bad = checks.filter((c) => c.problems.length);
  if (bad.length) {
    report +=
      '\n\n## Mechanical checks\n\nThe worker read the box list and found:\n\n' +
      bad
        .map((c) => `**${c.file}**\n\n` + c.problems.map((p) => `- ${p}`).join('\n'))
        .join('\n\n') +
      '\n';
  } else if (checks.length) {
    report +=
      '\n\n## Mechanical checks\n\n' +
      checks.map((c) => `- \`${c.file}\`: ${c.boxes} box(es), ${c.arrows} arrow(s), nothing wrong.`).join('\n') +
      '\n';
  }

  await fs.writeFile(path.join(outDir, 'report.md'), report.trim() + '\n');
  if (checks.length) {
    await fs.writeFile(path.join(outDir, 'checks.json'), JSON.stringify(checks, null, 2) + '\n');
  }
  const pruned = await pruneOut(path.join(outDir, 'files'));
  const files = await walkOut(path.join(outDir, 'files'));
  await fs.writeFile(
    path.join(outDir, 'state.json'),
    JSON.stringify(
      {
        job: name,
        template,
        model: cfg.model,
        status: ok ? 'done' : 'failed',
        exit: res.code,
        ms: res.ms,
        finished_at: new Date().toISOString(),
        files,
        checks,
        pruned,
        stderr_tail: ok ? '' : (res.err || '').trim().slice(-2000),
      },
      null,
      2,
    ) + '\n',
  );
  say(`job ${name} · ${ok ? 'done' : 'failed'} · ${(res.ms / 1000).toFixed(0)}s · ${files.length} file(s)`);
  return ok;
}

// --- the loop ------------------------------------------------------------

async function pending() {
  let entries;
  try {
    entries = await fs.readdir(cfg.jobs, { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(cfg.jobs, e.name);
    try {
      await fs.access(path.join(dir, 'task.md'));
    } catch {
      continue;
    }
    try {
      await fs.access(path.join(dir, 'out', 'state.json'));
      continue;
    } catch {
      jobs.push(dir);
    }
  }
  return jobs.sort();
}

async function main() {
  if (cfg.prune) {
    const removed = await pruneOut(path.resolve(cfg.prune));
    console.log(removed.length ? removed.join('\n') : 'nothing to prune');
    return;
  }

  await fs.mkdir(cfg.jobs, { recursive: true });
  if (cfg.dry) {
    const jobs = await pending();
    if (!jobs.length) return say('nothing to do');
    for (const job of jobs) {
      const { template, prompt } = await buildPrompt(job, await fs.readFile(path.join(job, 'task.md'), 'utf8'));
      console.log(`## ${path.basename(job)} · template ${template}\n`);
      console.log(prompt);
    }
    return;
  }
  await preparePi();
  say(`va-agent · jobs ${cfg.jobs} · model ${cfg.model}`);

  if (cfg.once) {
    const jobs = await pending();
    if (!jobs.length) return say('nothing to do');
    for (const job of jobs) await runJob(job);
    return;
  }

  let stopping = false;
  process.on('SIGINT', () => (stopping = true));
  process.on('SIGTERM', () => (stopping = true));
  while (!stopping) {
    const jobs = await pending();
    for (const job of jobs) {
      if (stopping) break;
      await runJob(job);
    }
    if (!jobs.length) await new Promise((r) => setTimeout(r, cfg.poll));
  }
  say('stopped');
}

main().catch((e) => {
  console.error('va-agent:', e.message);
  process.exit(1);
});
