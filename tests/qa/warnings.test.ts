import test from 'node:test';
import assert from 'node:assert/strict';
import { warningChecks } from '../../src/qa/warnings.ts';

const finding = { code: 'duplicate_media_discovery_risk', severity: 'warning', message: '2 repeated images', snippet: 'img src=assets/logo.png', file: 'index.html' };
test('unreviewed exit-zero lint warning blocks QA', () => {
  assert.equal(warningChecks('lint', [finding], [])[0]?.status, 'FAIL');
});
test('only the exact warning with a specific explanation is accepted', () => {
  const review = { ...finding, explanation: 'Scene 01 and 06 intentionally reuse the same static brand logo; both clips and final frames were checked.' };
  assert.equal(warningChecks('lint', [finding], [review])[0]?.status, 'PASS');
  assert.equal(warningChecks('lint', [{ ...finding, message: '3 repeated images' }], [review])[0]?.status, 'FAIL');
  assert.equal(warningChecks('lint', [finding], [{ ...review, explanation: '' }])[0]?.status, 'FAIL');
});
test('a review cannot bypass an actual error', () => {
  const error = { ...finding, severity: 'error' };
  assert.equal(warningChecks('inspect', [error], [{ ...error, explanation: 'Not allowed' }])[0]?.status, 'FAIL');
});
test('a review is consumed once and does not match a different file', () => {
  const review = { ...finding, explanation: 'The two known parent clips intentionally reuse this static brand logo.' };
  assert.deepEqual(warningChecks('lint', [finding, finding], [review]).map(c => c.status), ['PASS', 'FAIL']);
  assert.equal(warningChecks('lint', [{ ...finding, file: 'compositions/extra.html' }], [review])[0]?.status, 'FAIL');
});
