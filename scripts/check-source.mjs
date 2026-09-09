import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['src', 'tests', 'scripts', 'recipes', 'prompts', 'skills'];
const textExtensions = new Set(['.ts', '.js', '.mjs', '.json', '.md']);
const sourceExtensions = new Set(['.ts', '.js', '.mjs']);
const failures = [];

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(target));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function relative(file) {
  return path.relative(repositoryRoot, file).replaceAll('\\', '/');
}

function checkFrontmatter(file, content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return;
  const lines = content.split(/\r?\n/);
  const closing = lines.indexOf('---', 1);
  if (closing < 0) {
    failures.push(`${relative(file)}: frontmatter has no closing delimiter`);
    return;
  }
  const fields = new Map();
  for (const line of lines.slice(1, closing)) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/.exec(line);
    if (!match) failures.push(`${relative(file)}: invalid simple frontmatter line: ${line}`);
    else fields.set(match[1], match[2].trim());
  }
  if (relative(file).endsWith('/SKILL.md')) {
    for (const field of ['name', 'description']) {
      if (!fields.get(field)) failures.push(`${relative(file)}: missing frontmatter field ${field}`);
    }
  }
  if (relative(file).startsWith('prompts/')) {
    for (const field of ['id', 'version', 'artifact']) {
      if (!fields.get(field)) failures.push(`${relative(file)}: missing frontmatter field ${field}`);
    }
  }
}

const files = roots.flatMap((root) => filesUnder(path.join(repositoryRoot, root))).sort();
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (!content.length) failures.push(`${relative(file)}: file is empty`);
  content.split(/\r?\n/).forEach((line, index) => {
    if (/[\t ]+$/.test(line)) failures.push(`${relative(file)}:${index + 1}: trailing whitespace`);
  });

  if (path.extname(file) === '.json') {
    try { JSON.parse(content); }
    catch (error) { failures.push(`${relative(file)}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (path.extname(file) === '.md') checkFrontmatter(file, content);
  if (sourceExtensions.has(path.extname(file))) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) failures.push(`${relative(file)}: syntax check failed\n${(result.stderr || result.stdout).trim()}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} source and contract files.`);
}
