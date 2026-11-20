import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  ArrowRight,
  ClipboardPaste,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Album } from '../types/catalog';
import {
  buildWorkbookMatrix,
  computeAlbumStats,
  createEmptyAlbum,
  validateAlbum,
} from '../utils/catalogMath';
import { ThemeToggle, type ThemeMode } from './ThemeToggle';

interface XlsxImporterProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onImportComplete: (importedCount: number) => Promise<void>;
  onOpenInEditor: (album: Album) => void;
}

export const XlsxImporter: React.FC<XlsxImporterProps> = ({
  theme,
  onThemeChange,
  onImportComplete,
  onOpenInEditor,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [sourceFilename, setSourceFilename] = useState<string>('');
  const [parsedAlbums, setParsedAlbums] = useState<Album[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setSuccessMsg(null);
    setParsing(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const res = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, filename: file.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse workbook');
      }
      setSourceFilename(file.name);
      setParsedAlbums(data.albums || []);
      if (!data.albums || data.albums.length === 0) {
        setError('No recognizable album or song table was found in this workbook.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read spreadsheet file');
    } finally {
      setParsing(false);
    }
  };

  const handlePasteParse = async () => {
    if (!pasteText.trim()) return;
    setError(null);
    setSuccessMsg(null);
    setParsing(true);
    try {
      const res = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText, filename: 'pasted-sheet.tsv' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse pasted rows');
      setSourceFilename('Pasted Spreadsheet Data');
      setParsedAlbums(data.albums || []);
      setShowPasteBox(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  };

  const handleCommitAll = async () => {
    if (parsedAlbums.length === 0) return;
    setError(null);
    setSuccessMsg(null);
    setCommitting(true);
    try {
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albums: parsedAlbums }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save imported albums');
      }
      setSuccessMsg(`Successfully imported ${data.importedCount} album(s) into the database.`);
      setParsedAlbums([]);
      setSourceFilename('');
      await onImportComplete(data.importedCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database import failed');
    } finally {
      setCommitting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const sample = createEmptyAlbum();
    sample.catalog_number = 'GM 0000';
    sample.barcode = '5205299000000';
    sample.label = 'GM';
    sample.format = 'CD';
    sample.album_title = 'SAMPLE ALBUM TITLE';
    sample.album_artist = 'SAMPLE ARTIST';
    sample.album_music_category = 'Δημοτικα';
    sample.producer = 'PRODUCER NAME';
    sample.songs[0].title_gr = 'ΔΕΙΓΜΑ ΤΡΑΓΟΥΔΙΟΥ';
    sample.songs[0].title_en = 'Sample Song';
    sample.songs[0].duration_min = 3;
    sample.songs[0].duration_sec = 20;
    sample.songs[0].isrc_code = 'GRGM12600001';
    sample.musicians = [{ role: 'Κλαρίνο', name: 'ΟΝΟΜΑ ΜΟΥΣΙΚΟΥ', sort_order: 0 }];

    const matrix = buildWorkbookMatrix(sample);
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'discbase_import_template.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            XLSX Spreadsheet Batch Import
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Upload Excel workbooks (.xlsx, .xls, .csv) formatted like your catalog sheets to extract General Fields, Songs, and Musicians automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <ThemeToggle theme={theme} onChange={onThemeChange} />

          <button
            type="button"
            onClick={() => setShowPasteBox((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <ClipboardPaste className="w-4 h-4" />
            <span>{showPasteBox ? 'Hide Paste Box' : 'Paste Sheet Text'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download Template (.xlsx)</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200 text-sm rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div role="status" className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-sm rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={`bg-white dark:bg-slate-900 border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
          dragActive
            ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          aria-label="Upload spreadsheet file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <FileSpreadsheet className="w-10 h-10 text-blue-700 dark:text-blue-400 mx-auto" />
        <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
          Drop your .xlsx workbook here, or browse from disk
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
          Supports multi-sheet Excel workbooks matching the General Music layout (4314 / 4128) as well as Protupo template exports.
        </p>
        <button
          type="button"
          disabled={parsing}
          onClick={() => fileInputRef.current?.click()}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          <span>{parsing ? 'Parsing Workbook...' : 'Select .xlsx / .csv File'}</span>
        </button>
      </div>

      {/* Paste TSV/CSV Text Alternative */}
      {showPasteBox && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <label htmlFor="paste-sheet-input" className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
            Paste Tab-Delimited Rows Directly from Excel / Calc
          </label>
          <textarea
            id="paste-sheet-input"
            rows={8}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste copied rows starting from ΦΩΝ.ΕΤΑΙΡΙΑ down through Παραγωγή / Μακέτα..."
            className="w-full p-3 text-xs font-mono-tabular bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handlePasteParse}
              disabled={!pasteText.trim() || parsing}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              Parse Pasted Rows
            </button>
          </div>
        </div>
      )}

      {/* Parsed Preview */}
      {parsedAlbums.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Import Preview — {sourceFilename}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Detected {parsedAlbums.length} album sheet(s). Review extracted fields before committing to the database.
              </p>
            </div>
            <button
              type="button"
              disabled={committing}
              onClick={handleCommitAll}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{committing ? 'Importing...' : `Import ${parsedAlbums.length} Album(s) to Database`}</span>
            </button>
          </div>

          {parsedAlbums.map((album, idx) => {
            const stats = computeAlbumStats(album.songs);
            const validation = validateAlbum(album);
            return (
              <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/50">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono-tabular text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {album.catalog_number || 'No Catalog #'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {album.album_title || 'Untitled Album'}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Artist: {album.album_artist || '—'} · Barcode: {album.barcode || '—'} · Label:{' '}
                      {album.label || '—'} · Category: {album.album_music_category || '—'} ·{' '}
                      {stats.totalTracks} Tracks ({stats.fullTrackCount} Full / {stats.potPouriCount} Pot-Pouri) ·{' '}
                      {stats.formattedTime} · {album.musicians.filter((m) => m.name).length} Musicians
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        validation.valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {validation.valid ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Ready to Import</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4" />
                          <span>{validation.errors[0]}</span>
                        </>
                      )}
                    </span>

                    <button
                      type="button"
                      onClick={() => onOpenInEditor(album)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md cursor-pointer"
                    >
                      <span>Open in Editor</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="py-2 px-3">A/A</th>
                        <th className="py-2 px-3">Title GR</th>
                        <th className="py-2 px-3">Title EN</th>
                        <th className="py-2 px-3 text-center">Full</th>
                        <th className="py-2 px-3 text-center">Pot</th>
                        <th className="py-2 px-3 text-right">Duration</th>
                        <th className="py-2 px-3">ISRC</th>
                        <th className="py-2 px-3">Composer GR</th>
                        <th className="py-2 px-3">Singer GR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {album.songs.map((s, sIdx) => (
                        <tr key={sIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-1.5 px-3 font-mono-tabular text-slate-700 dark:text-slate-300">{s.track_no || '—'}</td>
                          <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-slate-100">{s.title_gr}</td>
                          <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">{s.title_en}</td>
                          <td className="py-1.5 px-3 text-center font-mono-tabular text-slate-700 dark:text-slate-300">
                            {s.full_track ? '1' : ''}
                          </td>
                          <td className="py-1.5 px-3 text-center font-mono-tabular text-slate-700 dark:text-slate-300">
                            {s.pot_pouri ? '1' : ''}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                            {s.duration_min ?? 0}:{String(s.duration_sec ?? 0).padStart(2, '0')}
                          </td>
                          <td className="py-1.5 px-3 font-mono-tabular text-slate-700 dark:text-slate-300">{s.isrc_code}</td>
                          <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">{s.composer_gr}</td>
                          <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">{s.singer_gr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
