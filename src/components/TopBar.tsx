import React from 'react';

export type ActiveTab = 'catalog' | 'editor' | 'import' | 'mysql';

interface TopBarProps {
  activeTab: ActiveTab;
  onNavigate: (tab: ActiveTab) => void;
  onNewAlbum: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ activeTab, onNavigate, onNewAlbum }) => {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'catalog', label: 'Catalog' },
    { id: 'editor', label: 'Album Sheet' },
    { id: 'import', label: 'XLSX Import' },
    { id: 'mysql', label: 'MySQL Setup' },
  ];

  return (
    <header className="md:sticky md:top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
        >
          DiscBase Studio
        </button>

        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-6">
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

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onNewAlbum}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            New Album
          </button>
        </div>
      </div>

      {/* Mobile navigation row */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden flex items-center justify-between px-4 border-t border-slate-100 dark:border-slate-800 overflow-x-auto gap-4"
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
