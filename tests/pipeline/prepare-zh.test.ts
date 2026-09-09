import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withNewProject } from '../../scripts/prepare-zh-variants.mjs';

test('variant preparation rolls back only its new project on a copy failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'epvs-prepare-'));
  const project = path.join(root,'new-project');
  try {
    await assert.rejects(withNewProject(project,root,async()=>{
      await writeFile(path.join(project,'partial.txt'),'partial');
      throw new Error('simulated copy failure');
    }),/simulated copy failure/);
    assert.equal(await access(project).then(()=>true,()=>false),false);
    await withNewProject(project,root,()=>writeFile(path.join(project,'ready.txt'),'ready'));
    assert.equal(await readFile(path.join(project,'ready.txt'),'utf8'),'ready');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('variant preparation preserves an existing directory and rejects outside paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'epvs-prepare-'));
  const project = path.join(root,'existing');
  try {
    await mkdir(project);await writeFile(path.join(project,'user.txt'),'user data');
    await assert.rejects(withNewProject(project,root,async()=>{throw new Error('must not execute');}),/EEXIST/);
    assert.equal(await readFile(path.join(project,'user.txt'),'utf8'),'user data');
    await assert.rejects(withNewProject(path.join(root,'..','outside'),root,async()=>{}),/inside/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
