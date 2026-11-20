import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  Plus,
  Save,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import type { Album, Song } from '../types/catalog';
import {
  computeAlbumStats,
  computeSongSeconds,
  createEmptySong,
  validateAlbum,
} from '../utils/catalogMath';

interface AlbumSheetEditorProps {
  album: Album;
  saving: boolean;
  saveMessage: string | null;
  saveError: string | null;
  onChange: (album: Album) => void;
  onSave: () => Promise<void>;
  onBackToCatalog: () => void;
  onExportXlsx?: (id: number) => void;
}

const INPUT_BASE =
  'w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600';

const CELL_INPUT =
  'w-full px-2 py-1 bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 focus:bg-white dark:focus:bg-slate-950 rounded focus:outline-none';

export const AlbumSheetEditor: React.FC<AlbumSheetEditorProps> = ({
  album,
  saving,
  saveMessage,
  saveError,
  onChange,
  onSave,
  onBackToCatalog,
  onExportXlsx,
}) => {
  const [showExtendedCols, setShowExtendedCols] = useState(true);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const stats = useMemo(() => computeAlbumStats(album.songs), [album.songs]);
  const validation = useMemo(() => validateAlbum(album), [album]);

  const updateField = <K extends keyof Album>(key: K, value: Album[K]) => {
    onChange({ ...album, [key]: value });
  };

  const updateSong = (idx: number, patch: Partial<Song>) => {
    const nextSongs = album.songs.map((s, i) => {
      if (i !== idx) return s;
      const merged = { ...s, ...patch };
      merged.total_seconds = computeSongSeconds(merged.duration_min, merged.duration_sec);
      return merged;
    });
    const nextStats = computeAlbumStats(nextSongs);
    onChange({
      ...album,
      songs: nextSongs,
      total_seconds: nextStats.totalSeconds,
      album_time: nextStats.formattedTime,
    });
  };

  const addSongRow = (asMedleySubRow = false) => {
    const nextIndex = album.songs.length;
    const newSong = createEmptySong(nextIndex);
    if (asMedleySubRow) {
      newSong.track_no = '';
      newSong.full_track = false;
      newSong.pot_pouri = true;
    } else {
      const maxNum = album.songs.reduce((m, s) => {
        const n = parseInt(s.track_no, 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      newSong.track_no = String(maxNum + 1);
    }
    if (album.cd_digital_playlist_link) {
      newSong.digital_web_link = album.cd_digital_playlist_link;
    }
    if (album.album_artist && album.album_artist !== 'ΔΙΑΦΟΡΟΙ') {
      newSong.singer_gr = album.album_artist;
    }
    const nextSongs = [...album.songs, newSong];
    const nextStats = computeAlbumStats(nextSongs);
    onChange({
      ...album,
      songs: nextSongs,
      total_seconds: nextStats.totalSeconds,
      album_time: nextStats.formattedTime,
    });
  };

  const duplicateSongRow = (idx: number) => {
    const src = album.songs[idx];
    const copy: Song = {
      ...src,
      id: undefined,
      sort_order: idx + 1,
    };
    const nextSongs = [
      ...album.songs.slice(0, idx + 1),
      copy,
      ...album.songs.slice(idx + 1),
    ].map((s, i) => ({ ...s, sort_order: i }));
    const nextStats = computeAlbumStats(nextSongs);
    onChange({
      ...album,
      songs: nextSongs,
      total_seconds: nextStats.totalSeconds,
      album_time: nextStats.formattedTime,
    });
  };

  const moveSongRow = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= album.songs.length) return;
    const nextSongs = [...album.songs];
    const [moved] = nextSongs.splice(idx, 1);
    nextSongs.splice(target, 0, moved);
    onChange({
      ...album,
      songs: nextSongs.map((s, i) => ({ ...s, sort_order: i })),
    });
  };

  const removeSongRow = (idx: number) => {
    if (album.songs.length <= 1) {
      onChange({
        ...album,
        songs: [createEmptySong(0)],
        total_seconds: 0,
        album_time: '00:00',
      });
      return;
    }
    const nextSongs = album.songs
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, sort_order: i }));
    const nextStats = computeAlbumStats(nextSongs);
    onChange({
      ...album,
      songs: nextSongs,
      total_seconds: nextStats.totalSeconds,
      album_time: nextStats.formattedTime,
    });
  };

  const updateMusician = (idx: number, field: 'role' | 'name', value: string) => {
    const nextMusicians = album.musicians.map((m, i) =>
      i === idx ? { ...m, [field]: value } : m
    );
    onChange({ ...album, musicians: nextMusicians });
  };

  const addMusician = () => {
    onChange({
      ...album,
      musicians: [
        ...album.musicians,
        { role: '', name: '', sort_order: album.musicians.length },
      ],
    });
  };

  const removeMusician = (idx: number) => {
    if (album.musicians.length <= 1) {
      onChange({
        ...album,
        musicians: [{ role: '', name: '', sort_order: 0 }],
      });
      return;
    }
    onChange({
      ...album,
      musicians: album.musicians
        .filter((_, i) => i !== idx)
        .map((m, i) => ({ ...m, sort_order: i })),
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);
    if (!validation.valid) return;
    await onSave();
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToCatalog}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Catalog</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 break-words">
              {album.id
                ? `${album.catalog_number || 'Album'} — ${album.album_title || 'Untitled'}`
                : 'New Album & Song Entry Sheet'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              General album metadata, spreadsheet-aligned song entries, and session musicians
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {album.id && onExportXlsx && (
            <button
              type="button"
              onClick={() => onExportXlsx(album.id!)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export XLSX</span>
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving to Database...' : album.id ? 'Update Record' : 'Save to Database'}</span>
          </button>
        </div>
      </div>

      {/* Feedback & Validation Alerts */}
      {saveMessage && (
        <div role="status" className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-sm rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {saveError && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200 text-sm rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {attemptedSubmit && !validation.valid && (
        <div role="alert" className="px-4 py-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200 text-sm rounded-lg">
          <div className="font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>Please resolve the following before saving:</span>
          </div>
          <ul className="mt-1.5 list-disc list-inside text-xs space-y-0.5 text-red-800 dark:text-red-300">
            {validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* SECTION 1: GENERAL FIELDS (Γενικά Πεδία) */}
      <section aria-labelledby="general-fields-heading" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="general-fields-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              General Fields (Γενικά Πεδία Δίσκου)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Master disc identification, release metadata, and digital links
            </p>
          </div>
          <div className="sm:text-right font-mono-tabular text-xs text-slate-600 dark:text-slate-400 shrink-0">
            Album Time: <strong className="text-slate-900 dark:text-slate-100">{stats.formattedTime}</strong> ({stats.totalSeconds}s)
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="field-barcode" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Barcode
            </label>
            <input
              id="field-barcode"
              type="text"
              value={album.barcode}
              onChange={(e) => updateField('barcode', e.target.value)}
              placeholder="e.g. 5205299033028"
              className={`${INPUT_BASE} font-mono-tabular`}
            />
          </div>

          <div>
            <label htmlFor="field-catalog-number" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Catalog Number (Αρ. Καταλόγου) *
            </label>
            <input
              id="field-catalog-number"
              type="text"
              value={album.catalog_number}
              onChange={(e) => updateField('catalog_number', e.target.value)}
              placeholder="e.g. GM 4314"
              className={`${INPUT_BASE} font-mono-tabular`}
            />
          </div>

          <div>
            <label htmlFor="field-label" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Label
            </label>
            <input
              id="field-label"
              type="text"
              value={album.label}
              onChange={(e) => updateField('label', e.target.value)}
              placeholder="e.g. GM"
              className={INPUT_BASE}
            />
          </div>

          <div>
            <label htmlFor="field-format" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Format (Τύπος)
            </label>
            <input
              id="field-format"
              type="text"
              value={album.format}
              onChange={(e) => updateField('format', e.target.value)}
              placeholder="CD / Vinyl / Digital"
              className={INPUT_BASE}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-album-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Album Title (Γενικός Τίτλος) *
            </label>
            <input
              id="field-album-title"
              type="text"
              value={album.album_title}
              onChange={(e) => updateField('album_title', e.target.value)}
              placeholder="e.g. ΖΩΝΤΑΝΑ ΣΤΑ ΑΡΑΧΩΒΙΤΙΚΑ"
              className={`${INPUT_BASE} font-medium`}
            />
          </div>

          <div>
            <label htmlFor="field-album-artist" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Album Artist (Τραγουδιστής)
            </label>
            <input
              id="field-album-artist"
              type="text"
              value={album.album_artist}
              onChange={(e) => updateField('album_artist', e.target.value)}
              placeholder="e.g. ΔΙΑΦΟΡΟΙ or ΑΝΝΟΥΛΑ ΤΣΑΧΑΛΟΥ"
              className={INPUT_BASE}
            />
          </div>

          <div>
            <label htmlFor="field-category" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Album Music Category (Κατηγορία)
            </label>
            <input
              id="field-category"
              type="text"
              value={album.album_music_category}
              onChange={(e) => updateField('album_music_category', e.target.value)}
              placeholder="e.g. Δημοτικα"
              className={INPUT_BASE}
            />
          </div>

          <div>
            <label htmlFor="field-release-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Release Date (Ημ. Αποστολής)
            </label>
            <input
              id="field-release-date"
              type="text"
              value={album.release_date}
              onChange={(e) => updateField('release_date', e.target.value)}
              placeholder="DD-MM-YYYY"
              className={`${INPUT_BASE} font-mono-tabular`}
            />
          </div>

          <div>
            <label htmlFor="field-return-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Return Date (Ημ. Επιστροφής)
            </label>
            <input
              id="field-return-date"
              type="text"
              value={album.return_date}
              onChange={(e) => updateField('return_date', e.target.value)}
              placeholder="DD-MM-YYYY"
              className={`${INPUT_BASE} font-mono-tabular`}
            />
          </div>

          <div>
            <label htmlFor="field-album-time" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Album Time (Auto-Computed)
            </label>
            <input
              id="field-album-time"
              type="text"
              value={album.album_time}
              onChange={(e) => updateField('album_time', e.target.value)}
              placeholder="MM:SS"
              className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label htmlFor="field-producer" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Producer (Παραγωγός)
            </label>
            <input
              id="field-producer"
              type="text"
              value={album.producer}
              onChange={(e) => updateField('producer', e.target.value)}
              placeholder="e.g. ΑΝΔΡΕΑΣ ΣΤΑΜΑΤΕΛΑΤΟΣ"
              className={INPUT_BASE}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-phonographic" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Phonographic Company (Φων. Εταιρία)
            </label>
            <input
              id="field-phonographic"
              type="text"
              value={album.phonographic_company}
              onChange={(e) => updateField('phonographic_company', e.target.value)}
              placeholder="e.g. ΣΤΑΜΑΤΕΛΑΤΟΣ ΣΩΤΗΡΙΟΣ & ΣΙΑ Ο.Ε."
              className={INPUT_BASE}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-featured-artists" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Featured Singers Line (for Compilations / ΔΙΑΦΟΡΟΙ)
            </label>
            <input
              id="field-featured-artists"
              type="text"
              value={album.featured_artists}
              onChange={(e) => updateField('featured_artists', e.target.value)}
              placeholder="e.g. ΓΙΑΝΝΗΣ ΚΩΝΣΤΑΝΤΙΝΟΥ - ΦΙΛΙΩ ΠΥΡΓΑΚΗ..."
              className={INPUT_BASE}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-playlist-link" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              CD Digital Playlist Link
            </label>
            <input
              id="field-playlist-link"
              type="url"
              value={album.cd_digital_playlist_link}
              onChange={(e) => updateField('cd_digital_playlist_link', e.target.value)}
              placeholder="https://youtube.com/playlist?list=..."
              className={`${INPUT_BASE} font-mono-tabular`}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-physical-link" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Physical Product Web Link
            </label>
            <input
              id="field-physical-link"
              type="url"
              value={album.physical_product_web_link}
              onChange={(e) => updateField('physical_product_web_link', e.target.value)}
              placeholder="https://www.generalmusic.gr/shop/..."
              className={`${INPUT_BASE} font-mono-tabular`}
            />
          </div>

          <div>
            <label htmlFor="field-production-company" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Production (Παραγωγή)
            </label>
            <input
              id="field-production-company"
              type="text"
              value={album.production_company}
              onChange={(e) => updateField('production_company', e.target.value)}
              placeholder="e.g. GENERAL MUSIC"
              className={INPUT_BASE}
            />
          </div>

          <div>
            <label htmlFor="field-print-design" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Artwork / Print (Μακέτα-Εκτύπωση)
            </label>
            <input
              id="field-print-design"
              type="text"
              value={album.print_design}
              onChange={(e) => updateField('print_design', e.target.value)}
              placeholder="e.g. ΑΛΕΞΟΠΟΥΛΟΣ / FORMAT"
              className={INPUT_BASE}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-album-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Album Notes (Σημειώσεις)
            </label>
            <input
              id="field-album-notes"
              type="text"
              value={album.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Optional administrative notes..."
              className={INPUT_BASE}
            />
          </div>
        </div>
      </section>

      {/* SECTION 2: SONGS SPREADSHEET GRID (Ειδικό Πεδίο Songs) */}
      <section aria-labelledby="songs-grid-heading" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 id="songs-grid-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Songs Sheet (Ειδικό Πεδίο Τραγουδιών)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {stats.totalTracks} track rows · {stats.fullTrackCount} Full Tracks (ΟΛΟΚΛΗΡΟ) ·{' '}
              {stats.potPouriCount} Pot-Pouri (ΠΟΤ - ΠΟΥΡΙ) · {stats.totalSeconds.toLocaleString()} sec total
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExtendedCols((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
            >
              {showExtendedCols ? 'Hide AEPI % & Notes' : 'Show AEPI % & Notes'}
            </button>
            <button
              type="button"
              onClick={() => addSongRow(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Pot-Pouri Sub-Track</span>
            </button>
            <button
              type="button"
              onClick={() => addSongRow(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Track</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto spreadsheet-scroll">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold">
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 w-16 text-center sticky left-0 z-20 bg-slate-100 dark:bg-slate-800">
                  A/A
                </th>
                <th className="py-2.5 px-2 border-r border-slate-300 dark:border-slate-700 min-w-[200px] sm:min-w-[230px] sm:sticky sm:left-16 z-20 bg-slate-100 dark:bg-slate-800 sm:shadow-[2px_0_4px_-2px_rgba(15,23,42,0.12)]">
                  Title GR (Τίτλος)
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[210px]">
                  Title EN
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">
                  Full Track
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">
                  Pot-Pouri
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 w-16 text-center">
                  Min
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 w-16 text-center">
                  Sec
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 w-20 text-right whitespace-nowrap">
                  Total (s)
                </th>
                {showExtendedCols && (
                  <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 w-20 text-right whitespace-nowrap">
                    AEPI %
                  </th>
                )}
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[145px]">
                  ISRC Code
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[220px]">
                  Composer GR (Συνθέτης)
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[230px]">
                  Songwriter GR (Στιχουργός)
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[120px]">
                  Autodia Code
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[130px]">
                  ISWC Code
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[220px]">
                  Composer EN (Creators)
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">
                  Songwriter EN
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[200px]">
                  Digital Web Link
                </th>
                {showExtendedCols && (
                  <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 w-24 text-right whitespace-nowrap">
                    Final AEPI
                  </th>
                )}
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[200px]">
                  Singer GR (Τραγουδιστής)
                </th>
                <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">
                  Singer EN
                </th>
                {showExtendedCols && (
                  <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700 min-w-[220px]">
                    Notes (Παρατηρήσεις)
                  </th>
                )}
                <th className="py-2.5 px-2 text-center whitespace-nowrap">
                  Row
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {album.songs.map((song, idx) => {
                const rowHasError = attemptedSubmit && Boolean(validation.songErrors[idx]);
                const rowBg = rowHasError
                  ? 'bg-red-50/50 dark:bg-red-950/30'
                  : 'bg-white dark:bg-slate-900 hover:bg-slate-50/70 dark:hover:bg-slate-800/50';
                const stickyBg = rowHasError ? 'bg-red-50 dark:bg-red-950' : 'bg-white dark:bg-slate-900';

                return (
                  <tr key={idx} className={rowBg}>
                    <td className={`p-1 border-r border-slate-200 dark:border-slate-800 sticky left-0 z-10 ${stickyBg}`}>
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Track Number`}
                        value={song.track_no}
                        onChange={(e) => updateSong(idx, { track_no: e.target.value })}
                        className="w-14 px-1.5 py-1 text-center font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                      />
                    </td>

                    <td className={`p-1 border-r border-slate-300 dark:border-slate-700 sm:sticky sm:left-16 z-10 sm:shadow-[2px_0_4px_-2px_rgba(15,23,42,0.12)] ${stickyBg}`}>
                      <input
                        type="text"
                        title={song.title_gr}
                        aria-label={`Row ${idx + 1} Title GR`}
                        value={song.title_gr}
                        onChange={(e) => updateSong(idx, { title_gr: e.target.value })}
                        placeholder="ΤΙΤΛΟΣ..."
                        className={`w-full px-2 py-1 font-medium bg-transparent text-slate-900 dark:text-slate-100 border rounded focus:outline-none ${
                          rowHasError && !song.title_gr && !song.title_en
                            ? 'border-red-400 bg-white dark:bg-slate-950'
                            : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 focus:bg-white dark:focus:bg-slate-950'
                        }`}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Title EN`}
                        value={song.title_en}
                        onChange={(e) => updateSong(idx, { title_en: e.target.value })}
                        placeholder="English title..."
                        className={CELL_INPUT}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Row ${idx + 1} Full Track`}
                        checked={song.full_track}
                        onChange={(e) => updateSong(idx, { full_track: e.target.checked })}
                        className="w-4 h-4 accent-blue-700 cursor-pointer"
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Row ${idx + 1} Pot-Pouri`}
                        checked={song.pot_pouri}
                        onChange={(e) => updateSong(idx, { pot_pouri: e.target.checked })}
                        className="w-4 h-4 accent-amber-600 cursor-pointer"
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="number"
                        min={0}
                        aria-label={`Row ${idx + 1} Duration Minutes`}
                        value={song.duration_min ?? ''}
                        onChange={(e) =>
                          updateSong(idx, {
                            duration_min: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className="w-14 px-1.5 py-1 text-right font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        aria-label={`Row ${idx + 1} Duration Seconds`}
                        value={song.duration_sec ?? ''}
                        onChange={(e) =>
                          updateSong(idx, {
                            duration_sec: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className="w-14 px-1.5 py-1 text-right font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                      />
                    </td>

                    <td className="px-2 py-1 border-r border-slate-200 dark:border-slate-800 text-right font-mono-tabular text-slate-600 dark:text-slate-300 bg-slate-50/70 dark:bg-slate-800/40">
                      {computeSongSeconds(song.duration_min, song.duration_sec).toFixed(2)}
                    </td>

                    {showExtendedCols && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="number"
                          step="0.01"
                          aria-label={`Row ${idx + 1} AEPI Percent`}
                          value={song.aepi_percent ?? ''}
                          onChange={(e) =>
                            updateSong(idx, {
                              aepi_percent: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-20 px-1.5 py-1 text-right font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                        />
                      </td>
                    )}

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} ISRC Code`}
                        value={song.isrc_code}
                        onChange={(e) => updateSong(idx, { isrc_code: e.target.value })}
                        placeholder="GRGM..."
                        className={`${CELL_INPUT} font-mono-tabular`}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        title={song.composer_gr}
                        aria-label={`Row ${idx + 1} Composer GR`}
                        value={song.composer_gr}
                        onChange={(e) => updateSong(idx, { composer_gr: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        title={song.songwriter_gr}
                        aria-label={`Row ${idx + 1} Songwriter GR`}
                        value={song.songwriter_gr}
                        onChange={(e) => updateSong(idx, { songwriter_gr: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Autodia Code`}
                        value={song.autodia_code}
                        onChange={(e) => updateSong(idx, { autodia_code: e.target.value })}
                        className={`${CELL_INPUT} font-mono-tabular`}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} ISWC Code`}
                        value={song.iswc_code}
                        onChange={(e) => updateSong(idx, { iswc_code: e.target.value })}
                        className={`${CELL_INPUT} font-mono-tabular`}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        title={song.composer_en}
                        aria-label={`Row ${idx + 1} Composer EN`}
                        value={song.composer_en}
                        onChange={(e) => updateSong(idx, { composer_en: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Songwriter EN`}
                        value={song.songwriter_en}
                        onChange={(e) => updateSong(idx, { songwriter_en: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Digital Web Link`}
                        value={song.digital_web_link}
                        onChange={(e) => updateSong(idx, { digital_web_link: e.target.value })}
                        placeholder="https://..."
                        className={`${CELL_INPUT} font-mono-tabular`}
                      />
                    </td>

                    {showExtendedCols && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="number"
                          step="0.00001"
                          aria-label={`Row ${idx + 1} Final AEPI Percent`}
                          value={song.final_aepi_percent ?? ''}
                          onChange={(e) =>
                            updateSong(idx, {
                              final_aepi_percent: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-24 px-1.5 py-1 text-right font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                        />
                      </td>
                    )}

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Singer GR`}
                        value={song.singer_gr}
                        onChange={(e) => updateSong(idx, { singer_gr: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>

                    <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        aria-label={`Row ${idx + 1} Singer EN`}
                        value={song.singer_en}
                        onChange={(e) => updateSong(idx, { singer_en: e.target.value })}
                        className={CELL_INPUT}
                      />
                    </td>

                    {showExtendedCols && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} Notes`}
                          value={song.notes}
                          onChange={(e) => updateSong(idx, { notes: e.target.value })}
                          className={CELL_INPUT}
                        />
                      </td>
                    )}

                    <td className="p-1 whitespace-nowrap text-center">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveSongRow(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Move row ${idx + 1} up`}
                          title="Move Up"
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSongRow(idx, 1)}
                          disabled={idx === album.songs.length - 1}
                          aria-label={`Move row ${idx + 1} down`}
                          title="Move Down"
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateSongRow(idx)}
                          aria-label={`Duplicate row ${idx + 1}`}
                          title="Duplicate Row"
                          className="p-1 text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSongRow(idx)}
                          aria-label={`Delete row ${idx + 1}`}
                          title="Remove Row"
                          className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Spreadsheet Summary Footer matching Screenshot Totals */}
            <tfoot className="bg-slate-50 dark:bg-slate-800/80 border-t-2 border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <tr>
                <td colSpan={3} className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 sticky left-0 bg-slate-50 dark:bg-slate-800">
                  ΣΥΝΟΛΙΚΗ ΔΙΑΡΚΕΙΑ &amp; ΟΛΟΚΛΗΡΑ / ΠΟΤ-ΠΟΥΡΙ
                </td>
                <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-center font-mono-tabular text-blue-800 dark:text-blue-400">
                  {stats.fullTrackCount}
                </td>
                <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-center font-mono-tabular text-amber-800 dark:text-amber-400">
                  {stats.potPouriCount}
                </td>
                <td colSpan={2} className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-mono-tabular">
                  {stats.formattedTime}
                </td>
                <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-mono-tabular">
                  {stats.totalSeconds.toLocaleString()}.00
                </td>
                {showExtendedCols && (
                  <>
                    <td colSpan={9} className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right text-slate-500 dark:text-slate-400">
                      ΤΕΛΙΚΟ ΠΟΣΟΣΤΟ ΑΕΠΙ ΑΝΑ CD:
                    </td>
                    <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-mono-tabular">
                      {stats.totalAepiPercent.toFixed(5)}
                    </td>
                    <td colSpan={4} />
                  </>
                )}
                {!showExtendedCols && <td colSpan={11} />}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* SECTION 3: MUSICIANS (Έπαιξαν οι μουσικοί) */}
      <section aria-labelledby="musicians-heading" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="musicians-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Musicians (Έπαιξαν οι μουσικοί)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add sub-musician entries by instrument/role and performer name
            </p>
          </div>
          <button
            type="button"
            onClick={addMusician}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Musician</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {album.musicians.map((m, idx) => (
            <div
              key={idx}
              className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-800/40"
            >
              <input
                type="text"
                aria-label={`Musician ${idx + 1} Instrument or Role`}
                value={m.role}
                onChange={(e) => updateMusician(idx, 'role', e.target.value)}
                placeholder="Instrument / Role (e.g. Κλαρίνο)"
                className="w-full sm:w-44 px-2.5 py-1.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="text"
                  aria-label={`Musician ${idx + 1} Full Name`}
                  value={m.name}
                  onChange={(e) => updateMusician(idx, 'name', e.target.value)}
                  placeholder="Musician Full Name..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => removeMusician(idx)}
                  aria-label={`Remove musician ${idx + 1}`}
                  className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </form>
  );
};
