import React from 'react';
import { Minus, Square, X } from 'lucide-react';

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
  onNavigate: (tab: ActiveTab) => void;
  onNewAlbum: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ activeTab, onNavigate, onNewAlbum }) => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopEnv?.isDesktop);
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'catalog', label: 'Catalog' },
    { id: 'editor', label: 'Album Sheet' },
    { id: 'import', label: 'XLSX Import' },
    { id: 'mysql', label: 'MySQL Setup' },
  ];

  return (
    <header className="electron-drag md:sticky md:top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 select-none">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-4 sm:gap-8">
        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className="electron-no-drag text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
        >
          DiscBase Studio
        </button>

        <nav aria-label="Main navigation" className="electron-no-drag hidden md:flex items-center gap-6">
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

        <div className="electron-no-drag flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNewAlbum}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            New Album
          </button>

          {isDesktop && (
            <div className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200 dark:border-slate-700">
              <button
                type="button"
                aria-label="Minimize window"
                onClick={() => window.desktopEnv?.minimize?.()}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Maximize or restore window"
                onClick={() => window.desktopEnv?.toggleMaximize?.()}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Close window"
                onClick={() => window.desktopEnv?.close?.()}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-white hover:bg-red-600 rounded cursor-pointer"
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
        className="electron-no-drag md:hidden flex items-center justify-between px-4 border-t border-slate-100 dark:border-slate-800 overflow-x-auto gap-4"
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
