// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCoverPlayer } from '../../src/quality/cover.ts';

test('player shows the cover before playing, without autoplay, and keeps local Chinese paths', () => {
  const html = renderCoverPlayer('产品视频 <审阅>', '视频 62秒.mp4', '封面 v1.png');
  assert.match(html, /poster="封面 v1\.png"/);
  assert.match(html, /src="视频 62秒\.mp4"/);
  assert.match(html, /controls/);
  assert.match(html, /preload="none"/);
  assert.doesNotMatch(html, /autoplay/);
  assert.match(html, /产品视频 &lt;审阅&gt;/);
});

test('player does not interpret titles and filenames as HTML', () => {
  const html = renderCoverPlayer('<script>alert(1)</script>', 'video" onerror="x.mp4', 'cover&new.png');
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /src="video" onerror/);
  assert.match(html, /cover&amp;new\.png/);
});
