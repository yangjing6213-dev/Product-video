import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';

import { assessDependencyRisk } from '../../scripts/check-dependency-risk.mjs';

const root = process.cwd();

test('the reviewed HyperFrames build does not call vulnerable adm-zip extraction APIs', async () => {
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const hyperframesPackage = JSON.parse(await readFile(path.join(root, 'node_modules/hyperframes/package.json'), 'utf8'));
  const admZipPackage = JSON.parse(await readFile(path.join(root, 'node_modules/adm-zip/package.json'), 'utf8'));
  const hyperframesBundle = await readFile(path.join(root, 'node_modules/hyperframes/dist/cli.js'), 'utf8');

  const result = assessDependencyRisk({ packageLock, hyperframesPackage, admZipPackage, hyperframesBundle });

  assert.equal(result.status, 'PASS_REVIEWED_PATCH');
  assert.equal(result.rawNpmAuditStatus, 'NOT_RUN');
  assert.deepEqual(result.detectedAffectedApiCalls, []);
  assert.deepEqual(result.reviewedVersions, { hyperframes: '0.8.33', admZip: '0.6.1' });
  assert.deepEqual(result.installedVersions, { hyperframes: '0.8.33', admZip: '0.6.1' });
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
        'node_modules/adm-zip': { version: '0.6.1' },
      },
    },
    hyperframesPackage: { version: '0.8.33', dependencies: { 'adm-zip': '^0.6.0' } },
    admZipPackage: { version: '0.6.1' },
  };

  const packageDrifts = [
    { label: 'Locked HyperFrames', change: (input: typeof base) => { input.packageLock.packages['node_modules/hyperframes'].version = '0.8.34'; } },
    { label: 'Locked adm-zip', change: (input: typeof base) => { input.packageLock.packages['node_modules/adm-zip'].version = '0.5.18'; } },
    { label: 'Locked adm-zip', change: (input: typeof base) => { input.packageLock.packages['node_modules/adm-zip'].version = '0.6.0'; } },
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

for (const method of ['extractAllTo', 'extractAllToAsync', 'extractEntryTo'] as const) {
  test(`installed adm-zip ${method} refuses a destination junction without overwriting the outside file`, async () => {
    const temporaryRoot = path.resolve(root, 'reports');
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(path.join(temporaryRoot, 'dependency-risk-fixture-'));
    const destination = path.join(fixture, 'destination');
    const outside = path.join(fixture, 'outside');
    const link = path.join(destination, 'linked');
    const sentinel = path.join(outside, 'sentinel.txt');
    let linked = false;
    try {
      await mkdir(destination);
      await mkdir(outside);
      await writeFile(sentinel, 'original fixture content');
      // Windows junctions exercise the same destination-link boundary without administrator privileges.
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      linked = true;
      const archive = new AdmZip();
      archive.addFile('linked/sentinel.txt', Buffer.from('replacement fixture content'));
      let rejected = false;
      try {
        if (method === 'extractAllToAsync') await archive.extractAllToAsync(destination, true);
        else if (method === 'extractEntryTo') archive.extractEntryTo('linked/sentinel.txt', destination, true, true);
        else archive.extractAllTo(destination, true);
      } catch {
        rejected = true;
      }
      assert.equal(await readFile(sentinel, 'utf8'), 'original fixture content');
      assert.equal(rejected, true, 'extraction must report rejection');

      await unlink(link);
      linked = false;
      if (method === 'extractAllToAsync') await archive.extractAllToAsync(destination, true);
      else if (method === 'extractEntryTo') assert.equal(archive.extractEntryTo('linked/sentinel.txt', destination, true, true), true);
      else archive.extractAllTo(destination, true);
      assert.equal(await readFile(path.join(destination, 'linked/sentinel.txt'), 'utf8'), 'replacement fixture content');
    } finally {
      // Unlink first so recursive fixture cleanup never follows the test's junction.
      if (linked) await unlink(link);
      const relative = path.relative(temporaryRoot, fixture);
      assert.equal(path.isAbsolute(relative) || relative.startsWith('..') || !relative.startsWith('dependency-risk-fixture-'), false);
      await rm(fixture, { recursive: true, force: true });
    }
  });
}
