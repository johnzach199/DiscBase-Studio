import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Columns3,
  Copy,
  Disc,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { Album, Song } from '../types/catalog';
import {
  computeAlbumStats,
  computeSongSeconds,
  createEmptySong,
  safeHttpUrl,
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
  onExportAlbum?: (id: number, format: 'xlsx' | 'numbers') => void;
}

type SongColKey =
  | 'track_no'
  | 'disc_number'
  | 'title_gr'
  | 'title_en'
  | 'full_track'
  | 'pot_pouri'
  | 'duration_min'
  | 'duration_sec'
  | 'total_seconds'
  | 'aepi_percent'
  | 'isrc_code'
  | 'composer_gr'
  | 'songwriter_gr'
  | 'autodia_code'
  | 'iswc_code'
  | 'composer_en'
  | 'songwriter_en'
  | 'digital_web_link'
  | 'final_aepi_percent'
  | 'singer_gr'
  | 'singer_en'
  | 'notes'
  | 'lyrics';

interface SongColumnDef {
  key: SongColKey;
  label: string;
  shortLabel: string;
  thBaseClass: string;
}

const ALL_SONG_COLUMNS: SongColumnDef[] = [
  { key: 'track_no', label: 'A/A', shortLabel: 'A/A', thBaseClass: 'w-16 text-center' },
  { key: 'disc_number', label: 'CD #', shortLabel: 'CD #', thBaseClass: 'w-16 text-center' },
  { key: 'title_gr', label: 'Title GR (Τίτλος)', shortLabel: 'Title GR', thBaseClass: 'min-w-[200px] sm:min-w-[230px]' },
  { key: 'title_en', label: 'Title EN', shortLabel: 'Title EN', thBaseClass: 'min-w-[200px]' },
  { key: 'full_track', label: 'Full Track', shortLabel: 'Full Track', thBaseClass: 'text-center whitespace-nowrap' },
  { key: 'pot_pouri', label: 'Pot-Pouri', shortLabel: 'Pot-Pouri', thBaseClass: 'text-center whitespace-nowrap' },
  { key: 'duration_min', label: 'Min', shortLabel: 'Min', thBaseClass: 'w-16 text-center' },
  { key: 'duration_sec', label: 'Sec', shortLabel: 'Sec', thBaseClass: 'w-16 text-center' },
  { key: 'total_seconds', label: 'Total (s)', shortLabel: 'Total (s)', thBaseClass: 'w-20 text-right whitespace-nowrap' },
  { key: 'aepi_percent', label: 'AEPI %', shortLabel: 'AEPI %', thBaseClass: 'w-24 text-right whitespace-nowrap' },
  { key: 'isrc_code', label: 'ISRC Code', shortLabel: 'ISRC Code', thBaseClass: 'min-w-[145px]' },
  { key: 'composer_gr', label: 'Composer GR (Συνθέτης)', shortLabel: 'Composer GR', thBaseClass: 'min-w-[210px]' },
  { key: 'songwriter_gr', label: 'Songwriter GR (Στιχουργός)', shortLabel: 'Songwriter GR', thBaseClass: 'min-w-[220px]' },
  { key: 'autodia_code', label: 'Autodia Code', shortLabel: 'Autodia', thBaseClass: 'min-w-[125px]' },
  { key: 'iswc_code', label: 'ISWC Code', shortLabel: 'ISWC', thBaseClass: 'min-w-[130px]' },
  { key: 'composer_en', label: 'Composer EN (Creators)', shortLabel: 'Composer EN', thBaseClass: 'min-w-[210px]' },
  { key: 'songwriter_en', label: 'Songwriter EN', shortLabel: 'Songwriter EN', thBaseClass: 'min-w-[180px]' },
  { key: 'digital_web_link', label: 'Digital Web Link', shortLabel: 'Web Link', thBaseClass: 'min-w-[230px]' },
  { key: 'final_aepi_percent', label: 'Final AEPI', shortLabel: 'Final AEPI', thBaseClass: 'w-24 text-right whitespace-nowrap' },
  { key: 'singer_gr', label: 'Singer GR (Τραγουδιστής)', shortLabel: 'Singer GR', thBaseClass: 'min-w-[190px]' },
  { key: 'singer_en', label: 'Singer EN', shortLabel: 'Singer EN', thBaseClass: 'min-w-[175px]' },
  { key: 'notes', label: 'Notes (Παρατηρήσεις)', shortLabel: 'Notes', thBaseClass: 'min-w-[200px]' },
  { key: 'lyrics', label: 'Lyrics (Στίχοι)', shortLabel: 'Lyrics', thBaseClass: 'min-w-[210px]' },
];

const DEFAULT_VISIBLE_COLS: Record<SongColKey, boolean> = ALL_SONG_COLUMNS.reduce(
  (acc, col) => {
    acc[col.key] = true;
    return acc;
  },
  {} as Record<SongColKey, boolean>
);

const AEPI_NOTES_KEYS: SongColKey[] = ['aepi_percent', 'final_aepi_percent', 'notes'];

const INPUT_BASE =
  'w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600';

const CELL_INPUT =
  'w-full px-2 py-1 bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 focus:bg-white dark:focus:bg-slate-950 rounded focus:outline-none';

function renderFormattedLyrics(lyrics: string) {
  const lines = lyrics.split(/\r?\n/);
  if (!lyrics.trim()) {
    return (
      <p className="text-xs italic text-slate-400 dark:text-slate-500">
        Paste or type timestamped lyrics on the left (e.g. 0:10, [μουσική], 0:24, στίχοι...) to preview how they display in the app.
      </p>
    );
  }
  return lines.map((line, i) => {
    const trimmed = line.trim();
    const isTimestamp = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(trimmed);
    const isCue = /^\[.*\]$/.test(trimmed);
    return (
      <div
        key={i}
        className={
          isTimestamp
            ? 'font-mono-tabular text-[11px] font-semibold text-blue-700 dark:text-blue-400 mt-2 first:mt-0'
            : isCue
            ? 'text-xs italic text-amber-700 dark:text-amber-400'
            : 'text-sm text-slate-800 dark:text-slate-100 leading-relaxed'
        }
      >
        {trimmed || '\u00A0'}
      </div>
    );
  });
}

function summarizeLyricsCell(lyrics: string): string {
  const lines = (lyrics || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const sample = lines.slice(0, 2).join(' · ');
  return sample.length > 42 ? `${sample.slice(0, 40)}…` : sample;
}

export const AlbumSheetEditor: React.FC<AlbumSheetEditorProps> = ({
  album,
  saving,
  saveMessage,
  saveError,
  onChange,
  onSave,
  onBackToCatalog,
  onExportAlbum,
}) => {
  const [visibleCols, setVisibleCols] = useState<Record<SongColKey, boolean>>(DEFAULT_VISIBLE_COLS);
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const [activeDiscFilter, setActiveDiscFilter] = useState<'all' | number>('all');
  const [lyricsModalSongIdx, setLyricsModalSongIdx] = useState<number | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const stats = useMemo(() => computeAlbumStats(album.songs), [album.songs]);
  const validation = useMemo(() => validateAlbum(album), [album]);

  const discGroups = useMemo(() => {
    const map = new Map<number, Song[]>();
    album.songs.forEach((s) => {
      const disc =
        typeof s.disc_number === 'number' && Number.isFinite(s.disc_number)
          ? Math.max(1, Math.trunc(s.disc_number))
          : 1;
      const list = map.get(disc) || [];
      list.push(s);
      map.set(disc, list);
    });
    if (map.size === 0) map.set(1, []);
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([disc, songs]) => ({
        disc,
        songs,
        stats: computeAlbumStats(songs),
      }));
  }, [album.songs]);

  useEffect(() => {
    if (
      activeDiscFilter !== 'all' &&
      !discGroups.some((g) => g.disc === activeDiscFilter)
    ) {
      setActiveDiscFilter('all');
    }
  }, [discGroups, activeDiscFilter]);

  useEffect(() => {
    if (lyricsModalSongIdx === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLyricsModalSongIdx(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lyricsModalSongIdx]);

  const indexedVisibleSongs = useMemo(() => {
    const rows = album.songs.map((song, idx) => ({ song, idx }));
    if (activeDiscFilter === 'all') return rows;
    return rows.filter(
      ({ song }) =>
        (typeof song.disc_number === 'number' && Number.isFinite(song.disc_number)
          ? Math.max(1, Math.trunc(song.disc_number))
          : 1) === activeDiscFilter
    );
  }, [album.songs, activeDiscFilter]);

  const activeStats = useMemo(
    () => computeAlbumStats(indexedVisibleSongs.map((item) => item.song)),
    [indexedVisibleSongs]
  );

  const visibleColumnsList = useMemo(
    () => ALL_SONG_COLUMNS.filter((c) => visibleCols[c.key]),
    [visibleCols]
  );
  const hiddenColumnsList = useMemo(
    () => ALL_SONG_COLUMNS.filter((c) => !visibleCols[c.key]),
    [visibleCols]
  );

  const aepiAndNotesVisible = AEPI_NOTES_KEYS.some((k) => visibleCols[k]);

  const toggleColumn = (key: SongColKey) => {
    setVisibleCols((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setColumnVisible = (key: SongColKey, show: boolean) => {
    setVisibleCols((prev) => ({ ...prev, [key]: show }));
  };

  const showAllColumns = () => {
    setVisibleCols({ ...DEFAULT_VISIBLE_COLS });
  };

  const toggleAepiAndNotes = () => {
    const nextState = !aepiAndNotesVisible;
    setVisibleCols((prev) => ({
      ...prev,
      aepi_percent: nextState,
      final_aepi_percent: nextState,
      notes: nextState,
    }));
  };

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

  const addSongRow = (asMedleySubRow = false, targetDisc?: number) => {
    const nextIndex = album.songs.length;
    const chosenDisc =
      targetDisc ??
      (activeDiscFilter !== 'all'
        ? activeDiscFilter
        : discGroups[discGroups.length - 1]?.disc || 1);
    const newSong = createEmptySong(nextIndex, chosenDisc);
    if (asMedleySubRow) {
      newSong.track_no = '';
      newSong.full_track = false;
      newSong.pot_pouri = true;
    } else {
      const maxNumOnDisc = album.songs
        .filter((s) => Math.max(1, Math.trunc(s.disc_number || 1)) === chosenDisc)
        .reduce((m, s) => {
          const n = parseInt(s.track_no, 10);
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
      newSong.track_no = String(maxNumOnDisc + 1);
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
    if (targetDisc !== undefined) {
      setActiveDiscFilter(targetDisc);
    }
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
    if (lyricsModalSongIdx === idx) {
      setLyricsModalSongIdx(null);
    } else if (lyricsModalSongIdx !== null && lyricsModalSongIdx > idx) {
      setLyricsModalSongIdx(lyricsModalSongIdx - 1);
    }

    if (album.songs.length <= 1) {
      onChange({
        ...album,
        songs: [createEmptySong(0, 1)],
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

  const playlistHref = safeHttpUrl(album.cd_digital_playlist_link);
  const physicalHref = safeHttpUrl(album.physical_product_web_link);

  // Sticky positioning calculations for leading fixed-width columns (w-16 = 64px = left-16)
  const titleGrStickyClass = useMemo(() => {
    const leadOffset =
      (visibleCols.track_no ? 1 : 0) + (visibleCols.disc_number ? 1 : 0);
    if (leadOffset === 0) return 'sm:sticky sm:left-0 z-20';
    if (leadOffset === 1) return 'sm:sticky sm:left-16 z-20';
    return 'sm:sticky sm:left-32 z-20';
  }, [visibleCols.track_no, visibleCols.disc_number]);

  const titleGrCellStickyClass = useMemo(() => {
    const leadOffset =
      (visibleCols.track_no ? 1 : 0) + (visibleCols.disc_number ? 1 : 0);
    if (leadOffset === 0) return 'sm:sticky sm:left-0 z-10';
    if (leadOffset === 1) return 'sm:sticky sm:left-16 z-10';
    return 'sm:sticky sm:left-32 z-10';
  }, [visibleCols.track_no, visibleCols.disc_number]);

  const discStickyClass = visibleCols.track_no ? 'sticky left-16' : 'sticky left-0';

  const maxDisc = discGroups[discGroups.length - 1]?.disc || 1;

  // Compute exact footer cells summing cleanly to visibleColumnsList.length + 1 (Row column)
  const renderFooterRow = () => {
    const leadCount = (['track_no', 'disc_number', 'title_gr', 'title_en'] as SongColKey[]).filter(
      (k) => visibleCols[k]
    ).length;
    const durCount = (['duration_min', 'duration_sec'] as SongColKey[]).filter(
      (k) => visibleCols[k]
    ).length;
    const midCount = (
      [
        'aepi_percent',
        'isrc_code',
        'composer_gr',
        'songwriter_gr',
        'autodia_code',
        'iswc_code',
        'composer_en',
        'songwriter_en',
        'digital_web_link',
      ] as SongColKey[]
    ).filter((k) => visibleCols[k]).length;
    const trailCount = (['singer_gr', 'singer_en', 'notes', 'lyrics'] as SongColKey[]).filter(
      (k) => visibleCols[k]
    ).length;

    return (
      <tr>
        {leadCount > 0 && (
          <td
            colSpan={leadCount}
            className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 sm:sticky sm:left-0 bg-slate-50 dark:bg-slate-800"
          >
            {activeDiscFilter === 'all'
              ? 'ΣΥΝΟΛΙΚΗ ΔΙΑΡΚΕΙΑ & ΟΛΟΚΛΗΡΑ / ΠΟΤ-ΠΟΥΡΙ'
              : `CD ${activeDiscFilter} TOTALS & ΟΛΟΚΛΗΡΑ / ΠΟΤ-ΠΟΥΡΙ`}
          </td>
        )}
        {visibleCols.full_track && (
          <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-center font-mono-tabular text-blue-800 dark:text-blue-400">
            {activeStats.fullTrackCount}
          </td>
        )}
        {visibleCols.pot_pouri && (
          <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-center font-mono-tabular text-amber-800 dark:text-amber-400">
            {activeStats.potPouriCount}
          </td>
        )}
        {durCount > 0 && (
          <td
            colSpan={durCount}
            className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-mono-tabular"
          >
            {activeStats.formattedTime}
          </td>
        )}
        {visibleCols.total_seconds && (
          <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-mono-tabular">
            {activeStats.totalSeconds.toLocaleString()}.00
          </td>
        )}
        {midCount > 0 &&
          (visibleCols.final_aepi_percent ? (
            <td
              colSpan={midCount}
              className="py-2 px-3 border-r border-slate-200 dark:border-slate-700 text-right text-slate-500 dark:text-slate-400"
            >
              ΤΕΛΙΚΟ ΠΟΣΟΣΤΟ ΑΕΠΙ ΑΝΑ CD:
            </td>
          ) : (
            <td colSpan={midCount} className="border-r border-slate-200 dark:border-slate-700" />
          ))}
        {visibleCols.final_aepi_percent && (
          <td className="py-2 px-2 border-r border-slate-200 dark:border-slate-700 text-right font-mono-tabular">
            {activeStats.totalAepiPercent.toFixed(5)}
          </td>
        )}
        <td colSpan={trailCount + 1} />
      </tr>
    );
  };

  const renderColumnHeader = (col: SongColumnDef) => {
    let stickyClass = '';
    if (col.key === 'track_no') {
      stickyClass = 'sticky left-0 z-20 bg-slate-100 dark:bg-slate-800';
    } else if (col.key === 'disc_number') {
      stickyClass = `${discStickyClass} z-20 bg-slate-100 dark:bg-slate-800`;
    } else if (col.key === 'title_gr') {
      stickyClass = `${titleGrStickyClass} bg-slate-100 dark:bg-slate-800 sm:shadow-[2px_0_4px_-2px_rgba(15,23,42,0.12)] border-r-slate-300 dark:border-r-slate-700`;
    }

    return (
      <th
        key={col.key}
        className={`py-2 px-2 border-r border-slate-200 dark:border-slate-700 ${col.thBaseClass} ${stickyClass}`}
      >
        <div className="inline-flex items-center justify-between gap-1 w-full">
          <span className="truncate">{col.label}</span>
          <button
            type="button"
            onClick={() => setColumnVisible(col.key, false)}
            aria-label={`Hide ${col.shortLabel} column`}
            title={`Hide ${col.shortLabel} column`}
            className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors cursor-pointer shrink-0"
          >
            <EyeOff className="w-3 h-3" />
          </button>
        </div>
      </th>
    );
  };

  const activeLyricsSong =
    lyricsModalSongIdx !== null ? album.songs[lyricsModalSongIdx] ?? null : null;

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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 break-words">
                {album.id
                  ? `${album.catalog_number || 'Album'} — ${album.album_title || 'Untitled'}`
                  : 'New Album & Song Entry Sheet'}
              </h1>
              {stats.discCount > 1 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  <Disc className="w-3 h-3" />
                  <span>{stats.discCount} CDs</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              General album metadata, multi-CD spreadsheet grid with timestamped lyrics, and session musicians
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {album.id && onExportAlbum && (
            <>
              <button
                type="button"
                onClick={() => onExportAlbum(album.id!, 'xlsx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                onClick={() => onExportAlbum(album.id!, 'numbers')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export .numbers</span>
              </button>
            </>
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
              placeholder="CD / 2 CD / Vinyl / Digital"
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
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor="field-playlist-link" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                CD Digital Playlist Link
              </label>
              {playlistHref && (
                <a
                  href={playlistHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  <span>Open Playlist</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                id="field-playlist-link"
                type="url"
                value={album.cd_digital_playlist_link}
                onChange={(e) => updateField('cd_digital_playlist_link', e.target.value)}
                placeholder="https://youtube.com/playlist?list=..."
                className={`${INPUT_BASE} font-mono-tabular flex-1 min-w-0`}
              />
              {playlistHref && (
                <a
                  href={playlistHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open CD Digital Playlist Link in new tab"
                  title={`Open ${playlistHref}`}
                  className="p-2 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-md transition-colors shrink-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor="field-physical-link" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Physical Product Web Link
              </label>
              {physicalHref && (
                <a
                  href={physicalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  <span>Open Store Link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                id="field-physical-link"
                type="url"
                value={album.physical_product_web_link}
                onChange={(e) => updateField('physical_product_web_link', e.target.value)}
                placeholder="https://www.generalmusic.gr/shop/..."
                className={`${INPUT_BASE} font-mono-tabular flex-1 min-w-0`}
              />
              {physicalHref && (
                <a
                  href={physicalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open Physical Product Web Link in new tab"
                  title={`Open ${physicalHref}`}
                  className="p-2 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-md transition-colors shrink-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
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
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 id="songs-grid-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Songs Sheet (Ειδικό Πεδίο Τραγουδιών)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {stats.totalTracks} track rows · {stats.discCount} CD{stats.discCount > 1 ? 's' : ''} ·{' '}
              {stats.fullTrackCount} Full Tracks (ΟΛΟΚΛΗΡΟ) · {stats.potPouriCount} Pot-Pouri (ΠΟΤ - ΠΟΥΡΙ) ·{' '}
              {stats.totalSeconds.toLocaleString()} sec total
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowColumnsPanel((v) => !v)}
              aria-expanded={showColumnsPanel}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                showColumnsPanel || hiddenColumnsList.length > 0
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800'
                  : 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              <span>
                Columns ({visibleColumnsList.length}/{ALL_SONG_COLUMNS.length})
              </span>
            </button>

            <button
              type="button"
              onClick={toggleAepiAndNotes}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
            >
              {aepiAndNotesVisible ? 'Hide AEPI % & Notes' : 'Show AEPI % & Notes'}
            </button>

            <button
              type="button"
              onClick={() => addSongRow(false, maxDisc + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-md transition-colors cursor-pointer"
            >
              <Disc className="w-3.5 h-3.5" />
              <span>+ Add CD {maxDisc + 1}</span>
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

        {/* Multi-CD Filter & Summary Strip */}
        {(discGroups.length > 1 || activeDiscFilter !== 'all') && (
          <div className="px-4 sm:px-5 py-2.5 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 mr-1">
              Disc View:
            </span>
            <button
              type="button"
              onClick={() => setActiveDiscFilter('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                activeDiscFilter === 'all'
                  ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              All CDs ({album.songs.length})
            </button>
            {discGroups.map((group) => (
              <button
                key={group.disc}
                type="button"
                onClick={() => setActiveDiscFilter(group.disc)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                  activeDiscFilter === group.disc
                    ? 'bg-blue-700 dark:bg-blue-600 text-white border-blue-700 dark:border-blue-600'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Disc className="w-3 h-3" />
                <span>
                  CD {group.disc} ({group.songs.length} · {group.stats.formattedTime})
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Per-Column Hide/Show Manager Panel */}
        {showColumnsPanel && (
          <div className="px-4 sm:px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Show or Hide Individual Spreadsheet Columns
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={showAllColumns}
                  disabled={hiddenColumnsList.length === 0}
                  className="px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 disabled:opacity-45 rounded cursor-pointer"
                >
                  Show All Columns
                </button>
                <button
                  type="button"
                  onClick={() => setShowColumnsPanel(false)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {ALL_SONG_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded cursor-pointer hover:border-blue-400 dark:hover:border-blue-600"
                >
                  <input
                    type="checkbox"
                    checked={visibleCols[col.key]}
                    onChange={() => toggleColumn(col.key)}
                    className="w-3.5 h-3.5 accent-blue-700 cursor-pointer shrink-0"
                  />
                  <span className="truncate text-slate-700 dark:text-slate-200">{col.shortLabel}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Quick Restore Chips for Hidden Columns */}
        {hiddenColumnsList.length > 0 && (
          <div className="px-4 sm:px-5 py-2 bg-amber-50/70 dark:bg-amber-950/25 border-b border-amber-200/80 dark:border-amber-900/50 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-amber-900 dark:text-amber-300 mr-1">
              Hidden ({hiddenColumnsList.length}):
            </span>
            {hiddenColumnsList.map((col) => (
              <button
                key={col.key}
                type="button"
                onClick={() => setColumnVisible(col.key, true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded cursor-pointer"
              >
                <Eye className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>Show {col.shortLabel}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={showAllColumns}
              className="ml-auto px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Show All
            </button>
          </div>
        )}

        <div className="overflow-x-auto spreadsheet-scroll">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold">
                {visibleColumnsList.map(renderColumnHeader)}
                <th className="py-2 px-2 text-center whitespace-nowrap">
                  Row
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {indexedVisibleSongs.map(({ song, idx }) => {
                const rowHasError = attemptedSubmit && Boolean(validation.songErrors[idx]);
                const rowBg = rowHasError
                  ? 'bg-red-50/50 dark:bg-red-950/30'
                  : 'bg-white dark:bg-slate-900 hover:bg-slate-50/70 dark:hover:bg-slate-800/50';
                const stickyBg = rowHasError ? 'bg-red-50 dark:bg-red-950' : 'bg-white dark:bg-slate-900';
                const songSafeHref = safeHttpUrl(song.digital_web_link);
                const lyricsSummary = summarizeLyricsCell(song.lyrics);
                const lyricsLinesCount = (song.lyrics || '')
                  .split(/\r?\n/)
                  .filter((l) => l.trim().length > 0).length;

                return (
                  <tr key={idx} className={rowBg}>
                    {visibleCols.track_no && (
                      <td className={`p-1 border-r border-slate-200 dark:border-slate-800 sticky left-0 z-10 ${stickyBg}`}>
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} Track Number`}
                          value={song.track_no}
                          onChange={(e) => updateSong(idx, { track_no: e.target.value })}
                          className="w-14 px-1.5 py-1 text-center font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                        />
                      </td>
                    )}

                    {visibleCols.disc_number && (
                      <td className={`p-1 border-r border-slate-200 dark:border-slate-800 ${discStickyClass} z-10 ${stickyBg}`}>
                        <input
                          type="number"
                          min={1}
                          aria-label={`Row ${idx + 1} CD Number`}
                          value={song.disc_number ?? 1}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            updateSong(idx, {
                              disc_number: Number.isFinite(n) && n >= 1 ? n : 1,
                            });
                          }}
                          className="w-14 px-1.5 py-1 text-center font-mono-tabular bg-transparent text-slate-900 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-600 rounded focus:outline-none"
                        />
                      </td>
                    )}

                    {visibleCols.title_gr && (
                      <td className={`p-1 border-r border-slate-300 dark:border-slate-700 ${titleGrCellStickyClass} sm:shadow-[2px_0_4px_-2px_rgba(15,23,42,0.12)] ${stickyBg}`}>
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
                    )}

                    {visibleCols.title_en && (
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
                    )}

                    {visibleCols.full_track && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Row ${idx + 1} Full Track`}
                          checked={song.full_track}
                          onChange={(e) => updateSong(idx, { full_track: e.target.checked })}
                          className="w-4 h-4 accent-blue-700 cursor-pointer"
                        />
                      </td>
                    )}

                    {visibleCols.pot_pouri && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Row ${idx + 1} Pot-Pouri`}
                          checked={song.pot_pouri}
                          onChange={(e) => updateSong(idx, { pot_pouri: e.target.checked })}
                          className="w-4 h-4 accent-amber-600 cursor-pointer"
                        />
                      </td>
                    )}

                    {visibleCols.duration_min && (
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
                    )}

                    {visibleCols.duration_sec && (
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
                    )}

                    {visibleCols.total_seconds && (
                      <td className="px-2 py-1 border-r border-slate-200 dark:border-slate-800 text-right font-mono-tabular text-slate-600 dark:text-slate-300 bg-slate-50/70 dark:bg-slate-800/40">
                        {computeSongSeconds(song.duration_min, song.duration_sec).toFixed(2)}
                      </td>
                    )}

                    {visibleCols.aepi_percent && (
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

                    {visibleCols.isrc_code && (
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
                    )}

                    {visibleCols.composer_gr && (
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
                    )}

                    {visibleCols.songwriter_gr && (
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
                    )}

                    {visibleCols.autodia_code && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} Autodia Code`}
                          value={song.autodia_code}
                          onChange={(e) => updateSong(idx, { autodia_code: e.target.value })}
                          className={`${CELL_INPUT} font-mono-tabular`}
                        />
                      </td>
                    )}

                    {visibleCols.iswc_code && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} ISWC Code`}
                          value={song.iswc_code}
                          onChange={(e) => updateSong(idx, { iswc_code: e.target.value })}
                          className={`${CELL_INPUT} font-mono-tabular`}
                        />
                      </td>
                    )}

                    {visibleCols.composer_en && (
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
                    )}

                    {visibleCols.songwriter_en && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} Songwriter EN`}
                          value={song.songwriter_en}
                          onChange={(e) => updateSong(idx, { songwriter_en: e.target.value })}
                          className={CELL_INPUT}
                        />
                      </td>
                    )}

                    {visibleCols.digital_web_link && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            aria-label={`Row ${idx + 1} Digital Web Link`}
                            value={song.digital_web_link}
                            onChange={(e) => updateSong(idx, { digital_web_link: e.target.value })}
                            placeholder="https://..."
                            className={`${CELL_INPUT} font-mono-tabular flex-1 min-w-0`}
                          />
                          {songSafeHref && (
                            <a
                              href={songSafeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open track ${idx + 1} digital link`}
                              title={`Open ${songSafeHref}`}
                              className="p-1 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    )}

                    {visibleCols.final_aepi_percent && (
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

                    {visibleCols.singer_gr && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} Singer GR`}
                          value={song.singer_gr}
                          onChange={(e) => updateSong(idx, { singer_gr: e.target.value })}
                          className={CELL_INPUT}
                        />
                      </td>
                    )}

                    {visibleCols.singer_en && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <input
                          type="text"
                          aria-label={`Row ${idx + 1} Singer EN`}
                          value={song.singer_en}
                          onChange={(e) => updateSong(idx, { singer_en: e.target.value })}
                          className={CELL_INPUT}
                        />
                      </td>
                    )}

                    {visibleCols.notes && (
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

                    {visibleCols.lyrics && (
                      <td className="p-1 border-r border-slate-200 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setLyricsModalSongIdx(idx)}
                          aria-label={`Edit lyrics for row ${idx + 1}`}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1 text-left rounded border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <FileText
                              className={`w-3.5 h-3.5 shrink-0 ${
                                lyricsLinesCount > 0
                                  ? 'text-blue-700 dark:text-blue-400'
                                  : 'text-slate-400'
                              }`}
                            />
                            <span
                              className={`truncate text-xs ${
                                lyricsSummary
                                  ? 'text-slate-700 dark:text-slate-200'
                                  : 'text-slate-400 dark:text-slate-500 italic'
                              }`}
                            >
                              {lyricsSummary || 'Add lyrics...'}
                            </span>
                          </span>
                          {lyricsLinesCount > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono-tabular font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 rounded shrink-0">
                              {lyricsLinesCount}L
                            </span>
                          )}
                        </button>
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

            {/* Spreadsheet Summary Footer aligned dynamically with visible columns */}
            <tfoot className="bg-slate-50 dark:bg-slate-800/80 border-t-2 border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200">
              {renderFooterRow()}
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

      {/* Timestamped Lyrics Viewer & Editor Modal */}
      {activeLyricsSong && lyricsModalSongIdx !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lyrics-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/60 backdrop-blur-[2px]"
          onClick={() => setLyricsModalSongIdx(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 id="lyrics-modal-title" className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                  CD {activeLyricsSong.disc_number || 1} · Track {activeLyricsSong.track_no || lyricsModalSongIdx + 1} —{' '}
                  {activeLyricsSong.title_gr || activeLyricsSong.title_en || 'Untitled Track'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Timestamped Lyrics (Στίχοι) · Exported &amp; imported verbatim inside the ΣΤΙΧΟΙ column
                </p>
              </div>
              <button
                type="button"
                aria-label="Close lyrics editor"
                onClick={() => setLyricsModalSongIdx(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800 flex-1 overflow-hidden">
              <div className="p-4 flex flex-col gap-2 min-h-[240px]">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="lyrics-modal-textarea"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Edit Timestamped Lyrics
                  </label>
                  {activeLyricsSong.lyrics && (
                    <button
                      type="button"
                      onClick={() => updateSong(lyricsModalSongIdx, { lyrics: '' })}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                    >
                      Clear Lyrics
                    </button>
                  )}
                </div>
                <textarea
                  id="lyrics-modal-textarea"
                  value={activeLyricsSong.lyrics || ''}
                  onChange={(e) => updateSong(lyricsModalSongIdx, { lyrics: e.target.value })}
                  placeholder={`0:10\n[μουσική]\n0:24\nδεν θέλω παιδιά να\n0:28\nδεν θέλω παιδιά να αγαπώ`}
                  className="w-full flex-1 min-h-[260px] p-3 text-xs font-mono-tabular leading-relaxed bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                />
              </div>

              <div className="p-4 flex flex-col gap-2 overflow-y-auto spreadsheet-scroll max-h-[55vh] md:max-h-none bg-slate-50/40 dark:bg-slate-950/40">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Formatted Display Preview
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {renderFormattedLyrics(activeLyricsSong.lyrics || '')}
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLyricsModalSongIdx(null)}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};
