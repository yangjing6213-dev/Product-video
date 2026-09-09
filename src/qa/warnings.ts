import type { CheckResult } from '../contracts.ts';

export interface CliFinding { code?: string; severity?: string; message?: string; snippet?: string; file?: string }
export interface WarningReview extends CliFinding { explanation: string }

export function warningChecks(label: string, findings: CliFinding[], reviews: WarningReview[]): CheckResult[] {
  const usedReviews = new Set<number>();
  return findings.filter(f => ['warning', 'error'].includes(f.severity ?? '')).map((finding, index) => {
    const match = finding.severity === 'warning' ? reviews.findIndex((r, i) =>
      !usedReviews.has(i) && r.file === finding.file && r.severity === finding.severity &&
      r.code === finding.code && r.message === finding.message && r.snippet === finding.snippet && r.explanation.trim().length >= 20) : -1;
    const review = match >= 0 ? reviews[match] : undefined;
    if (review) usedReviews.add(match);
    return {
      id: `hyperframes-${label}.warning.${index + 1}`,
      status: review ? 'PASS' : 'FAIL',
      message: `${finding.code}: ${finding.message}; ${review ? `REVIEWED: ${review.explanation}` : 'Requires repair or an exact reviewed explanation'}`,
    };
  });
}
