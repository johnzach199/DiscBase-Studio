import type { ReleaseAssetInfo } from '../types/catalog';
import { safeHttpUrl } from './catalogMath';

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
  normalized: string;
}

export function parseSemver(raw: string | null | undefined): ParsedSemver | null {
  const cleaned = (raw || '').trim().replace(/^v/i, '');
  if (!cleaned) return null;

  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? '0');
  const patch = Number(match[3] ?? '0');
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  const prerelease = match[4] ? match[4].trim() : '';
  const base = `${major}.${minor}.${patch}`;
  return {
    major,
    minor,
    patch,
    prerelease,
    normalized: prerelease ? `${base}-${prerelease}` : base,
  };
}

/**
 * Compares two version strings (e.g. "2.0.0" vs "v2.0.14").
 * Returns 1 if a > b, -1 if a < b, 0 if equal or either is unparseable.
 */
export function compareSemver(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (pa.prerelease && pb.prerelease && pa.prerelease !== pb.prerelease) {
    return pa.prerelease > pb.prerelease ? 1 : -1;
  }
  return 0;
}

export function normalizeGithubRepo(input: string | null | undefined): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  let pathPart = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.hostname.toLowerCase() !== 'github.com' && url.hostname.toLowerCase() !== 'www.github.com') {
        return null;
      }
      pathPart = url.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      return null;
    }
  } else if (/^git@github\.com:/i.test(raw)) {
    pathPart = raw.replace(/^git@github\.com:/i, '');
  }

  pathPart = pathPart.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1];
  const validSegment = /^[A-Za-z0-9_.-]+$/;
  if (!validSegment.test(owner) || !validSegment.test(repo) || owner === '..' || repo === '..') {
    return null;
  }
  return `${owner}/${repo}`;
}

export function extractLatestFromReleaseJson(
  payload: unknown,
  currentVersion: string,
  repo: string
): {
  latestVersion: string;
  isOutdated: boolean;
  releaseName?: string;
  releaseUrl: string;
  publishedAt?: string;
  releaseNotes?: string;
  assets: ReleaseAssetInfo[];
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const rawTag = typeof obj.tag_name === 'string' ? obj.tag_name : typeof obj.name === 'string' ? obj.name : '';
  const parsed = parseSemver(rawTag) || (typeof obj.name === 'string' ? parseSemver(obj.name) : null);
  if (!parsed) return null;

  const fallbackUrl = `https://github.com/${repo}/releases/latest`;
  const releaseUrl =
    (typeof obj.html_url === 'string' ? safeHttpUrl(obj.html_url) : null) || fallbackUrl;

  const assets: ReleaseAssetInfo[] = [];
  if (Array.isArray(obj.assets)) {
    for (const item of obj.assets) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Record<string, unknown>;
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      const dl = typeof a.browser_download_url === 'string' ? safeHttpUrl(a.browser_download_url) : null;
      if (name && dl) {
        assets.push({
          name,
          downloadUrl: dl,
          size: typeof a.size === 'number' ? a.size : undefined,
        });
      }
    }
  }

  return {
    latestVersion: parsed.normalized,
    isOutdated: compareSemver(parsed.normalized, currentVersion) > 0,
    releaseName: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `v${parsed.normalized}`,
    releaseUrl,
    publishedAt: typeof obj.published_at === 'string' ? obj.published_at : undefined,
    releaseNotes: typeof obj.body === 'string' ? obj.body.slice(0, 1200) : undefined,
    assets,
  };
}
