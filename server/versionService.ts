import fs from 'node:fs';
import path from 'node:path';
import type { VersionCheckResult } from '../src/types/catalog';
import {
  compareSemver,
  extractLatestFromReleaseJson,
  normalizeGithubRepo,
  parseSemver,
} from '../src/utils/versionCheck';

export interface UpdateConfig {
  repo: string;
  checkOnStartup: boolean;
}

interface BuildInfoJson {
  version?: string;
  repo?: string;
  builtAt?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_APP_VERSION = '2.7.0';
const DEFAULT_GITHUB_REPO = 'johnzach199/DiscBase-Studio';

export class VersionService {
  private dataDir: string;
  private appRoot?: string;
  private configPath: string;
  private fetchFn: FetchLike;
  private cachedResult: VersionCheckResult | null = null;
  private cachedAtMs = 0;

  constructor(options?: { dataDir?: string; appRoot?: string; fetchFn?: FetchLike }) {
    this.dataDir = options?.dataDir || process.env.APP_DATA_DIR || path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.appRoot = options?.appRoot;
    this.configPath = path.join(this.dataDir, 'update-config.json');
    this.fetchFn = options?.fetchFn || fetch;
  }

  private resolveAppFile(relPath: string): string | null {
    const baseRoot = this.appRoot || process.env.APP_ROOT_DIR || '';
    const unpackedRoot = baseRoot.endsWith('app.asar')
      ? baseRoot.replace(/app\.asar$/, 'app.asar.unpacked')
      : '';
    const candidates = [
      unpackedRoot ? path.resolve(unpackedRoot, relPath) : '',
      this.appRoot ? path.resolve(this.appRoot, relPath) : '',
      process.env.APP_ROOT_DIR ? path.resolve(process.env.APP_ROOT_DIR, relPath) : '',
      typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..', relPath) : '',
      path.resolve(process.cwd(), relPath),
    ].filter(Boolean);

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  private readPackageJson(): { version?: string; repository?: unknown } {
    const pkgPath = this.resolveAppFile('package.json');
    if (!pkgPath) return {};
    try {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string; repository?: unknown };
    } catch {
      return {};
    }
  }

  private readBuildInfo(): BuildInfoJson {
    const infoPath = this.resolveAppFile('build-info.json');
    if (!infoPath) return {};
    try {
      return JSON.parse(fs.readFileSync(infoPath, 'utf-8')) as BuildInfoJson;
    } catch {
      return {};
    }
  }

  public getCurrentVersion(): string {
    const buildInfo = this.readBuildInfo();
    const buildVer = parseSemver(buildInfo.version);
    if (buildVer) return buildVer.normalized;

    const pkg = this.readPackageJson();
    const pkgVer = parseSemver(pkg.version);
    if (pkgVer) return pkgVer.normalized;

    return DEFAULT_APP_VERSION;
  }

  private resolveDefaultRepo(): string {
    const envRepo = normalizeGithubRepo(
      process.env.DISCBASE_UPDATE_REPO || process.env.GITHUB_REPOSITORY || ''
    );
    if (envRepo) return envRepo;

    const buildInfo = this.readBuildInfo();
    const buildRepo = normalizeGithubRepo(buildInfo.repo);
    if (buildRepo) return buildRepo;

    const pkg = this.readPackageJson();
    if (typeof pkg.repository === 'string') {
      const r = normalizeGithubRepo(pkg.repository);
      if (r) return r;
    } else if (pkg.repository && typeof pkg.repository === 'object') {
      const urlVal = (pkg.repository as { url?: unknown }).url;
      if (typeof urlVal === 'string') {
        const r = normalizeGithubRepo(urlVal);
        if (r) return r;
      }
    }
    return DEFAULT_GITHUB_REPO;
  }

  public getConfig(): UpdateConfig {
    const defaultRepo = this.resolveDefaultRepo();
    if (fs.existsSync(this.configPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<UpdateConfig>;
        const savedRepo = saved.repo !== undefined ? normalizeGithubRepo(saved.repo) || '' : defaultRepo;
        return {
          repo: savedRepo || defaultRepo,
          checkOnStartup: saved.checkOnStartup !== false,
        };
      } catch {
        return { repo: defaultRepo, checkOnStartup: true };
      }
    }
    return { repo: defaultRepo, checkOnStartup: true };
  }

  public saveConfig(input: { repo?: string; checkOnStartup?: boolean }): UpdateConfig {
    const prev = this.getConfig();
    let nextRepo = prev.repo;
    if (input.repo !== undefined) {
      const trimmed = input.repo.trim();
      if (!trimmed) {
        nextRepo = '';
      } else {
        const normalized = normalizeGithubRepo(trimmed);
        if (!normalized) {
          throw new Error('Invalid GitHub repository format. Use "owner/repo" or a valid https://github.com/owner/repo URL.');
        }
        nextRepo = normalized;
      }
    }

    const nextConfig: UpdateConfig = {
      repo: nextRepo,
      checkOnStartup: input.checkOnStartup !== undefined ? Boolean(input.checkOnStartup) : prev.checkOnStartup,
    };

    fs.writeFileSync(this.configPath, JSON.stringify(nextConfig, null, 2), 'utf-8');
    this.cachedResult = null;
    this.cachedAtMs = 0;
    return nextConfig;
  }

  public getVersionSummary(): {
    currentVersion: string;
    repo: string;
    checkOnStartup: boolean;
    cachedCheck: VersionCheckResult | null;
  } {
    const cfg = this.getConfig();
    return {
      currentVersion: this.getCurrentVersion(),
      repo: cfg.repo,
      checkOnStartup: cfg.checkOnStartup,
      cachedCheck: this.cachedResult,
    };
  }

  private async fetchJson(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }> {
    const res = await this.fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(6000),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  }

  public async checkLatestVersion(options?: { force?: boolean }): Promise<VersionCheckResult> {
    const currentVersion = this.getCurrentVersion();
    const cfg = this.getConfig();
    const nowIso = new Date().toISOString();

    // Support explicit override via env var for controlled offline/enterprise deployments
    const envLatest = parseSemver(process.env.DISCBASE_LATEST_VERSION_OVERRIDE || '');
    if (envLatest) {
      const isOutdated = compareSemver(envLatest.normalized, currentVersion) > 0;
      const result: VersionCheckResult = {
        currentVersion,
        latestVersion: envLatest.normalized,
        isOutdated,
        status: isOutdated ? 'outdated' : 'up-to-date',
        repo: cfg.repo,
        checkOnStartup: cfg.checkOnStartup,
        releaseName: `v${envLatest.normalized}`,
        releaseUrl: cfg.repo ? `https://github.com/${cfg.repo}/releases/latest` : undefined,
        checkedAt: nowIso,
      };
      this.cachedResult = result;
      this.cachedAtMs = Date.now();
      return result;
    }

    if (!cfg.repo) {
      return {
        currentVersion,
        latestVersion: null,
        isOutdated: false,
        status: 'unconfigured',
        repo: '',
        checkOnStartup: cfg.checkOnStartup,
        checkedAt: nowIso,
      };
    }

    if (
      !options?.force &&
      this.cachedResult &&
      this.cachedResult.repo === cfg.repo &&
      this.cachedResult.currentVersion === currentVersion &&
      Date.now() - this.cachedAtMs < CACHE_TTL_MS
    ) {
      return this.cachedResult;
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `DiscBase-Studio/${currentVersion}`,
    };

    try {
      // 1. Primary: GitHub Releases /latest
      const latestResp = await this.fetchJson(
        `https://api.github.com/repos/${cfg.repo}/releases/latest`,
        headers
      );

      if (latestResp.status >= 200 && latestResp.status < 300) {
        const parsed = extractLatestFromReleaseJson(latestResp.data, currentVersion, cfg.repo);
        if (parsed) {
          const result: VersionCheckResult = {
            currentVersion,
            latestVersion: parsed.latestVersion,
            isOutdated: parsed.isOutdated,
            status: parsed.isOutdated ? 'outdated' : 'up-to-date',
            repo: cfg.repo,
            checkOnStartup: cfg.checkOnStartup,
            releaseName: parsed.releaseName,
            releaseUrl: parsed.releaseUrl,
            publishedAt: parsed.publishedAt,
            releaseNotes: parsed.releaseNotes,
            assets: parsed.assets,
            checkedAt: nowIso,
          };
          this.cachedResult = result;
          this.cachedAtMs = Date.now();
          return result;
        }
      }

      // 2. Fallback if no /releases/latest: check recent /releases list
      if (latestResp.status === 404) {
        const listResp = await this.fetchJson(
          `https://api.github.com/repos/${cfg.repo}/releases?per_page=5`,
          headers
        );
        if (listResp.status >= 200 && listResp.status < 300 && Array.isArray(listResp.data)) {
          for (const rel of listResp.data) {
            if (rel && typeof rel === 'object' && (rel as Record<string, unknown>).draft) continue;
            const parsed = extractLatestFromReleaseJson(rel, currentVersion, cfg.repo);
            if (parsed) {
              const result: VersionCheckResult = {
                currentVersion,
                latestVersion: parsed.latestVersion,
                isOutdated: parsed.isOutdated,
                status: parsed.isOutdated ? 'outdated' : 'up-to-date',
                repo: cfg.repo,
                checkOnStartup: cfg.checkOnStartup,
                releaseName: parsed.releaseName,
                releaseUrl: parsed.releaseUrl,
                publishedAt: parsed.publishedAt,
                releaseNotes: parsed.releaseNotes,
                assets: parsed.assets,
                checkedAt: nowIso,
              };
              this.cachedResult = result;
              this.cachedAtMs = Date.now();
              return result;
            }
          }
        }

        // 3. Fallback: check Git tags
        const tagsResp = await this.fetchJson(
          `https://api.github.com/repos/${cfg.repo}/tags?per_page=5`,
          headers
        );
        if (tagsResp.status >= 200 && tagsResp.status < 300 && Array.isArray(tagsResp.data)) {
          let bestTag: string | null = null;
          for (const t of tagsResp.data) {
            if (!t || typeof t !== 'object') continue;
            const name = (t as Record<string, unknown>).name;
            const parsedTag = typeof name === 'string' ? parseSemver(name) : null;
            if (parsedTag && (!bestTag || compareSemver(parsedTag.normalized, bestTag) > 0)) {
              bestTag = parsedTag.normalized;
            }
          }
          if (bestTag) {
            const isOutdated = compareSemver(bestTag, currentVersion) > 0;
            const result: VersionCheckResult = {
              currentVersion,
              latestVersion: bestTag,
              isOutdated,
              status: isOutdated ? 'outdated' : 'up-to-date',
              repo: cfg.repo,
              checkOnStartup: cfg.checkOnStartup,
              releaseName: `v${bestTag}`,
              releaseUrl: `https://github.com/${cfg.repo}/releases`,
              checkedAt: nowIso,
            };
            this.cachedResult = result;
            this.cachedAtMs = Date.now();
            return result;
          }
        }
      }

      const apiMsg =
        latestResp.data && typeof latestResp.data === 'object' && typeof (latestResp.data as Record<string, unknown>).message === 'string'
          ? String((latestResp.data as Record<string, unknown>).message)
          : `GitHub API returned HTTP ${latestResp.status}`;

      return {
        currentVersion,
        latestVersion: null,
        isOutdated: false,
        status: 'error',
        repo: cfg.repo,
        checkOnStartup: cfg.checkOnStartup,
        checkedAt: nowIso,
        error: apiMsg,
      };
    } catch (err) {
      return {
        currentVersion,
        latestVersion: null,
        isOutdated: false,
        status: 'error',
        repo: cfg.repo,
        checkOnStartup: cfg.checkOnStartup,
        checkedAt: nowIso,
        error: err instanceof Error ? err.message : 'Unable to reach GitHub release server',
      };
    }
  }
}
