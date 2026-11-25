import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FolderOpen,
  HardDrive,
  PlugZap,
  RefreshCw,
  Tag,
  Terminal,
  Upload,
} from 'lucide-react';
import type { DbStatus, MysqlConfig, VersionCheckResult } from '../types/catalog';
import { safeHttpUrl } from '../utils/catalogMath';
import { compareSemver } from '../utils/versionCheck';

interface MysqlSettingsProps {
  dbStatus: DbStatus | null;
  currentVersion: string;
  versionInfo: VersionCheckResult | null;
  checkingVersion: boolean;
  onCheckVersion: (force?: boolean) => Promise<void>;
  onVersionUpdated: (info: VersionCheckResult) => void;
  onStatusUpdated: (status: DbStatus) => Promise<void>;
}

export const MysqlSettings: React.FC<MysqlSettingsProps> = ({
  dbStatus,
  currentVersion,
  versionInfo,
  checkingVersion,
  onCheckVersion,
  onVersionUpdated,
  onStatusUpdated,
}) => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopEnv?.isDesktop);
  const sqliteFileInputRef = useRef<HTMLInputElement | null>(null);

  const [sqlitePath, setSqlitePath] = useState('data/discbase_catalog.sqlite');
  const [connectingSqlite, setConnectingSqlite] = useState(false);
  const [uploadingSqlite, setUploadingSqlite] = useState(false);

  const [form, setForm] = useState<MysqlConfig>({
    host: '127.0.0.1',
    port: 3306,
    database: 'discbase_catalog',
    user: 'root',
    password: '',
    ssl: false,
    autoConnect: true,
  });
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [mysqlSchemaSql, setMysqlSchemaSql] = useState('');
  const [sqliteSchemaSql, setSqliteSchemaSql] = useState('');
  const [activeSchemaTab, setActiveSchemaTab] = useState<'sqlite' | 'mysql'>('sqlite');
  const [workflowYml, setWorkflowYml] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedYml, setCopiedYml] = useState(false);
  const [releaseRepo, setReleaseRepo] = useState('');
  const [checkOnStartup, setCheckOnStartup] = useState(true);
  const [savingVersionCfg, setSavingVersionCfg] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [statusRes, schemaRes, ymlRes, versionRes] = await Promise.all([
          fetch('/api/db/status'),
          fetch('/api/db/schema'),
          fetch('/api/export/github-yml'),
          fetch('/api/version'),
        ]);
        if (statusRes.ok) {
          const data = await statusRes.json();
          if (data.sqliteConfig?.filePath) {
            setSqlitePath(data.sqliteConfig.filePath);
          }
          if (data.config) {
            setForm((prev) => ({
              ...prev,
              host: data.config.host || '127.0.0.1',
              port: data.config.port || 3306,
              database: data.config.database || 'discbase_catalog',
              user: data.config.user || '',
              ssl: Boolean(data.config.ssl),
              autoConnect: data.config.autoConnect !== false,
              password: '',
            }));
            setHasExistingPassword(Boolean(data.config.hasPassword));
          }
        }
        if (schemaRes.ok) {
          const sData = await schemaRes.json();
          setMysqlSchemaSql(sData.sql || '');
          setSqliteSchemaSql(sData.sqliteSql || '');
        }
        if (ymlRes.ok) {
          const yData = await ymlRes.json();
          setWorkflowYml(yData.workflowYml || '');
        }
        if (versionRes.ok) {
          const vData = (await versionRes.json()) as {
            repo?: string;
            checkOnStartup?: boolean;
          };
          setReleaseRepo(vData.repo || '');
          setCheckOnStartup(vData.checkOnStartup !== false);
        }
      } catch {
        // Ignore initial load error
      }
    })();
  }, []);

  const handleSaveVersionConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingVersionCfg(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/version/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: releaseRepo,
          checkOnStartup,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save version settings');
      if (data.config?.repo !== undefined) setReleaseRepo(data.config.repo);
      if (data.checkResult) {
        onVersionUpdated(data.checkResult as VersionCheckResult);
        const r = data.checkResult as VersionCheckResult;
        if (r.isOutdated && r.latestVersion) {
          setFeedback({
            ok: false,
            text: `Update available: DiscBase Studio v${r.latestVersion} is released (installed: v${r.currentVersion}).`,
          });
        } else if (r.status === 'up-to-date') {
          setFeedback({
            ok: true,
            text: `DiscBase Studio v${r.currentVersion} is up to date.`,
          });
        } else if (r.status === 'error') {
          setFeedback({
            ok: false,
            text: `Saved repository, but update check failed: ${r.error || 'Unable to contact GitHub'}`,
          });
        } else {
          setFeedback({ ok: true, text: 'Update check settings saved.' });
        }
      }
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : 'Unable to save update settings' });
    } finally {
      setSavingVersionCfg(false);
    }
  };

  const payloadPassword = () => {
    if (form.password) return form.password;
    return hasExistingPassword ? '__KEEP_EXISTING__' : '';
  };

  const handleSqliteConnect = async (targetPath?: string) => {
    const pathToUse = (targetPath ?? sqlitePath).trim();
    if (!pathToUse) {
      setFeedback({ ok: false, text: 'Enter a valid SQLite file path (.sqlite or .db).' });
      return;
    }
    setConnectingSqlite(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/db/sqlite/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: pathToUse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to open SQLite database');
      if (data.sqliteConfig?.filePath) {
        setSqlitePath(data.sqliteConfig.filePath);
      }
      await onStatusUpdated(data.status);
      setFeedback({
        ok: true,
        text: `Active database switched to SQLite 3 (${data.status.sqlitePath}).`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'SQLite connection failed',
      });
    } finally {
      setConnectingSqlite(false);
    }
  };

  const handleDesktopPickSqlite = async (mode: 'open' | 'save') => {
    if (!window.desktopEnv?.pickSqliteFile) return;
    const picked = await window.desktopEnv.pickSqliteFile({
      mode,
      defaultPath: sqlitePath,
    });
    if (picked) {
      setSqlitePath(picked);
      await handleSqliteConnect(picked);
    }
  };

  const handleUploadSqliteFile = async (file: File) => {
    setUploadingSqlite(true);
    setFeedback(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const res = await fetch('/api/db/sqlite/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, filename: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load SQLite file');
      if (data.sqliteConfig?.filePath) {
        setSqlitePath(data.sqliteConfig.filePath);
      }
      await onStatusUpdated(data.status);
      setFeedback({
        ok: true,
        text: `Loaded SQLite database "${file.name}" (${data.status.albumCount} albums, ${data.status.songCount} songs).`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to open SQLite file',
      });
    } finally {
      setUploadingSqlite(false);
    }
  };

  const handleDownloadSqliteFile = () => {
    const link = document.createElement('a');
    link.href = '/api/db/sqlite/download';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleTest = async () => {
    if (!form.host.trim() || !form.user.trim()) {
      setFeedback({
        ok: false,
        text: 'Please enter both Host / Server IP and Username before testing the MySQL connection.',
      });
      return;
    }
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/db/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: payloadPassword() }),
      });
      const data = await res.json();
      if (data.ok) {
        setFeedback({
          ok: true,
          text: `Connection succeeded (${data.version || 'MySQL Server'}). Click "Save & Auto-Connect" to activate and initialize tables.`,
        });
      } else {
        setFeedback({
          ok: false,
          text: data.error || 'Unable to connect to MySQL Server.',
        });
      }
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Network error testing connection',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/db/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: payloadPassword() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      await onStatusUpdated(data.status);
      if (data.status?.mode === 'mysql' && data.status?.connected) {
        setFeedback({
          ok: true,
          text: `Connected automatically to MySQL (${data.status.host}/${data.status.database}) and verified schema tables.`,
        });
      } else {
        setFeedback({
          ok: false,
          text: `Credentials saved, but MySQL could not be reached yet: ${data.status?.error || 'Connection refused'}. App stays operational in SQLite mode until the server is reachable.`,
        });
      }
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchToSqlite = async () => {
    setFeedback(null);
    try {
      const res = await fetch('/api/db/disconnect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Switch failed');
      await onStatusUpdated(data.status);
      setFeedback({
        ok: true,
        text: `Switched active storage to SQLite 3 (${data.status.sqlitePath}).`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to switch to SQLite',
      });
    }
  };

  const handleSyncLocal = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/db/sync-local-to-mysql', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      await onStatusUpdated(data.status);
      setFeedback({
        ok: true,
        text: `Synced SQLite records to MySQL: ${data.result.imported} imported, ${data.result.skipped} already present.`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setSyncing(false);
    }
  };

  const activeSchemaText = activeSchemaTab === 'sqlite' ? sqliteSchemaSql : mysqlSchemaSql;

  const handleCopySql = async () => {
    if (!activeSchemaText) return;
    await navigator.clipboard.writeText(activeSchemaText);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleCopyYml = async () => {
    if (!workflowYml) return;
    await navigator.clipboard.writeText(workflowYml);
    setCopiedYml(true);
    setTimeout(() => setCopiedYml(false), 2000);
  };

  const handleDownloadGithubZip = () => {
    const link = document.createElement('a');
    link.href = '/api/export/github-bundle';
    link.download = 'discbase-studio-github.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadYmlFile = () => {
    if (!workflowYml) return;
    const blob = new Blob([workflowYml], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'build-desktop.yml';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          SQLite, MySQL &amp; Desktop Packaging
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Run locally on a portable SQLite 3 (.sqlite / .db) database file, auto-connect to MySQL Server, and download the GitHub source &amp; YML bundle.
        </p>
      </div>

      {/* Active Connection Status Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Database
            className={`w-5 h-5 mt-0.5 shrink-0 ${
              dbStatus?.mode === 'mysql' || dbStatus?.mode === 'sqlite'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">
              {dbStatus?.mode === 'mysql'
                ? `Connected to MySQL Server (${dbStatus.host}:${dbStatus.port}/${dbStatus.database})`
                : dbStatus?.mode === 'sqlite'
                ? `Connected to SQLite 3 Database (${dbStatus.sqlitePath || sqlitePath})`
                : 'Running on Local Preview Store'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {dbStatus?.mode === 'mysql'
                ? 'All manual entries and XLSX imports read and write directly to your MySQL database.'
                : dbStatus?.mode === 'sqlite'
                ? `All albums (${dbStatus.albumCount}) and songs (${dbStatus.songCount}) are stored in a real SQLite 3 database file with full foreign-key integrity.`
                : dbStatus?.error
                ? `Last connection attempt: ${dbStatus.error}`
                : 'Select a SQLite database file or enter MySQL Server credentials below.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {dbStatus?.mode === 'sqlite' && (
            <button
              type="button"
              onClick={handleDownloadSqliteFile}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .sqlite Backup</span>
            </button>
          )}
          {dbStatus?.mode === 'mysql' && (
            <>
              <button
                type="button"
                onClick={handleSwitchToSqlite}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Switch to SQLite</span>
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={handleSyncLocal}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>{syncing ? 'Syncing...' : 'Push SQLite Records to MySQL'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.ok ? 'status' : 'alert'}
          className={`flex items-center gap-2 px-4 py-3 text-sm rounded-lg border ${
            feedback.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: SQLite + MySQL Configuration */}
        <div className="lg:col-span-6 space-y-6">
          {/* SQLite 3 Local Database Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  SQLite 3 Local Database (.sqlite / .db)
                </h2>
              </div>
              {dbStatus?.mode === 'sqlite' && (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Active
                </span>
              )}
            </div>

            <div>
              <label htmlFor="sqlite-path" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                SQLite Database File Path
              </label>
              <input
                id="sqlite-path"
                type="text"
                value={sqlitePath}
                onChange={(e) => setSqlitePath(e.target.value)}
                placeholder="data/discbase_catalog.sqlite"
                className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Opens an existing SQLite file or creates a new one automatically with the DiscBase catalog schema.
              </p>
            </div>

            <input
              ref={sqliteFileInputRef}
              type="file"
              accept=".sqlite,.db,.sqlite3"
              aria-label="Open SQLite file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadSqliteFile(file);
                e.target.value = '';
              }}
            />

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={connectingSqlite}
                onClick={() => void handleSqliteConnect()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 rounded-lg cursor-pointer"
              >
                <PlugZap className="w-4 h-4" />
                <span>{connectingSqlite ? 'Opening...' : 'Use SQLite File'}</span>
              </button>

              {isDesktop && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleDesktopPickSqlite('open')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Browse .sqlite...</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDesktopPickSqlite('save')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>New .sqlite File...</span>
                  </button>
                </>
              )}

              <button
                type="button"
                disabled={uploadingSqlite}
                onClick={() => sqliteFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingSqlite ? 'Importing...' : 'Import .sqlite / .db'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadSqliteFile}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .sqlite</span>
              </button>
            </div>
          </div>

          {/* MySQL Credentials Form */}
          <form
            onSubmit={handleSaveAndConnect}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                MySQL Auto-Connect Credentials (Optional Remote DB)
              </h2>
              {dbStatus?.mode === 'mysql' && (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Active
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="mysql-host" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Host / Server IP
                </label>
                <input
                  id="mysql-host"
                  type="text"
                  required
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="127.0.0.1 or 192.168.1.50"
                  className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label htmlFor="mysql-port" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Port
                </label>
                <input
                  id="mysql-port"
                  type="number"
                  required
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="mysql-database" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Database Name (Auto-created if missing)
              </label>
              <input
                id="mysql-database"
                type="text"
                required
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
                placeholder="discbase_catalog"
                className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="mysql-user" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Username
                </label>
                <input
                  id="mysql-user"
                  type="text"
                  required
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                  placeholder="discbase_user"
                  className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label htmlFor="mysql-password" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password {hasExistingPassword ? '(saved)' : ''}
                </label>
                <input
                  id="mysql-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={hasExistingPassword ? '•••••••• (unchanged)' : 'Enter password'}
                  className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoConnect}
                  onChange={(e) => setForm({ ...form, autoConnect: e.target.checked })}
                  className="w-4 h-4 accent-blue-700"
                />
                <span>Connect automatically to MySQL when application starts</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.ssl}
                  onChange={(e) => setForm({ ...form, ssl: e.target.checked })}
                  className="w-4 h-4 accent-blue-700"
                />
                <span>Use SSL/TLS encrypted connection</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={testing}
                onClick={handleTest}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? 'Testing...' : 'Test Connection'}</span>
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                <PlugZap className="w-4 h-4" />
                <span>{saving ? 'Connecting...' : 'Save & Auto-Connect'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: App Updates, Desktop Packaging & Database Schemas */}
        <div className="lg:col-span-6 space-y-6">
          {/* App Version & Release Updates Card */}
          <form
            onSubmit={handleSaveVersionConfig}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  App Version &amp; Release Updates
                </h2>
              </div>
              <span className="px-2 py-0.5 text-xs font-mono-tabular font-semibold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                Installed: v{currentVersion}
              </span>
            </div>

            {versionInfo?.isOutdated && versionInfo.latestVersion ? (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-100">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    Newer version <strong>v{versionInfo.latestVersion}</strong> is available (running{' '}
                    <strong>v{versionInfo.currentVersion}</strong>).
                  </span>
                </div>
                {safeHttpUrl(versionInfo.releaseUrl) && (
                  <a
                    href={safeHttpUrl(versionInfo.releaseUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-slate-950 rounded transition-colors"
                  >
                    <span>Download Release</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ) : versionInfo?.status === 'up-to-date' ? (
              <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {versionInfo.latestVersion &&
                  compareSemver(versionInfo.currentVersion || currentVersion, versionInfo.latestVersion) > 0 ? (
                    <>
                      Up to date: running <strong>v{versionInfo.currentVersion || currentVersion}</strong> (latest GitHub release:{' '}
                      <strong>v{versionInfo.latestVersion}</strong>).
                    </>
                  ) : (
                    <>
                      You are running the latest version (<strong>v{versionInfo.latestVersion || currentVersion}</strong>).
                    </>
                  )}
                </span>
              </div>
            ) : versionInfo?.status === 'error' ? (
              <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                <span>Update check failed: {versionInfo.error || 'Network unavailable'}</span>
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                GitHub Releases builds configure the release repository automatically. For local or web setups, enter your GitHub repository below to enable automatic update warnings.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-8">
                <label htmlFor="release-repo" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  GitHub Repository (<span className="font-mono-tabular">owner/repo</span>)
                </label>
                <input
                  id="release-repo"
                  type="text"
                  value={releaseRepo}
                  onChange={(e) => setReleaseRepo(e.target.value)}
                  placeholder="johnzach199/DiscBase-Studio"
                  className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="sm:col-span-4 pb-1.5">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkOnStartup}
                    onChange={(e) => setCheckOnStartup(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Check on startup</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={savingVersionCfg}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                <span>{savingVersionCfg ? 'Saving & Checking...' : 'Save & Check Updates'}</span>
              </button>
              <button
                type="button"
                disabled={checkingVersion}
                onClick={() => void onCheckVersion(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingVersion ? 'animate-spin' : ''}`} />
                <span>{checkingVersion ? 'Checking...' : 'Check Now'}</span>
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  GitHub Source &amp; Desktop Executables
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadYmlFile}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>build-desktop.yml</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadGithubZip}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileArchive className="w-3.5 h-3.5" />
                  <span>Download Source (.zip)</span>
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Download the complete GitHub repository archive (<code className="font-mono-tabular bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">discbase-studio-github.zip</code>) containing all source files,{' '}
              <code className="font-mono-tabular bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">electron/</code>,{' '}
              <code className="font-mono-tabular bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">electron-builder.yml</code>, and{' '}
              <code className="font-mono-tabular bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">.github/workflows/build-desktop.yml</code>.
            </p>
            <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5 list-disc list-inside">
              <li>
                <strong>Fedora / Linux:</strong> <code className="font-mono-tabular">.AppImage</code> (published directly to GitHub Releases)
              </li>
              <li>
                <strong>macOS:</strong> <code className="font-mono-tabular">.dmg</code> (uncompressed disk image)
              </li>
              <li>
                <strong>Windows:</strong> <code className="font-mono-tabular">.exe</code> standalone executable
              </li>
            </ul>
            {workflowYml && (
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    .github/workflows/build-desktop.yml
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyYml}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedYml ? 'Copied' : 'Copy YML'}</span>
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 dark:bg-slate-950 text-slate-100 border border-slate-800 rounded-md text-[11px] font-mono-tabular overflow-auto max-h-44 leading-relaxed">
                  {workflowYml}
                </pre>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Database Schema
                </h2>
                <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveSchemaTab('sqlite')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      activeSchemaTab === 'sqlite'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    SQLite 3
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSchemaTab('mysql')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      activeSchemaTab === 'mysql'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    MySQL
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
              </button>
            </div>
            <pre className="p-3.5 bg-slate-900 dark:bg-slate-950 text-slate-100 border border-slate-800 rounded-md text-[11px] font-mono-tabular overflow-auto max-h-64 leading-relaxed">
              {activeSchemaText || '-- Loading schema...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
