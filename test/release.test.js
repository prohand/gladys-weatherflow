import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-weatherflow';

test('the Unreleased section moves under the new version', () => {
  const before = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Something.',
    '',
    `[Unreleased]: ${REPO}/commits/main`,
    '',
  ].join('\n');
  const after = rollChangelog(before, '1.0.0', '2026-10-16');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-16\n\n### Added\n\n- Something\./,
  );
  assert.match(after, /\[Unreleased\]: .*\/compare\/v1\.0\.0\.\.\.HEAD/);
  assert.match(after, /\[1\.0\.0\]: .*\/releases\/tag\/v1\.0\.0/);
});

test('a version already present is left alone', () => {
  const text = '## [Unreleased]\n\n## [1.0.0] - 2026-10-16\n';
  assert.equal(rollChangelog(text, '1.0.0', '2026-10-17'), text);
});

test('an empty Unreleased section still writes the version', () => {
  const after = rollChangelog('## [Unreleased]\n', '1.0.1', '2026-10-17');
  assert.match(after, /## \[1\.0\.1\] - 2026-10-17\n\n- Maintenance release/);
});
