import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assessDependencyRisk } from '../../scripts/check-dependency-risk.mjs';

const root = process.cwd();

test('the reviewed HyperFrames build does not call vulnerable adm-zip extraction APIs', async () => {
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const hyperframesPackage = JSON.parse(await readFile(path.join(root, 'node_modules/hyperframes/package.json'), 'utf8'));
  const admZipPackage = JSON.parse(await readFile(path.join(root, 'node_modules/adm-zip/package.json'), 'utf8'));
  const hyperframesBundle = await readFile(path.join(root, 'node_modules/hyperframes/dist/cli.js'), 'utf8');

  const result = assessDependencyRisk({ packageLock, hyperframesPackage, admZipPackage, hyperframesBundle });

  assert.equal(result.status, 'PASS_WITH_DOCUMENTED_RISK');
  assert.equal(result.rawNpmAuditExpectedToPass, false);
  assert.deepEqual(result.detectedAffectedApiCalls, []);
  assert.deepEqual(result.reviewedVersions, { hyperframes: '0.8.33', admZip: '0.6.0' });
  assert.deepEqual(result.installedVersions, { hyperframes: '0.8.33', admZip: '0.6.0' });
  assert.equal(result.lockedDependencyRange, '^0.6.0');
  assert.equal(result.installedDependencyRange, '^0.6.0');
  assert.equal(result.bundleSha256, 'af57f08331c602ce6b5903945bc2b55a565d6b1ab839a26a0fcefbfa620d033f');
});

test('version, installed package, bundle hash, or affected API drift requires a fresh review', async () => {
  const reviewedBundle = await readFile(path.join(root, 'node_modules/hyperframes/dist/cli.js'), 'utf8');
  const base = {
    packageLock: {
      packages: {
        'node_modules/hyperframes': { version: '0.8.33', dependencies: { 'adm-zip': '^0.6.0' } },
        'node_modules/adm-zip': { version: '0.6.0' },
      },
    },
    hyperframesPackage: { version: '0.8.33', dependencies: { 'adm-zip': '^0.6.0' } },
    admZipPackage: { version: '0.6.0' },
  };

  const packageDrifts = [
    { label: 'Locked HyperFrames', change: (input: typeof base) => { input.packageLock.packages['node_modules/hyperframes'].version = '0.8.34'; } },
    { label: 'Locked adm-zip', change: (input: typeof base) => { input.packageLock.packages['node_modules/adm-zip'].version = '0.5.18'; } },
    { label: 'Locked HyperFrames adm-zip dependency range', change: (input: typeof base) => { input.packageLock.packages['node_modules/hyperframes'].dependencies['adm-zip'] = '^0.5.18'; } },
    { label: 'Installed HyperFrames adm-zip dependency range', change: (input: typeof base) => { input.hyperframesPackage.dependencies['adm-zip'] = '^0.5.18'; } },
  ];
  for (const { label, change } of packageDrifts) {
    const input = structuredClone(base);
    change(input);
    const result = assessDependencyRisk({ ...input, hyperframesBundle: reviewedBundle });
    assert.equal(result.status, 'REVIEW_REQUIRED', label);
    assert.equal(result.reasons.some((reason) => reason.includes(label)), true, label);
    assert.deepEqual(result.detectedAffectedApiCalls, []);
  }

  for (const method of ['extractAllTo', 'extractAllToAsync', 'extractEntryTo']) {
    const result = assessDependencyRisk({ ...base, hyperframesBundle: `archive.${method}(target, true);` });
    assert.equal(result.status, 'REVIEW_REQUIRED');
    assert.deepEqual(result.detectedAffectedApiCalls, [method]);
  }

  const bracketCall = assessDependencyRisk({ ...base, hyperframesBundle: "archive['extractAllTo'](target, true);" });
  assert.equal(bracketCall.status, 'REVIEW_REQUIRED');
  assert.deepEqual(bracketCall.detectedAffectedApiCalls, ['extractAllTo']);

  const drifted = assessDependencyRisk({
    ...base,
    hyperframesPackage: { version: '0.8.34', dependencies: { 'adm-zip': '^0.6.0' } },
    hyperframesBundle: 'archive.getEntries();',
  });
  assert.equal(drifted.status, 'REVIEW_REQUIRED');
  assert.equal(drifted.reasons.some((reason) => reason.includes('version')), true);

  const installedDrift = assessDependencyRisk({
    ...base,
    admZipPackage: { version: '0.5.18' },
    hyperframesBundle: reviewedBundle,
  });
  assert.equal(installedDrift.status, 'REVIEW_REQUIRED');
  assert.equal(installedDrift.reasons.some((reason) => reason.includes('Installed adm-zip')), true);

  const hashOnlyDrift = assessDependencyRisk({
    ...base,
    hyperframesBundle: `${reviewedBundle}\n`,
  });
  assert.equal(hashOnlyDrift.status, 'REVIEW_REQUIRED');
  assert.deepEqual(hashOnlyDrift.detectedAffectedApiCalls, []);
  assert.equal(hashOnlyDrift.reasons.some((reason) => reason.includes('bundle hash')), true);
});
