import assert from 'node:assert/strict';
import test from 'node:test';

import { validateInput, validateQaReport, validateSpec } from '../../src/contracts.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';

test('validateInput accepts the documented product input including a Windows-safe relative path with spaces', () => {
  const input = structuredClone(validProductInput);
  input.assets[0]!.path = 'assets/Brand Assets/Primary Logo.svg';

  assert.deepEqual(validateInput(input), input);
});

test('validateInput rejects non-hex brand colors and more than three features', () => {
  const badColor = structuredClone(validProductInput) as unknown as Record<string, unknown>;
  (badColor.brand as { colors: string[] }).colors = ['navy'];
  assert.throws(() => validateInput(badColor), /brand\/colors\/0/);

  const tooManyFeatures = structuredClone(validProductInput);
  tooManyFeatures.product.features = Array.from({ length: 4 }, (_, index) => ({
    name: `Feature ${index}`,
    benefit: `Benefit ${index}`,
    evidenceAssetIds: [],
  }));
  assert.throws(() => validateInput(tooManyFeatures), /features/);
});

test('validateInput enforces the DESIGN gate brand color and font-family counts', () => {
  for (const colors of [
    ['#000000', '#FFFFFF'],
    ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'],
  ]) {
    const input = structuredClone(validProductInput);
    input.brand.colors = colors;
    assert.throws(() => validateInput(input), /brand\/colors/);
  }

  for (const fontFamilies of [[], ['Inter', 'Microsoft YaHei', 'Arial']]) {
    const input = structuredClone(validProductInput);
    input.brand.fontFamilies = fontFamilies;
    assert.throws(() => validateInput(input), /brand\/fontFamilies/);
  }
});

test('validateInput enforces the fixed output contract and 30–60 second range', () => {
  const wrongSize = structuredClone(validProductInput);
  wrongSize.output.width = 1280 as 1920;
  assert.throws(() => validateInput(wrongSize), /output\/width/);

  const tooShort = structuredClone(validProductInput);
  tooShort.output.targetDurationSec = 29;
  assert.throws(() => validateInput(tooShort), /targetDurationSec/);
});

test('projectId uses the same lowercase hyphenated directory-safe contract as the runtime guard', () => {
  for (const projectId of ['Project', 'project_name', 'project.name', `${'a'.repeat(80)}b`]) {
    const input = structuredClone(validProductInput);
    input.projectId = projectId;
    assert.throws(() => validateInput(input), /projectId/);
  }
  const valid = structuredClone(validProductInput);
  valid.projectId = 'project-01';
  assert.equal(validateInput(valid).projectId, 'project-01');

  const invalidSpec = structuredClone(validVideoSpec);
  invalidSpec.projectId = 'Project.Name';
  assert.throws(() => validateSpec(invalidSpec), /projectId/);
});

test('validateSpec accepts a complete five-scene spec', () => {
  assert.deepEqual(validateSpec(structuredClone(validVideoSpec)), validVideoSpec);
});

test('validateSpec rejects fewer than five scenes and invalid timing fields', () => {
  const tooFew = structuredClone(validVideoSpec);
  tooFew.scenes = tooFew.scenes.slice(0, 4);
  assert.throws(() => validateSpec(tooFew), /scenes/);

  const reversed = structuredClone(validVideoSpec);
  reversed.scenes[0]!.actualEndSec = -1;
  assert.throws(() => validateSpec(reversed), /actualEndSec/);
});

test('validateSpec rejects duplicate scene IDs and composition paths outside the project', () => {
  const duplicate = structuredClone(validVideoSpec);
  duplicate.scenes[1]!.id = duplicate.scenes[0]!.id;
  assert.throws(() => validateSpec(duplicate), /scene IDs must be unique/);

  for (const compositionFile of ['../outside.html', 'compositions/../../outside.html', '/outside.html', 'C:\\outside.html']) {
    const unsafe = structuredClone(validVideoSpec);
    unsafe.scenes[0]!.compositionFile = compositionFile;
    assert.throws(() => validateSpec(unsafe), /compositionFile/);
  }
});

test('validateSpec bounds hero frames when actual timing exists but preserves planning specs with null timing', () => {
  const outside = structuredClone(validVideoSpec);
  outside.scenes[1]!.heroFrameSec = outside.scenes[1]!.actualEndSec!;
  assert.throws(() => validateSpec(outside), /heroFrameSec/);

  const planned = structuredClone(validVideoSpec);
  for (const scene of planned.scenes) {
    scene.actualStartSec = null;
    scene.actualEndSec = null;
  }
  planned.scenes[0]!.heroFrameSec = 30;
  assert.doesNotThrow(() => validateSpec(planned));
});

test('validateQaReport accepts check results and rejects unknown statuses', () => {
  assert.doesNotThrow(() =>
    validateQaReport({
      schemaVersion: '1.0',
      projectId: 'demo',
      status: 'PASS',
      generatedAt: '2026-09-09T00:00:00.000Z',
      checks: [{ id: 'media.fps', status: 'PASS', message: '30 fps' }],
      warnings: [],
      artifacts: { contactSheet: 'reports/contact-sheet.jpg' },
    }),
  );

  assert.throws(() =>
    validateQaReport({
      schemaVersion: '1.0',
      projectId: 'demo',
      status: 'PASS',
      generatedAt: '2026-09-09T00:00:00.000Z',
      checks: [{ id: 'media.fps', status: 'UNKNOWN', message: 'not checked' }],
    }),
  );
});
