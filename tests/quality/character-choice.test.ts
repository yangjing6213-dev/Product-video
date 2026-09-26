// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';import {test} from 'node:test';
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';import puppeteer from 'puppeteer-core';
import {renderCharacterChoicePage} from '../../src/quality/character-choice.ts';
import {environment,command} from '../../src/pipeline/tools.ts';import {digest} from '../../src/pipeline/stage-state.ts';
const options={projectId:'choice-test',previews:{enhe:{path:'enhe.mp4',sha256:digest('fixture')},stickman:{path:'stickman.mp4',sha256:digest('fixture')}}};
test('character choices reject unsafe media paths and never start with implicit acceptance',()=>{
 const html=renderCharacterChoicePage(options);assert.doesNotMatch(html,/<input[^>]*checked/);assert.match(html,/connect-src 'none'/);assert.match(html,/productionApproval:false/);
 const invalid=structuredClone(options);invalid.previews.enhe.path='../outside.mp4';assert.throws(()=>renderCharacterChoicePage(invalid),/path|relative|traversal/i);
});
test('local choice UI measures uploaded pixels and exports a preparation request without approving production',async t=>{
 const base=path.resolve('.cache');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'角色选择 中文 '));
 t.after(async()=>{assert.equal(path.dirname(dir),base);assert.ok(path.basename(dir).startsWith('角色选择 中文 '));await fs.rm(dir,{recursive:true});});
 const html=path.join(dir,'review.html');await fs.writeFile(html,renderCharacterChoicePage(options));
 const env=await environment(),browser=await puppeteer.launch({headless:true,executablePath:env.HYPERFRAMES_BROWSER_PATH});t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto(pathToFileURL(html).href);
 assert.equal(await page.$eval('#save',(e:any)=>e.disabled),true);
 await page.click('input[value=enhe]');assert.equal(await page.$eval('#save',(e:any)=>e.disabled),true);
 await page.click('#watched');assert.equal(await page.$eval('#save',(e:any)=>e.disabled),false);
 await page.click('input[value=custom]');assert.equal(await page.$eval('#save',(e:any)=>e.disabled),true);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=12;c.height=12;c.getContext('2d')!.fillRect(4,4,4,4);return c.toDataURL('image/png').split(',')[1]!;});
 const upload=path.join(dir,'自定义形象.png');await fs.writeFile(upload,Buffer.from(png,'base64'));
 await (await (await page.$('#upload'))!.toElement('input')).uploadFile(upload);await page.waitForFunction(()=>document.getElementById('alpha')!.textContent!.includes('88.9%'));
 assert.equal(await page.$eval('#save',(e:any)=>e.disabled),true);await page.click('#rights');assert.equal(await page.$eval('#save',(e:any)=>e.disabled),true);await page.click('#watched');assert.equal(await page.$eval('#save',(e:any)=>e.disabled),false);
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});await page.click('#save');
 const target=path.join(dir,'character-choice-request.json');let text='';for(let i=0;i<30;i++){try{text=await fs.readFile(target,'utf8');break;}catch{await pause(50);}}
 const request=JSON.parse(text);assert.equal(request.requestType,'PREPARE_CUSTOM');assert.equal(request.productionApproval,false);assert.equal(request.custom.status,'PREPARATION_REQUIRED');assert.equal(request.custom.sha256,digest(await fs.readFile(upload)));assert.equal(request.mode,'custom');
});
test('actual options CLI verifies preview hashes and refuses overwriting an existing choice page',async t=>{
 const base=path.resolve('.cache');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'choice-cli-')),project=path.join(root,'projects/choice-test');await fs.mkdir(project,{recursive:true});
 t.after(async()=>{assert.equal(path.dirname(root),base);assert.ok(path.basename(root).startsWith('choice-cli-'));await fs.rm(root,{recursive:true});});
 for(const name of ['enhe.mp4','stickman.mp4'])await fs.writeFile(path.join(project,name),'fixture');const input=path.join(root,'options.json');await fs.writeFile(input,JSON.stringify(options));
 const args=[path.resolve('src/quality/cli.ts'),'character-options','--project-root',root,'--project','choice-test','--selection',input];
 const first=await command(process.execPath,args);assert.equal(first.exitCode,0,first.stderr);assert.equal(JSON.parse(first.stdout).status,'NOT_RUN');
 const again=await command(process.execPath,args);assert.notEqual(again.exitCode,0);
});
