#!/usr/bin/env node
// Make a job with no effort: node test/make-job.mjs <template> "<request>" [dir]
import fs from 'node:fs/promises';
import path from 'node:path';

const [template = 'context', text = 'Describe the system.', where = 'jobs'] = process.argv.slice(2);
const name = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${template}`;
const dir = path.join(where, name);
await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
await fs.writeFile(
  path.join(dir, 'task.md'),
  `---\ntemplate: ${template}\ntitle: ${template}\n---\n\n${text}\n`,
);
console.log(dir);
