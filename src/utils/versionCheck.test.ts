import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareSemver,
  extractLatestFromReleaseJson,
  normalizeGithubRepo,
  parseSemver,
} from './versionCheck';
import { VersionService } from '../../server/versionService';

test('parseSemver and compareSemver handle v-prefixed, 2-part (v2.7), and prerelease tags', () => {
  assert.deepEqual(parseSemver('v2.7'), {
    major: 2,
    minor: 7,
    patch: 0,
    prerelease: '',
    normalized: '2.7.0',
  });
  assert.equal(compareSemver('v2.8', '2.7.0'), 1);
  assert.equal(compareSemver('v2.7', '2.7.0'), 0);
  assert.equal(compareSemver('v2.6', '2.7.0'), -1);
  assert.equal(compareSemver('2.7.0-beta.1', '2.7.0'), -1);
  assert.equal(compareSemver('2.7.0', '2.7.1'), -1);
});

test('normalizeGithubRepo validates owner/repo and GitHub URLs safely', () => {
  assert.equal(normalizeGithubRepo('johnzach199/DiscBase-Studio'), 'johnzach199/DiscBase-Studio');
  assert.equal(
    normalizeGithubRepo('https://github.com/johnzach199/DiscBase-Studio'),
    'johnzach199/DiscBase-Studio'
  );
  assert.equal(
    normalizeGithubRepo('https://github.com/johnzach199/DiscBase-Studio.git'),
    'johnzach199/DiscBase-Studio'
  );
  assert.equal(
    normalizeGithubRepo('git@github.com:johnzach199/DiscBase-Studio.git'),
    'johnzach199/DiscBase-Studio'
  );
  assert.equal(normalizeGithubRepo('https://evil.example.com/a/b'), null);
  assert.equal(normalizeGithubRepo('../etc/passwd'), null);
  assert.equal(normalizeGithubRepo('single-token'), null);
});

test('extractLatestFromReleaseJson parses release tag, URL, and assets', () => {
  const parsed = extractLatestFromReleaseJson(
    {
      tag_name: 'v2.8',
      name: 'DiscBase Studio v2.8',
      html_url: 'https://github.com/johnzach199/DiscBase-Studio/releases/tag/v2.8',
      assets: [
        {
          name: 'DiscBase-Studio-2.8.0.AppImage',
          browser_download_url:
            'https://github.com/johnzach199/DiscBase-Studio/releases/download/v2.8/DiscBase-Studio-2.8.0.AppImage',
          size: 123456,
        },
        {
          name: 'bad-asset',
          browser_download_url: 'javascript:alert(1)',
        },
      ],
    },
    '2.7.0',
    'johnzach199/DiscBase-Studio'
  );

  assert.ok(parsed);
  assert.equal(parsed.latestVersion, '2.8.0');
  assert.equal(parsed.isOutdated, true);
  assert.equal(parsed.releaseUrl, 'https://github.com/johnzach199/DiscBase-Studio/releases/tag/v2.8');
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0].name, 'DiscBase-Studio-2.8.0.AppImage');
});

test('VersionService defaults to johnzach199/DiscBase-Studio, detects outdated releases, and falls back to tags', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbase-version-test-'));
  const appDir = path.join(tmpDir, 'app');
  const dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ version: '2.7.0' }));

    // 0. Default repo falls back to johnzach199/DiscBase-Studio automatically
    const svcDefault = new VersionService({ dataDir, appRoot: appDir });
    assert.equal(svcDefault.getConfig().repo, 'johnzach199/DiscBase-Studio');
    assert.equal(svcDefault.getCurrentVersion(), '2.7.0');

    // 1. Mock newer GitHub Release v2.8 -> outdated = true
    let calls = 0;
    const svcOutdated = new VersionService({
      dataDir,
      appRoot: appDir,
      fetchFn: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            tag_name: 'v2.8',
            name: 'DiscBase Studio v2.8',
            html_url: 'https://github.com/johnzach199/DiscBase-Studio/releases/tag/v2.8',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const res1 = await svcOutdated.checkLatestVersion();
    assert.equal(res1.status, 'outdated');
    assert.equal(res1.isOutdated, true);
    assert.equal(res1.currentVersion, '2.7.0');
    assert.equal(res1.latestVersion, '2.8.0');
    assert.equal(res1.repo, 'johnzach199/DiscBase-Studio');
    assert.equal(calls, 1);

    // Cached second call does not re-fetch
    const resCached = await svcOutdated.checkLatestVersion();
    assert.equal(resCached.latestVersion, '2.8.0');
    assert.equal(calls, 1);

    // 2. Fallback to tags when /releases/latest returns 404 -> matching tag v2.7 => up-to-date
    const svcUpToDate = new VersionService({
      dataDir,
      appRoot: appDir,
      fetchFn: async (url) => {
        if (url.endsWith('/releases/latest')) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
        }
        if (url.includes('/releases?')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify([{ name: 'v2.7' }, { name: 'v2.6' }]), {
          status: 200,
        });
      },
    });

    const res2 = await svcUpToDate.checkLatestVersion({ force: true });
    assert.equal(res2.status, 'up-to-date');
    assert.equal(res2.isOutdated, false);
    assert.equal(res2.latestVersion, '2.7.0');

    // 3. Network error degrades cleanly without throwing
    const svcErr = new VersionService({
      dataDir,
      appRoot: appDir,
      fetchFn: async () => {
        throw new Error('Network offline');
      },
    });
    const resErr = await svcErr.checkLatestVersion({ force: true });
    assert.equal(resErr.status, 'error');
    assert.equal(resErr.isOutdated, false);
    assert.equal(resErr.error, 'Network offline');

    // 4. Invalid repository string throws cleanly on saveConfig
    assert.throws(() => svcErr.saveConfig({ repo: 'not a valid repo!' }));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
