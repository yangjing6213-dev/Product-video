export interface DependencyRiskInput {
  packageLock: {
    packages?: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };
  hyperframesPackage: {
    version?: string;
    dependencies?: Record<string, string>;
  };
  admZipPackage: {
    version?: string;
  };
  hyperframesBundle: string;
}

export interface DependencyRiskResult {
  advisory: string;
  status: 'PASS_WITH_DOCUMENTED_RISK' | 'REVIEW_REQUIRED';
  reviewedVersions: { hyperframes?: string; admZip?: string };
  installedVersions: { hyperframes?: string; admZip?: string };
  lockedDependencyRange?: string;
  installedDependencyRange?: string;
  bundleSha256: string;
  expectedBundleSha256: string;
  detectedAffectedApiCalls: string[];
  rawNpmAuditExpectedToPass: false;
  scope: string;
  reasons: string[];
}

export const REVIEWED_DEPENDENCY_RISK: Readonly<{
  advisory: string;
  hyperframesVersion: string;
  admZipVersion: string;
  admZipRange: string;
  hyperframesCliSha256: string;
  affectedApis: readonly string[];
}>;

export function assessDependencyRisk(input: DependencyRiskInput): DependencyRiskResult;
export function checkInstalledDependencyRisk(repositoryRoot?: string): Promise<DependencyRiskResult>;
