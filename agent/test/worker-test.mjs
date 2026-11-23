#!/usr/bin/env node
// The worker's mechanics, with no model and no network.
//
//   node test/worker-test.mjs
//
// Checks the parts that must not drift: front matter becomes a template, inputs
// are listed for the agent, a dry run touches nothing, and the deliverable does
// not carry provider binaries.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseBoxList } from '../lib/boxes.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORKER = path.join(ROOT, 'worker.mjs');

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL ${name} — ${e.message}`);
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function worker(args, env = {}) {
  return execFileSync('node', [WORKER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, VPL_JOBS: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'va-agent-test-'));
const jobs = path.join(tmp, 'jobs');
const job = path.join(jobs, '001-sample');

await fs.mkdir(path.join(job, 'inputs'), { recursive: true });
await fs.writeFile(
  path.join(job, 'task.md'),
  [
    '---',
    'template: terraform',
    'title: A small API',
    '---',
    '',
    'Build the smallest thing that serves one endpoint.',
    '',
  ].join('\n'),
);
await fs.writeFile(path.join(job, 'inputs', 'inventory.yaml'), 'boxes: []\n');

let out = '';
check('a dry run assembles the prompt', () => {
  out = worker(['--dry'], { VPL_JOBS: jobs });
  must(out.includes('template terraform'), 'template name missing');
});
check('the base rules are prepended', () => {
  must(out.includes('Evidence before prose'), 'base.md not in prompt');
});
check('the template prompt is included', () => {
  must(out.includes('Template: terraform'), 'terraform.md not in prompt');
});
check('the task body is included, front matter is not', () => {
  must(out.includes('serves one endpoint'), 'task body missing');
  must(!out.includes('title: A small API'), 'front matter leaked into the prompt');
});
check('inputs are named for the agent', () => {
  must(out.includes('inputs/inventory.yaml'), 'input file not listed');
});
check('a dry run created no out/', () => {
  must(!fsSync.existsSync(path.join(job, 'out')), 'out/ appeared during a dry run');
});

const files = path.join(job, 'out', 'files');
await fs.mkdir(path.join(files, '.terraform', 'providers'), { recursive: true });
await fs.writeFile(path.join(files, '.terraform', 'providers', 'bin'), 'x');
await fs.writeFile(path.join(files, 'main.tf'), 'resource "null_resource" "a" {}\n');
await fs.writeFile(path.join(files, 'dump.bin'), Buffer.alloc(6 * 1024 * 1024));

check('pruning removes provider binaries and oversized files', () => {
  worker(['--prune', files]);
  must(!fsSync.existsSync(path.join(files, '.terraform')), '.terraform survived');
  must(!fsSync.existsSync(path.join(files, 'dump.bin')), 'oversized file survived');
  must(fsSync.existsSync(path.join(files, 'main.tf')), 'real deliverable was removed');
});

const good = `boxes:
  - id: person
    label: Person
    kind: person
    host: ""
    note: [no address] the one user
  - id: api
    label: API
    kind: service
    host: api.example.hr:443
    note: serves the editor
arrows:
  - from: person
    to: api
    label: https
`;

check('a good box list has nothing wrong', () => {
  const r = parseBoxList(good);
  must(r.problems.length === 0, r.problems.join('; '));
  must(r.boxes.length === 2 && r.arrows.length === 1, 'wrong counts');
});

check('a box list using "name" instead of "id" is reported', () => {
  const r = parseBoxList(good.replace('id: api', 'name: api'));
  must(r.problems.some((p) => p.includes('uses "name" instead of "id"')), r.problems.join('; '));
});

check('an unknown kind is reported with the closed list', () => {
  const r = parseBoxList(good.replace('kind: service', 'kind: deployment'));
  must(r.problems.some((p) => p.includes('not one of')), r.problems.join('; '));
});

check('an arrow to nowhere is reported', () => {
  const r = parseBoxList(good.replace('to: api', 'to: gateway'));
  must(r.problems.some((p) => p.includes('which is not a box')), r.problems.join('; '));
});

check('an orphan box is reported', () => {
  const r = parseBoxList(good.replace('arrows:', '  - id: lonely\n    label: Lonely\n    kind: vm\n    host: 10.0.0.9\n    note: nothing talks to it\narrows:'));
  must(r.problems.some((p) => p.includes('has no arrows')), r.problems.join('; '));
});

await fs.rm(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
