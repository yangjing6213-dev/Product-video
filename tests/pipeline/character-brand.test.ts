// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { characterFixture } from '../fixtures/character.ts';
import { productInputFromSpec } from '../../src/pipeline/generator.ts';
import { initialize, verifyProjectBrand } from '../../src/pipeline/project.ts';
import { digest } from '../../src/pipeline/stage-state.ts';

test('unreviewed actor is rejected; approved frozen actor survives catalog updates but rejects different runtime bytes',async t=>{
 const base=path.resolve('.cache/character-library-tests');await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'中文 素材 '));
 t.after(async()=>{assert.equal(path.dirname(root),base);await rm(root,{recursive:true});});
 const spec=characterFixture(), input=productInputFromSpec(spec);
 input.assets=input.assets.filter(a=>a.characterPoses);
 const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><path d="M0 0L200 300" stroke="black"/></svg>');
 input.assets[0]!.path='actor.svg';input.brandLibrary!.selections[0]!.sha256=digest(bytes);
 await writeFile(path.join(root,'actor.svg'),bytes);
 const catalogPath=path.join(root,'assets/brand/enhe/ip/catalog.json');await mkdir(path.dirname(catalogPath),{recursive:true});
 const entry={assetId:'actor-sheet',contentVersion:'test-v1',sha256:digest(bytes),originalPath:'actor.svg',preparedPath:null,preparedHash:null,previewPath:null,reviewStatus:'UNREVIEWED',mediaType:'image/svg+xml'};
 const catalog={schemaVersion:'1.0',libraryVersion:'test',assets:[entry]};
 await writeFile(catalogPath,JSON.stringify(catalog));
 const inputPath=path.join(root,'input.json');await writeFile(inputPath,JSON.stringify(input));
 await assert.rejects(initialize(inputPath,root),/review|approved/i);
 entry.reviewStatus='APPROVED';await writeFile(catalogPath,JSON.stringify(catalog));
 const project=await initialize(inputPath,root);
 await verifyProjectBrand(project);
 const frozen=await readFile(path.join(project,'frozen-brand-assets.json'),'utf8');
 entry.reviewStatus='EXCLUDED';entry.contentVersion='new-version';await writeFile(catalogPath,JSON.stringify(catalog));
 await verifyProjectBrand(project);
 assert.equal(await readFile(path.join(project,'frozen-brand-assets.json'),'utf8'),frozen);
 await writeFile(path.join(project,'assets/actor-sheet.svg'),'different unreviewed image');
 await assert.rejects(verifyProjectBrand(project),/actor bytes differ/i);
});
