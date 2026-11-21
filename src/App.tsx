import { useCallback, useEffect, useState } from 'react';
import { TopBar, type ActiveTab } from './components/TopBar';
import { CatalogBrowser } from './components/CatalogBrowser';
import { AlbumSheetEditor } from './components/AlbumSheetEditor';
import { XlsxImporter } from './components/XlsxImporter';
import { MysqlSettings } from './components/MysqlSettings';
import type { ThemeMode } from './components/ThemeToggle';
import type { Album, AlbumSummary, DbStatus } from './types/catalog';
import { createEmptyAlbum } from './utils/catalogMath';

function getInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark';
  }
  return 'light';
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [editingAlbum, setEditingAlbum] = useState<Album>(() => createEmptyAlbum());
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const handleThemeChange = useCallback((nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    document.documentElement.style.colorScheme = nextTheme;
    try {
      localStorage.setItem('discbase-theme', nextTheme);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const fetchDbStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/db/status');
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data.status);
      }
    } catch {
      // Ignore transient error
    }
  }, []);

  const fetchAlbums = useCallback(async (q: string) => {
    setLoadingCatalog(true);
    try {
      const url = q.trim() ? `/api/albums?q=${encodeURIComponent(q.trim())}` : '/api/albums';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setAlbums(data.albums || []);
      }
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void fetchDbStatus();
  }, [fetchDbStatus]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAlbums(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchAlbums]);

  const handleOpenAlbum = async (id: number) => {
    setSaveMessage(null);
    setSaveError(null);
    try {
      const res = await fetch(`/api/albums/${id}`);
      if (!res.ok) throw new Error('Failed to load album');
      const data = await res.json();
      setEditingAlbum(data.album);
      setActiveTab('editor');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to open album');
    }
  };

  const handleNewAlbum = () => {
    setSaveMessage(null);
    setSaveError(null);
    setEditingAlbum(createEmptyAlbum());
    setActiveTab('editor');
  };

  const handleSaveAlbum = async () => {
    setSavingAlbum(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const isUpdate = Boolean(editingAlbum.id);
      const url = isUpdate ? `/api/albums/${editingAlbum.id}` : '/api/albums';
      const method = isUpdate ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingAlbum),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save record');
      }
      setEditingAlbum(data.album);
      const storeLabel =
        dbStatus?.mode === 'mysql' ? 'MySQL' : dbStatus?.mode === 'sqlite' ? 'SQLite' : 'Local Store';
      setSaveMessage(
        isUpdate
          ? `Updated "${data.album.album_title}" in ${storeLabel}.`
          : `Saved "${data.album.album_title}" (${data.album.songs.length} tracks) to ${storeLabel}.`
      );
      await Promise.all([fetchAlbums(searchQuery), fetchDbStatus()]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingAlbum(false);
    }
  };

  const handleDeleteAlbum = async (id: number) => {
    const res = await fetch(`/api/albums/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (editingAlbum.id === id) {
        setEditingAlbum(createEmptyAlbum());
      }
      await Promise.all([fetchAlbums(searchQuery), fetchDbStatus()]);
    }
  };

  const handleExportAlbum = (id: number) => {
    const link = document.createElement('a');
    link.href = `/api/albums/${id}/export`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleOpenParsedInEditor = (album: Album) => {
    setSaveMessage(null);
    setSaveError(null);
    setEditingAlbum({ ...album, id: undefined });
    setActiveTab('editor');
  };

  const handleImportComplete = async () => {
    await Promise.all([fetchAlbums(searchQuery), fetchDbStatus()]);
  };

  const handleStatusUpdated = async (nextStatus: DbStatus) => {
    setDbStatus(nextStatus);
    await fetchAlbums(searchQuery);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        theme={theme}
        onThemeChange={handleThemeChange}
        onNavigate={(tab) => {
          setSaveMessage(null);
          setSaveError(null);
          setActiveTab(tab);
        }}
        onNewAlbum={handleNewAlbum}
      />

      <main className="flex-1 w-full px-3 sm:px-6 lg:px-8 xl:px-10 py-5 sm:py-6">
        {activeTab === 'catalog' && (
          <CatalogBrowser
            albums={albums}
            loading={loadingCatalog}
            dbStatus={dbStatus}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenAlbum={handleOpenAlbum}
            onDeleteAlbum={handleDeleteAlbum}
            onExportAlbum={handleExportAlbum}
            onNewAlbum={handleNewAlbum}
            onGoToImport={() => setActiveTab('import')}
            onGoToMysql={() => setActiveTab('mysql')}
          />
        )}

        {activeTab === 'editor' && (
          <AlbumSheetEditor
            album={editingAlbum}
            saving={savingAlbum}
            saveMessage={saveMessage}
            saveError={saveError}
            onChange={setEditingAlbum}
            onSave={handleSaveAlbum}
            onBackToCatalog={() => setActiveTab('catalog')}
            onExportXlsx={handleExportAlbum}
          />
        )}

        {activeTab === 'import' && (
          <XlsxImporter
            existingAlbums={albums}
            onImportComplete={handleImportComplete}
            onOpenInEditor={handleOpenParsedInEditor}
          />
        )}

        {activeTab === 'mysql' && (
          <MysqlSettings
            dbStatus={dbStatus}
            onStatusUpdated={handleStatusUpdated}
          />
        )}
      </main>
    </div>
  );
}
