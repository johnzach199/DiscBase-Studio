import React from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { VersionCheckResult } from '../types/catalog';
import { safeHttpUrl } from '../utils/catalogMath';

interface UpdateWarningBannerProps {
  versionInfo: VersionCheckResult;
  checking: boolean;
  onRecheck: () => void;
  onDismiss: () => void;
}

export const UpdateWarningBanner: React.FC<UpdateWarningBannerProps> = ({
  versionInfo,
  checking,
  onRecheck,
  onDismiss,
}) => {
  if (!versionInfo.isOutdated || !versionInfo.latestVersion) {
    return null;
  }

  const downloadHref = safeHttpUrl(versionInfo.releaseUrl);

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full bg-amber-50 dark:bg-amber-950/80 border-b border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100 px-3 sm:px-6 lg:px-8 py-2.5"
    >
      <div className="w-full flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
          <p className="text-xs sm:text-sm leading-snug">
            <strong className="font-semibold">Newer version available:</strong>{' '}
            <span>
              You are running{' '}
              <span className="font-mono-tabular font-semibold">v{versionInfo.currentVersion}</span>,
              but <span className="font-mono-tabular font-semibold">v{versionInfo.latestVersion}</span>{' '}
              is now available{versionInfo.repo ? ` (${versionInfo.repo})` : ''}.
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {downloadHref && (
            <a
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-slate-950 rounded-md transition-colors whitespace-nowrap"
            >
              <span>Download v{versionInfo.latestVersion}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            type="button"
            disabled={checking}
            onClick={onRecheck}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 bg-amber-100/80 dark:bg-amber-900/60 hover:bg-amber-200/80 dark:hover:bg-amber-900 rounded-md transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Checking...' : 'Recheck'}</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss update warning"
            title="Dismiss warning"
            onClick={onDismiss}
            className="p-1 text-amber-700 dark:text-amber-300 hover:text-amber-950 dark:hover:text-white hover:bg-amber-200/60 dark:hover:bg-amber-900/80 rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
