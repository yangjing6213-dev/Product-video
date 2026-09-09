import { mkdir, writeFile, readFile, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Explicit CLI input: trusted tool archives only. Files are never overwritten.
const [url, output] = process.argv.slice(2);
if (!url || !output) throw new Error('Usage: node scripts/download-portable.mjs <https archive URL> <new output>');
if (!['storage.googleapis.com', 'www.gyan.dev', 'api.github.com'].includes(new URL(url).hostname)) throw new Error('Untrusted tool archive host');
const headers = { Accept: 'application/octet-stream' };
const response = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Archive HEAD failed ${response.status}`);
const size = Number(response.headers.get('content-length'));
if (!size) throw new Error('Missing archive size');
await mkdir(path.dirname(output), { recursive: true });
const parts = `${output}.parts`;
await mkdir(parts, { recursive: true });
const chunkSize = 8 * 1024 * 1024;
const jobs = Array.from({ length: Math.ceil(size / chunkSize) }, (_, i) => i);
await Promise.all(Array.from({ length: 6 }, async () => {
  while (jobs.length) {
    const i = jobs.shift();
    const start = i * chunkSize, end = Math.min(size - 1, start + chunkSize - 1);
    const file = path.join(parts, `${i}.part`);
    try { if ((await stat(file)).size === end - start + 1) continue; } catch {}
    const r = await fetch(url, { headers: { ...headers, Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(180000) });
    if (r.status !== 206 || r.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) throw new Error(`Range rejected ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length !== end - start + 1) throw new Error('Truncated archive part');
    await writeFile(file, bytes);
    console.log(`part ${i + 1}/${Math.ceil(size / chunkSize)}`);
  }
}));
const target = await open(output, 'wx');
const hash = createHash('sha256');
try {
  for (let i = 0; i < Math.ceil(size / chunkSize); i++) { const bytes = await readFile(path.join(parts, `${i}.part`)); await target.write(bytes); hash.update(bytes); }
} finally { await target.close(); }
console.log(JSON.stringify({ url, output, bytes: size, sha256: hash.digest('hex') }));
