import { constants } from 'node:fs';
import { mkdir, readFile, readdir, copyFile, writeFile, access, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInput, validateSpec } from '../src/contracts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function withNewProject(target, projectRoot, writer) {
  const resolved = path.resolve(target), parent = path.resolve(projectRoot);
  if (path.dirname(resolved) !== parent) throw new Error('New project must stay directly inside the project root');
  await mkdir(resolved);
  const owned = await lstat(resolved);
  try { await writer(); }
  catch (error) {
    const current = await lstat(resolved).catch(()=>null);
    if (current && current.isDirectory() && !current.isSymbolicLink() && current.ino === owned.ino && current.birthtimeMs === owned.birthtimeMs) {
      await rm(resolved,{recursive:true,force:true});
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const authored = JSON.parse(await readFile(path.join(root, 'docs/creative/zh-narration-scripts.json'), 'utf8'));
// Pronunciation is authored in Chinese; the Mandarin-only frontend must not drop Latin words.
const revisions = {
  'enhe-ai-homepage': {
    'scene-01': ['从真实任务出发，', '找到合适的人工智能工具。'],
    'scene-06': ['访问官网，', '从手头的一件真实任务开始。'],
  },
  'cognitive-anchor-sketcher': {
    'scene-01': ['把文章里的关键认知，', '变成看得见的画面。'],
    'scene-06': ['查看项目代码，', '让每张图都和正文站在同一边。'],
  },
  'project-brand-studio': {
    'scene-01': ['让品牌选择，', '成为一套可追溯的流程。'],
    'scene-06': ['查看项目代码，', '让下一次品牌输出沿用这些决定。'],
  },
};
for (const script of authored.projects) {
  const source = path.join(root, 'projects', script.projectId);
  const id = `${script.projectId}-zh`;
  const target = path.join(root, 'projects', id);
  if (await access(target).then(() => true, () => false)) throw new Error(`Preserving existing project: ${id}`);
  const input = JSON.parse(await readFile(path.join(source, 'input/product-input.json'), 'utf8'));
  const spec = JSON.parse(await readFile(path.join(source, 'video-spec.json'), 'utf8'));
  const audioAsset = {id:'narration-zh',type:'audio',path:'assets/narration.wav',sourceUrl:'',license:'owned',required:true,fallbackAssetId:null};
  for (const document of [input, spec]) {
    document.projectId = id;
    document.audio = {narrationMode:'external-audio',voice:'zf_001',externalAudioAssetId:audioAsset.id,musicAssetId:null};
    document.assets.push(audioAsset);
  }
  const actualScript = {
    schemaVersion:'1.0', projectId:id, sourceScriptVersion:authored.scriptVersion,
    timingRule:'Caption times will be measured from generated PCM; authored estimates are excluded.',
    scenes:script.scenes.map(item => {
      const texts = revisions[script.projectId]?.[item.sceneId] ?? item.captionSegments.map(segment => segment.text);
      return {sceneId:item.sceneId,voiceover:texts.join(''),captionSegments:texts.map(text => ({text}))};
    }),
  };
  for (const scene of spec.scenes) {
    scene.voiceover = actualScript.scenes.find(item => item.sceneId === scene.id).voiceover;
    delete scene.caption;
    scene.motionDirection += ' 字幕按实际音频分句时间显隐，保持底部安全区。';
  }
  validateInput(input); validateSpec(spec);
  await withNewProject(target,path.join(root,'projects'),async()=>{
  await mkdir(path.join(target, 'assets'), {recursive:true});
  await mkdir(path.join(target, 'input'));
  const write = (file, contents) => writeFile(path.join(target,file),contents,{flag:'wx'});
  for (const asset of spec.assets.filter(item => item.type !== 'audio')) {
    await copyFile(path.join(source, asset.path), path.join(target, asset.path), constants.COPYFILE_EXCL);
  }
  for (const name of await readdir(path.join(source, 'assets'))) {
    if (/\.(md|html|txt)$/i.test(name)) await copyFile(path.join(source,'assets',name),path.join(target,'assets',name),constants.COPYFILE_EXCL);
  }
  for (const file of ['DESIGN.md','STORYBOARD.md','PRODUCT-SUMMARY.md']) {
    const previous = await readFile(path.join(source,file),'utf8').catch(error => {if(error.code==='ENOENT')return null;throw error;});
    if (previous) await write(file,`${previous}\n\n中文旁白增补：保留原视觉和场景时段；音频使用本地 Kokoro 中文模型生成。当前旁白以 SCRIPT.md 为准，字幕与实测分句音频边界一致，原静态字幕说明由本增补取代。\n`);
  }
  await write('input/product-input.json',JSON.stringify(input,null,2)+'\n');
  await write('video-spec.json',JSON.stringify(spec,null,2)+'\n');
  await write('input/narration-script.json',JSON.stringify(actualScript,null,2)+'\n');
  await write('SCRIPT.md',`# ${input.product.name} — 中文旁白版\n\n本地合成女声 zf_001；保留原片 45 秒场景结构。字幕来自逐句实测音频，非字数估算。英文产品名及网址保留在画面中，旁白采用自然中文表达。\n\n| 场景 | 旁白 |\n|---|---|\n${actualScript.scenes.map(scene=>`| ${scene.sceneId} | ${scene.voiceover} |`).join('\n')}\n`);
  await write('assets/NARRATION-NOTICE.md','旁白由本项目使用本地 Kokoro v1.1-zh 模型、预设女声 zf_001 和原创中文脚本合成，含 AI 生成音频；未克隆个人声音。模型及后端许可证见 docs/guides/CHINESE-TTS.md。音频与字幕时间数据随本地项目提供。\n');
  console.log(id);
  });
}
}
