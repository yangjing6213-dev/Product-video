// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPO, redact } from '../pipeline/tools.ts';
import { projectPath, specFor } from '../pipeline/project.ts';
import { freezeBrandAssets } from '../assets/library.ts';
import { assessAcceptance, freezeCreativePlan, recordHumanDecision, resumeCreativePlan } from './plan.ts';
import { renderQuality } from './render.ts';
import { assessCopyReview, assertCopyApproved, assertVideoSpecCopyApproved, freezeCopyDraft, recordCopyDecision } from './copy.ts';
import { assessCharacterReview, assertCharacterReview, freezeCharacterReview, recordCharacterDecision } from './character-review.ts';
import {renderCharacterChoicePage,type CharacterChoiceOptions} from './character-choice.ts';
import {resolveProjectAsset,writeExclusiveSnapshot} from '../assets/library.ts';
import {digest} from '../pipeline/stage-state.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'project-root': { type: 'string', default: REPO }, project: { type: 'string' }, plan: { type: 'string' },
  selection: { type: 'string' }, decision: { type: 'string' }, output: { type: 'string', default: 'review' }, resume: { type: 'boolean' },
  copy: { type: 'string' }, 'legacy-spec': { type: 'boolean' },
} });
const action = positionals[0];
async function main(): Promise<unknown> {
  if (!action || action === 'help') return 'quality character-freeze --project ID --selection FILE | character-review --project ID --decision FILE (actual user instruction and reviewed reviewSha256 required) | character-status|character-check --project ID | copy-freeze --project ID --copy FILE | copy-review --project ID --decision FILE (actual user instruction and reviewed copySha256 required) | copy-status|copy-check --project ID [--legacy-spec] | freeze --project ID --plan FILE [--selection FILE] | resume|status|render --project ID [--output NEW-NAME] [--resume] | review --project ID --decision FILE (actual user instruction only)';
  if (!values.project) throw new Error('--project is required');
  const root = path.resolve(values['project-root']), project = projectPath(values.project, root);
  const json = async (file: string | undefined) => { if (!file) throw new Error('Input file required'); return JSON.parse(await readFile(file, 'utf8')); };
  if(action==='character-options'){
    const options=await json(values.selection) as CharacterChoiceOptions;
    if(options.projectId!==values.project)throw Error('Choice options belong to a different project');
    for(const preview of Object.values(options.previews))if(digest(await readFile(await resolveProjectAsset(project,preview.path)))!==preview.sha256)throw Error('Character choice preview changed');
    const html=renderCharacterChoicePage(options),output=await resolveProjectAsset(project,'character-options.html',true);
    await writeExclusiveSnapshot(output,html);return {path:output,status:'NOT_RUN',meaning:'User character choice pending'};
  }
  if (action === 'character-freeze') return freezeCharacterReview(root, project, await json(values.selection));
  if (action === 'character-review') return recordCharacterDecision(root, project, await json(values.decision));
  if (action === 'character-status') return assessCharacterReview(root, project);
  if (action === 'character-check') {
    const spec = await specFor(project);
    if (!spec.scenes.some(scene => scene.character?.performance)) throw new Error('This task has no character performance selection to check');
    await assertCharacterReview(root, project, spec);
    return assessCharacterReview(root, project);
  }
  if (action === 'copy-freeze') return freezeCopyDraft(root, project, await json(values.copy));
  if (action === 'copy-review') return recordCopyDecision(root, project, await json(values.decision));
  if (action === 'copy-status') return assessCopyReview(root, project);
  if (action === 'copy-check') return values['legacy-spec']
    ? assertVideoSpecCopyApproved(root, project, await json(path.join(project, 'video-spec.json')))
    : assertCopyApproved(root, project);
  if (action === 'freeze') {
    if (values.selection) await freezeBrandAssets(root, project, await json(values.selection));
    return freezeCreativePlan(root, project, await json(values.plan));
  }
  if (action === 'resume') return resumeCreativePlan(root, project);
  if (action === 'status') return { ...await assessAcceptance(root, project), copyReview: await assessCopyReview(root, project), characterReview: await assessCharacterReview(root, project) };
  if (action === 'render') return renderQuality(root, project, values.output, values.resume);
  if (action === 'review') return recordHumanDecision(root, project, await json(values.decision));
  throw new Error('Unknown quality command');
}
main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
