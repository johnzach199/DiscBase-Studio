import React from 'react';
import { AlertTriangle, Minus, Square, X } from 'lucide-react';
import type { VersionCheckResult } from '../types/catalog';
import { ThemeToggle, type ThemeMode } from './ThemeToggle';

export type ActiveTab = 'catalog' | 'editor' | 'import' | 'mysql';

declare global {
  interface Window {
    desktopEnv?: {
      isDesktop?: boolean;
      platform?: string;
      minimize?: () => void;
      toggleMaximize?: () => void;
      close?: () => void;
      pickSqliteFile?: (opts: { mode: 'open' | 'save'; defaultPath?: string }) => Promise<string | null>;
    };
  }
}

interface TopBarProps {
  activeTab: ActiveTab;
  theme: ThemeMode;
  currentVersion: string;
  versionInfo: VersionCheckResult | null;
  onVersionClick: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onNavigate: (tab: ActiveTab) => void;
  onNewAlbum: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  theme,
  currentVersion,
  versionInfo,
  onVersionClick,
  onThemeChange,
  onNavigate,
  onNewAlbum,
}) => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopEnv?.isDesktop);
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'catalog', label: 'Catalog' },
    { id: 'editor', label: 'Album Sheet' },
    { id: 'import', label: 'XLSX / Numbers' },
    { id: 'mysql', label: 'SQLite & MySQL' },
  ];

  const isOutdated = Boolean(versionInfo?.isOutdated && versionInfo.latestVersion);

  return (
    <header className="electron-drag w-full md:sticky md:top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 select-none">
      <div
        className={`w-full h-14 md:h-16 flex items-center justify-between gap-1.5 sm:gap-6 pl-2.5 sm:pl-6 lg:pl-8 ${
          isDesktop ? 'pr-0' : 'pr-2.5 sm:pr-6 lg:pr-8'
        }`}
      >
        <div className="flex items-center gap-3 lg:gap-6 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="electron-no-drag text-sm sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
            >
              DiscBase Studio
            </button>

            <button
              type="button"
              onClick={onVersionClick}
              title={
                isOutdated
                  ? `Update available: v${versionInfo?.latestVersion} (running v${currentVersion})`
                  : `Installed version v${currentVersion} — Check for updates`
              }
              aria-label={
                isOutdated
                  ? `Update available: version ${versionInfo?.latestVersion}`
                  : `App version ${currentVersion}`
              }
              className={`electron-no-drag hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono-tabular font-semibold rounded border transition-colors cursor-pointer ${
                isOutdated
                  ? 'bg-amber-100 dark:bg-amber-950/80 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {isOutdated && <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />}
              <span>{isOutdated ? `v${currentVersion} → v${versionInfo?.latestVersion}` : `v${currentVersion}`}</span>
            </button>
          </div>

          <nav aria-label="Main navigation" className="electron-no-drag hidden md:flex items-center gap-4 lg:gap-7">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                  className={`py-2 text-sm whitespace-nowrap shrink-0 border-b-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    active
                      ? 'border-blue-700 dark:border-blue-400 text-blue-700 dark:text-blue-400 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-300 font-medium hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="electron-no-drag flex items-center gap-1.5 sm:gap-3 shrink-0 h-full">
          <ThemeToggle theme={theme} onChange={onThemeChange} />

          <button
            type="button"
            onClick={onNewAlbum}
            className="px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            New Album
          </button>

          {isDesktop && (
            <div className="flex items-stretch h-full ml-0.5 sm:ml-1 border-l border-slate-200 dark:border-slate-800">
              <button
                type="button"
                aria-label="Minimize window"
                title="Minimize"
                onClick={() => window.desktopEnv?.minimize?.()}
                className="w-8 sm:w-11 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Maximize or restore window"
                title="Maximize / Restore"
                onClick={() => window.desktopEnv?.toggleMaximize?.()}
                className="w-8 sm:w-11 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Close window"
                title="Close"
                onClick={() => window.desktopEnv?.close?.()}
                className="w-9 sm:w-12 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-white hover:bg-red-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile navigation row */}
      <nav
        aria-label="Mobile navigation"
        className="electron-no-drag md:hidden flex items-center justify-between px-3 sm:px-6 border-t border-slate-100 dark:border-slate-800 overflow-x-auto gap-4"
      >
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
              className={`py-2.5 text-xs whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                active
                  ? 'border-blue-700 dark:border-blue-400 text-blue-700 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-300 font-medium'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
