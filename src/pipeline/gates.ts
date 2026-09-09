import path from 'node:path';
import { exists } from './stage-state.ts';

export async function captureWithFallback(capture: () => Promise<string[]>, supplied: () => Promise<string[]>): Promise<{ provider: string; files: string[]; reason?: string }> {
  try {
    const files = await capture();
    if (!files.length) throw new Error('Capture produced no screenshots');
    return { provider: 'hyperframes-capture', files };
  } catch (error) {
    const files = await supplied();
    if (!files.length) throw new Error(`No usable supplied assets after capture failure: ${error instanceof Error ? error.message : String(error)}`);
    return { provider: 'supplied-assets', files, reason: error instanceof Error ? error.message : String(error) };
  }
}
export async function requireCreative(project: string): Promise<string[]> {
  const files = ['DESIGN.md', 'SCRIPT.md', 'STORYBOARD.md', 'video-spec.json'];
  for (const file of files) if (!await exists(path.join(project, file))) throw new Error(`Codex creative stage requires ${file}; use skills/enhe-product-video/SKILL.md to author it`);
  return files.map(file => path.join(project, file));
}
export function selectNarration(mode: string, backendAvailable: boolean, externalExists: boolean): { mode: string; status: 'PASS' | 'SKIPPED_WITH_REASON'; reason?: string } {
  if (mode === 'external-audio') {
    if (!externalExists) throw new Error('External audio is missing');
    return { mode, status: 'PASS' };
  }
  if (mode === 'hyperframes' && backendAvailable) return { mode, status: 'PASS' };
  return { mode: 'none', status: 'SKIPPED_WITH_REASON', reason: mode === 'none' ? 'No narration requested; screen captions retained' : 'Local TTS backend/language unavailable; no speech generated' };
}
