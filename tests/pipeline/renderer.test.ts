import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RENDERER,
  rendererOutputPath,
  rendererStageVersion,
  resolveRenderer,
  assertRendererMatch,
  type RendererId,
} from '../../src/pipeline/renderer.ts';
import { validProductInput } from '../fixtures/input.ts';

test('historical input defaults to HyperFrames and keeps legacy output paths', () => {
  assert.equal(resolveRenderer(validProductInput), DEFAULT_RENDERER);
  assert.equal(rendererOutputPath('F:/project', 'hyperframes', 'draft').replaceAll('\\', '/'), 'F:/project/renders/draft.mp4');
});

test('explicit Remotion selection uses an isolated output directory and versioned fingerprint', () => {
  const input = { ...validProductInput, renderMode: 'remotion' as const };
  assert.equal(resolveRenderer(input), 'remotion');
  assert.equal(rendererOutputPath('F:/project', 'remotion', 'final').replaceAll('\\', '/'), 'F:/project/renders/remotion/final.mp4');
  assert.match(rendererStageVersion('remotion'), /remotion/);
});

test('a requested renderer cannot silently differ from the frozen project renderer', () => {
  const input = { ...validProductInput, renderMode: 'hyperframes' as const };
  assert.doesNotThrow(() => assertRendererMatch(input, 'hyperframes'));
  assert.throws(() => assertRendererMatch(input, 'remotion'), /renderer|renderMode/i);
});

test('renderer resolver rejects unsupported values', () => {
  assert.throws(() => resolveRenderer({ ...validProductInput, renderMode: 'other' as RendererId }), /renderer|renderMode/i);
});
