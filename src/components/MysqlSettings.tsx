import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileArchive,
  PlugZap,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import type { DbStatus, MysqlConfig } from '../types/catalog';
import { ThemeToggle, type ThemeMode } from './ThemeToggle';

interface MysqlSettingsProps {
  dbStatus: DbStatus | null;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onStatusUpdated: (status: DbStatus) => Promise<void>;
}

export const MysqlSettings: React.FC<MysqlSettingsProps> = ({
  dbStatus,
  theme,
  onThemeChange,
  onStatusUpdated,
}) => {
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
  const [schemaSql, setSchemaSql] = useState('');
  const [workflowYml, setWorkflowYml] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedYml, setCopiedYml] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [statusRes, schemaRes, ymlRes] = await Promise.all([
          fetch('/api/db/status'),
          fetch('/api/db/schema'),
          fetch('/api/export/github-yml'),
        ]);
        if (statusRes.ok) {
          const data = await statusRes.json();
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
          setSchemaSql(sData.sql || '');
        }
        if (ymlRes.ok) {
          const yData = await ymlRes.json();
          setWorkflowYml(yData.workflowYml || '');
        }
      } catch {
        // Ignore initial load error
      }
    })();
  }, []);

  const payloadPassword = () => {
    if (form.password) return form.password;
    return hasExistingPassword ? '__KEEP_EXISTING__' : '';
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
          text: `Credentials saved, but MySQL could not be reached yet: ${data.status?.error || 'Connection refused'}. App stays operational in Local Store mode until the server is reachable.`,
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
        text: `Synced local records to MySQL: ${data.result.imported} imported, ${data.result.skipped} already present.`,
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

  const handleCopySql = async () => {
    if (!schemaSql) return;
    await navigator.clipboard.writeText(schemaSql);
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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            MySQL Server &amp; Desktop Packaging
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Configure automatic MySQL Server connection credentials, switch appearance, and download the GitHub source &amp; YML bundle for Fedora, macOS, and Windows.
          </p>
        </div>
        <ThemeToggle theme={theme} onChange={onThemeChange} />
      </div>

      {/* Active Connection Status Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Database
            className={`w-5 h-5 mt-0.5 shrink-0 ${
              dbStatus?.mode === 'mysql' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          />
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {dbStatus?.mode === 'mysql'
                ? `Connected to MySQL Server (${dbStatus.host}:${dbStatus.port}/${dbStatus.database})`
                : 'Running on Local Preview Store (MySQL Not Connected)'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {dbStatus?.mode === 'mysql'
                ? 'All manual entries and XLSX imports read and write directly to your MySQL database.'
                : dbStatus?.error
                ? `Last MySQL attempt: ${dbStatus.error}`
                : 'Enter your MySQL Server credentials below or set them in .env to auto-connect on startup.'}
            </p>
          </div>
        </div>

        {dbStatus?.mode === 'mysql' && (
          <button
            type="button"
            disabled={syncing}
            onClick={handleSyncLocal}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer shrink-0"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>{syncing ? 'Syncing...' : 'Push Local Records to MySQL'}</span>
          </button>
        )}
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
        {/* Credentials Form */}
        <form
          onSubmit={handleSaveAndConnect}
          className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
            MySQL Auto-Connect Credentials
          </h2>

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
              <span>Connect automatically when application starts</span>
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

        {/* Desktop Packaging & Schema SQL */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  GitHub Source &amp; Desktop Executables
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
                <strong>Fedora Linux:</strong> <code className="font-mono-tabular">.rpm</code> &amp; <code className="font-mono-tabular">.AppImage</code>
              </li>
              <li>
                <strong>macOS:</strong> <code className="font-mono-tabular">.dmg</code> &amp; <code className="font-mono-tabular">.zip</code>
              </li>
              <li>
                <strong>Windows:</strong> <code className="font-mono-tabular">.exe</code> installer &amp; portable binary
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
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                MySQL Schema (Auto-Initialized on Connect)
              </h2>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
              </button>
            </div>
            <pre className="p-3.5 bg-slate-900 dark:bg-slate-950 text-slate-100 border border-slate-800 rounded-md text-[11px] font-mono-tabular overflow-auto max-h-60 leading-relaxed">
              {schemaSql || '-- Loading schema.sql...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
