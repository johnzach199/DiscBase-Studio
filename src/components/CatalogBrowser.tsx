import React, { useMemo, useState } from 'react';
import { Database, Download, ExternalLink, FileSpreadsheet, FolderOpen, Plus, Search, Trash2 } from 'lucide-react';
import type { AlbumSummary, DbStatus } from '../types/catalog';

interface CatalogBrowserProps {
  albums: AlbumSummary[];
  loading: boolean;
  dbStatus: DbStatus | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAlbum: (id: number) => void;
  onDeleteAlbum: (id: number) => Promise<void>;
  onExportAlbum: (id: number) => void;
  onNewAlbum: () => void;
  onGoToImport: () => void;
  onGoToMysql: () => void;
}

export const CatalogBrowser: React.FC<CatalogBrowserProps> = ({
  albums,
  loading,
  dbStatus,
  searchQuery,
  onSearchChange,
  onOpenAlbum,
  onDeleteAlbum,
  onExportAlbum,
  onNewAlbum,
  onGoToImport,
  onGoToMysql,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    albums.forEach((a) => {
      if (a.album_music_category) set.add(a.album_music_category);
    });
    return Array.from(set).sort();
  }, [albums]);

  const formats = useMemo(() => {
    const set = new Set<string>();
    albums.forEach((a) => {
      if (a.format) set.add(a.format);
    });
    return Array.from(set).sort();
  }, [albums]);

  const filteredAlbums = useMemo(() => {
    return albums.filter((a) => {
      if (categoryFilter !== 'all' && a.album_music_category !== categoryFilter) return false;
      if (formatFilter !== 'all' && a.format !== formatFilter) return false;
      return true;
    });
  }, [albums, categoryFilter, formatFilter]);

  const totalTracksInView = useMemo(
    () => filteredAlbums.reduce((sum, a) => sum + a.track_count, 0),
    [filteredAlbums]
  );

  const handleConfirmDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await onDeleteAlbum(id);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Workspace Header & DB Banner */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Album &amp; Song Catalog
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Browse, edit, and export master discography records or batch import from Excel spreadsheets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onGoToMysql}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Database className={`w-3.5 h-3.5 ${dbStatus?.mode === 'mysql' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} />
            <span>
              {dbStatus?.mode === 'mysql'
                ? `MySQL: ${dbStatus.host}/${dbStatus.database}`
                : 'Local Preview Store (Configure MySQL)'}
            </span>
          </button>

          <button
            type="button"
            onClick={onGoToImport}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>Import XLSX</span>
          </button>
        </div>
      </div>

      {/* Summary Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Cataloged Albums</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono-tabular">
            {filteredAlbums.length}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Song Entries</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono-tabular">
            {totalTracksInView}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Full Tracks vs Pot-Pouri</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono-tabular">
            {filteredAlbums.reduce((s, a) => s + a.full_track_count, 0)} /{' '}
            {filteredAlbums.reduce((s, a) => s + a.pot_pouri_count, 0)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Storage Engine</div>
          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>{dbStatus?.mode === 'mysql' ? 'MySQL Server' : 'Local Store'}</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {dbStatus?.mode === 'mysql' ? '(Auto-Connected)' : '(Ready for MySQL)'}
            </span>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <label htmlFor="catalog-search" className="sr-only">
            Search albums, barcodes, catalog numbers, or songs
          </label>
          <input
            id="catalog-search"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search catalog #, barcode, album title, artist, or song title / ISRC..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
          />
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 sm:gap-3">
          <label htmlFor="filter-category" className="sr-only">
            Filter by Music Category
          </label>
          <select
            id="filter-category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="flex-1 sm:flex-initial min-w-0 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <label htmlFor="filter-format" className="sr-only">
            Filter by Format
          </label>
          <select
            id="filter-format"
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value)}
            className="flex-1 sm:flex-initial min-w-0 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Formats</option>
            {formats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* High-Density Album Ledger Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3" aria-busy="true" aria-label="Loading catalog">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-11 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredAlbums.length === 0 ? (
          <div className="p-12 text-center">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">No albums match your filter</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Create a new album entry manually or import an Excel (.xlsx) track sheet.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onNewAlbum}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Album</span>
              </button>
              <button
                type="button"
                onClick={onGoToImport}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Import XLSX</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <th className="py-3 px-4 whitespace-nowrap">Catalog #</th>
                  <th className="py-3 px-4 whitespace-nowrap">Barcode</th>
                  <th className="py-3 px-4">Album Title</th>
                  <th className="py-3 px-4">Album Artist</th>
                  <th className="py-3 px-4 whitespace-nowrap">Label · Format</th>
                  <th className="py-3 px-4 whitespace-nowrap">Category</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Tracks</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Album Time</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filteredAlbums.map((album) => {
                  const isConfirming = confirmDeleteId === album.id;
                  return (
                    <tr
                      key={album.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono-tabular font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {album.catalog_number || '—'}
                      </td>
                      <td className="py-2.5 px-4 font-mono-tabular text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {album.barcode || '—'}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        <button
                          type="button"
                          onClick={() => onOpenAlbum(album.id)}
                          className="text-left hover:text-blue-700 dark:hover:text-blue-400 hover:underline cursor-pointer font-medium"
                        >
                          {album.album_title}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                        {album.album_artist || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {[album.label, album.format].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {album.album_music_category || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {album.track_count}
                        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1.5">
                          ({album.full_track_count}F / {album.pot_pouri_count}P)
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {album.album_time}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {isConfirming ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={deletingId === album.id}
                              onClick={() => handleConfirmDelete(album.id)}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                            >
                              {deletingId === album.id ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenAlbum(album.id)}
                              aria-label={`Open ${album.album_title}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded cursor-pointer"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>Open</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onExportAlbum(album.id)}
                              aria-label={`Export ${album.album_title} to XLSX`}
                              title="Export XLSX"
                              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(album.id)}
                              aria-label={`Delete ${album.album_title}`}
                              title="Delete Album"
                              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Subtle footer helper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
        <span>Click any album title or Open to inspect and edit tracks in spreadsheet formation.</span>
        <button
          type="button"
          onClick={onGoToMysql}
          className="inline-flex items-center gap-1 self-start sm:self-auto text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
        >
          <span>Manage MySQL Connection</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
