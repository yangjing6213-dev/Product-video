import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REVIEWED_DEPENDENCY_RISK = Object.freeze({
  advisory: 'GHSA-vwc7-r8mq-g2x9',
  hyperframesVersion: '0.8.33',
  admZipVersion: '0.6.0',
  admZipRange: '^0.6.0',
  hyperframesCliSha256: 'af57f08331c602ce6b5903945bc2b55a565d6b1ab839a26a0fcefbfa620d033f',
  affectedApis: ['extractAllTo', 'extractAllToAsync', 'extractEntryTo'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assessDependencyRisk({ packageLock, hyperframesPackage, admZipPackage, hyperframesBundle }) {
  const hyperframes = packageLock?.packages?.['node_modules/hyperframes']?.version;
  const admZip = packageLock?.packages?.['node_modules/adm-zip']?.version;
  const installedHyperframes = hyperframesPackage?.version;
  const installedAdmZip = admZipPackage?.version;
  const lockedDependencyRange = packageLock?.packages?.['node_modules/hyperframes']?.dependencies?.['adm-zip'];
  const installedDependencyRange = hyperframesPackage?.dependencies?.['adm-zip'];
  const bundleSha256 = sha256(hyperframesBundle);
  const detectedAffectedApiCalls = REVIEWED_DEPENDENCY_RISK.affectedApis.filter((method) => {
    const memberCall = new RegExp(`\\.${method}\\s*\\(`);
    const bracketCall = new RegExp(`\\[\\s*['\"]${method}['\"]\\s*\\]\\s*\\(`);
    return memberCall.test(hyperframesBundle) || bracketCall.test(hyperframesBundle);
  });
  const reasons = [];

  if (hyperframes !== REVIEWED_DEPENDENCY_RISK.hyperframesVersion) {
    reasons.push('Locked HyperFrames version differs from the reviewed version');
  }
  if (installedHyperframes !== REVIEWED_DEPENDENCY_RISK.hyperframesVersion) {
    reasons.push('Installed HyperFrames version differs from the reviewed version');
  }
  if (admZip !== REVIEWED_DEPENDENCY_RISK.admZipVersion) {
    reasons.push('Locked adm-zip version differs from the reviewed version');
  }
  if (installedAdmZip !== REVIEWED_DEPENDENCY_RISK.admZipVersion) {
    reasons.push('Installed adm-zip version differs from the reviewed version');
  }
  if (lockedDependencyRange !== REVIEWED_DEPENDENCY_RISK.admZipRange) {
    reasons.push('Locked HyperFrames adm-zip dependency range differs from the reviewed range');
  }
  if (installedDependencyRange !== REVIEWED_DEPENDENCY_RISK.admZipRange) {
    reasons.push('Installed HyperFrames adm-zip dependency range differs from the reviewed range');
  }
  if (bundleSha256 !== REVIEWED_DEPENDENCY_RISK.hyperframesCliSha256) {
    reasons.push('HyperFrames CLI bundle hash differs from the reviewed artifact');
  }
  if (detectedAffectedApiCalls.length) {
    reasons.push('HyperFrames CLI bundle contains an affected adm-zip extraction API call');
  }

  return {
    advisory: REVIEWED_DEPENDENCY_RISK.advisory,
    status: reasons.length ? 'REVIEW_REQUIRED' : 'PASS_WITH_DOCUMENTED_RISK',
    reviewedVersions: { hyperframes, admZip },
    installedVersions: { hyperframes: installedHyperframes, admZip: installedAdmZip },
    lockedDependencyRange,
    installedDependencyRange,
    bundleSha256,
    expectedBundleSha256: REVIEWED_DEPENDENCY_RISK.hyperframesCliSha256,
    detectedAffectedApiCalls,
    rawNpmAuditExpectedToPass: false,
    scope: 'Evidence-consistency gate only; not a runtime sandbox or vulnerability fix.',
    reasons,
  };
}

export async function checkInstalledDependencyRisk(repositoryRoot = process.cwd()) {
  const [packageLockText, hyperframesPackageText, admZipPackageText, hyperframesBundle] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'node_modules/hyperframes/package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'node_modules/adm-zip/package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'node_modules/hyperframes/dist/cli.js'), 'utf8'),
  ]);
  return assessDependencyRisk({
    packageLock: JSON.parse(packageLockText),
    hyperframesPackage: JSON.parse(hyperframesPackageText),
    admZipPackage: JSON.parse(admZipPackageText),
    hyperframesBundle,
  });
}

async function main() {
  const result = await checkInstalledDependencyRisk();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS_WITH_DOCUMENTED_RISK') process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
