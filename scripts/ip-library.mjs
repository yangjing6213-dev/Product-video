// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pythonIndex = args.indexOf('--python');
const python = pythonIndex < 0 ? (process.env.EPVS_PYTHON || 'python') : args.splice(pythonIndex, 2)[1];
if (!python) throw new Error('--python requires an executable path');
if (!args.length || args[0] === 'help') args.splice(0, args.length, '--help');
if (!args.includes('--project-root') && !args.includes('--help')) args.push('--project-root', root);
const result = spawnSync(python, ['-X', 'utf8', path.join(root, 'scripts/asset_library.py'), ...args], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
