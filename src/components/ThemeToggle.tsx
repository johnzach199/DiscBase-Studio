import React from 'react';
import { Moon, Sun } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';

interface ThemeToggleProps {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onChange }) => {
  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center p-0.5 sm:p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0"
    >
      <button
        type="button"
        aria-pressed={theme === 'light'}
        aria-label="Light theme"
        onClick={() => onChange('light')}
        className={`inline-flex items-center gap-1.5 px-1.5 sm:px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
          theme === 'light'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        <Sun className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Light</span>
      </button>
      <button
        type="button"
        aria-pressed={theme === 'dark'}
        aria-label="Dark theme"
        onClick={() => onChange('dark')}
        className={`inline-flex items-center gap-1.5 px-1.5 sm:px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
          theme === 'dark'
            ? 'bg-slate-900 text-slate-100 shadow-sm'
            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        <Moon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Dark</span>
      </button>
    </div>
  );
};
