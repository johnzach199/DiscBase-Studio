import React from 'react';
import { Minus, Square, X } from 'lucide-react';
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
    };
  }
}

interface TopBarProps {
  activeTab: ActiveTab;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onNavigate: (tab: ActiveTab) => void;
  onNewAlbum: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  theme,
  onThemeChange,
  onNavigate,
  onNewAlbum,
}) => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopEnv?.isDesktop);
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'catalog', label: 'Catalog' },
    { id: 'editor', label: 'Album Sheet' },
    { id: 'import', label: 'XLSX Import' },
    { id: 'mysql', label: 'MySQL Setup' },
  ];

  return (
    <header className="electron-drag w-full md:sticky md:top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 select-none">
      <div
        className={`w-full h-14 md:h-16 flex items-center justify-between gap-1.5 sm:gap-6 pl-2.5 sm:pl-6 lg:pl-8 ${
          isDesktop ? 'pr-0' : 'pr-2.5 sm:pr-6 lg:pr-8'
        }`}
      >
        <div className="flex items-center gap-4 lg:gap-8 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="electron-no-drag text-sm sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
          >
            DiscBase Studio
          </button>

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
