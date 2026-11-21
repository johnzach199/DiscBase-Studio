import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  CopyCheck,
  Download,
  FileSpreadsheet,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Album, AlbumSummary } from '../types/catalog';
import {
  buildWorkbookMatrix,
  computeAlbumStats,
  createEmptyAlbum,
  findDuplicateAlbum,
  validateAlbum,
} from '../utils/catalogMath';

interface XlsxImporterProps {
  existingAlbums: AlbumSummary[];
  onImportComplete: (importedCount: number) => Promise<void>;
  onOpenInEditor: (album: Album) => void;
}

interface QueuedImportItem {
  queueId: string;
  filename: string;
  sheetName: string;
  album: Album;
}

type QueueItemStatus = 'ready' | 'duplicate-db' | 'duplicate-batch' | 'invalid';

const SUPPORTED_EXT_RE = /\.(xlsx|xls|csv|tsv|txt)$/i;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function makeQueueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const XlsxImporter: React.FC<XlsxImporterProps> = ({
  existingAlbums,
  onImportComplete,
  onOpenInEditor,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<string>('');
  const [committing, setCommitting] = useState(false);
  const [queuedItems, setQueuedItems] = useState<QueuedImportItem[]>([]);
  const [fullCatalogAlbums, setFullCatalogAlbums] = useState<AlbumSummary[]>(existingAlbums);
  const [pasteText, setPasteText] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const refreshFullCatalog = async () => {
    try {
      const res = await fetch('/api/albums');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.albums)) {
          setFullCatalogAlbums(data.albums);
          return;
        }
      }
    } catch {
      // Fallback to prop list
    }
    setFullCatalogAlbums(existingAlbums);
  };

  useEffect(() => {
    void refreshFullCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingAlbums.length]);

  const analyzedQueue = useMemo(() => {
    const seenUniqueAlbums: Album[] = [];
    return queuedItems.map((item) => {
      const validation = validateAlbum(item.album);
      const dbMatch = findDuplicateAlbum(item.album, fullCatalogAlbums);
      if (dbMatch) {
        return {
          item,
          validation,
          status: 'duplicate-db' as QueueItemStatus,
          matchedLabel: `${dbMatch.catalog_number || dbMatch.barcode || 'Catalog'} · ${dbMatch.album_title || 'Existing Album'}`,
        };
      }

      if (!validation.valid) {
        return {
          item,
          validation,
          status: 'invalid' as QueueItemStatus,
          matchedLabel: '',
        };
      }

      const batchMatch = findDuplicateAlbum(item.album, seenUniqueAlbums);
      if (batchMatch) {
        return {
          item,
          validation,
          status: 'duplicate-batch' as QueueItemStatus,
          matchedLabel: `${batchMatch.catalog_number || batchMatch.barcode || 'Batch'} · ${batchMatch.album_title || 'Earlier in Queue'}`,
        };
      }

      seenUniqueAlbums.push(item.album);
      return {
        item,
        validation,
        status: 'ready' as QueueItemStatus,
        matchedLabel: '',
      };
    });
  }, [queuedItems, fullCatalogAlbums]);

  const summaryCounts = useMemo(() => {
    let ready = 0;
    let duplicateDb = 0;
    let duplicateBatch = 0;
    let invalid = 0;
    const files = new Set<string>();

    for (const entry of analyzedQueue) {
      files.add(entry.item.filename);
      if (entry.status === 'ready') ready++;
      else if (entry.status === 'duplicate-db') duplicateDb++;
      else if (entry.status === 'duplicate-batch') duplicateBatch++;
      else invalid++;
    }

    return {
      total: analyzedQueue.length,
      fileCount: files.size,
      ready,
      duplicateDb,
      duplicateBatch,
      duplicatesTotal: duplicateDb + duplicateBatch,
      invalid,
    };
  }, [analyzedQueue]);

  const handleFiles = async (fileList: FileList | File[]) => {
    const allFiles = Array.from(fileList || []);
    if (allFiles.length === 0) return;

    setError(null);
    setSuccessMsg(null);

    const validFiles = allFiles.filter((f) => SUPPORTED_EXT_RE.test(f.name));
    const skippedUnsupported = allFiles.filter((f) => !SUPPORTED_EXT_RE.test(f.name));

    if (validFiles.length === 0) {
      setError('No supported spreadsheet files found (.xlsx, .xls, .csv, .tsv, .txt).');
      return;
    }

    setParsing(true);
    const collectedItems: QueuedImportItem[] = [];
    const failedFiles: string[] = [];

    try {
      await refreshFullCatalog();

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        setParseProgress(`Parsing file ${i + 1} of ${validFiles.length}: ${file.name}`);
        try {
          const arrayBuf = await file.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuf);
          const res = await fetch('/api/import/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, filename: file.name }),
          });
          const data = await res.json();
          if (!res.ok) {
            failedFiles.push(`${file.name} (${data.error || 'parse error'})`);
            continue;
          }

          const items: Array<{ album: Album; sheetName?: string; filename?: string }> =
            Array.isArray(data.items) && data.items.length > 0
              ? data.items
              : (data.albums || []).map((album: Album) => ({
                  album,
                  sheetName: '',
                  filename: file.name,
                }));

          if (items.length === 0) {
            failedFiles.push(`${file.name} (no album/song sheets detected)`);
            continue;
          }

          for (const entry of items) {
            collectedItems.push({
              queueId: makeQueueId(),
              filename: entry.filename || file.name,
              sheetName: entry.sheetName || '',
              album: entry.album,
            });
          }
        } catch (fileErr) {
          failedFiles.push(
            `${file.name} (${fileErr instanceof Error ? fileErr.message : 'unreadable file'})`
          );
        }
      }

      if (collectedItems.length > 0) {
        setQueuedItems((prev) => [...prev, ...collectedItems]);
      }

      const warnings: string[] = [];
      if (skippedUnsupported.length > 0) {
        warnings.push(
          `Ignored unsupported file(s): ${skippedUnsupported.map((f) => f.name).join(', ')}.`
        );
      }
      if (failedFiles.length > 0) {
        warnings.push(`Could not parse: ${failedFiles.join('; ')}.`);
      }
      if (warnings.length > 0) {
        setError(warnings.join(' '));
      }
    } finally {
      setParsing(false);
      setParseProgress('');
    }
  };

  const handlePasteParse = async () => {
    if (!pasteText.trim()) return;
    setError(null);
    setSuccessMsg(null);
    setParsing(true);
    setParseProgress('Parsing pasted spreadsheet rows...');
    try {
      await refreshFullCatalog();
      const res = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText, filename: 'Pasted Sheet Text' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse pasted rows');

      const albums: Album[] = data.albums || [];
      if (albums.length === 0) {
        setError('No recognizable album or song table was found in the pasted text.');
        return;
      }

      setQueuedItems((prev) => [
        ...prev,
        ...albums.map((album) => ({
          queueId: makeQueueId(),
          filename: 'Pasted Sheet Text',
          sheetName: '',
          album,
        })),
      ]);
      setPasteText('');
      setShowPasteBox(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setParsing(false);
      setParseProgress('');
    }
  };

  const handleRemoveItem = (queueId: string) => {
    setQueuedItems((prev) => prev.filter((item) => item.queueId !== queueId));
  };

  const handleClearDuplicates = () => {
    const duplicateIds = new Set(
      analyzedQueue
        .filter((x) => x.status === 'duplicate-db' || x.status === 'duplicate-batch')
        .map((x) => x.item.queueId)
    );
    setQueuedItems((prev) => prev.filter((item) => !duplicateIds.has(item.queueId)));
  };

  const handleClearQueue = () => {
    setQueuedItems([]);
    setError(null);
  };

  const handleCommitAll = async () => {
    const readyEntries = analyzedQueue.filter((x) => x.status === 'ready');
    if (readyEntries.length === 0) return;

    setError(null);
    setSuccessMsg(null);
    setCommitting(true);
    try {
      const CHUNK_SIZE = 40;
      let importedCount = 0;
      let serverSkippedCount = 0;
      const allFailed: Array<{ catalog_number?: string; album_title?: string; error?: string }> = [];

      for (let i = 0; i < readyEntries.length; i += CHUNK_SIZE) {
        const chunk = readyEntries.slice(i, i + CHUNK_SIZE);
        setParseProgress(
          `Importing ${Math.min(i + chunk.length, readyEntries.length)} of ${readyEntries.length} albums...`
        );
        const res = await fetch('/api/import/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ albums: chunk.map((x) => x.item.album) }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to save imported albums');
        }
        importedCount += data.importedCount ?? 0;
        serverSkippedCount += data.skippedCount ?? 0;
        if (Array.isArray(data.failedAlbums)) {
          allFailed.push(...data.failedAlbums);
        }
      }

      const totalSkipped = summaryCounts.duplicatesTotal + serverSkippedCount;
      const failedKeys = new Set(
        allFailed.map(
          (f) =>
            `${(f.catalog_number || '').trim().toLowerCase()}|${(f.album_title || '').trim().toLowerCase()}`
        )
      );

      const remaining = analyzedQueue
        .filter((x) => {
          if (x.status === 'invalid') return true;
          if (x.status === 'ready') {
            const key = `${(x.item.album.catalog_number || '').trim().toLowerCase()}|${(x.item.album.album_title || '').trim().toLowerCase()}`;
            return failedKeys.has(key);
          }
          return false;
        })
        .map((x) => x.item);
      setQueuedItems(remaining);

      if (allFailed.length > 0) {
        const firstErr = allFailed[0];
        setError(
          `${allFailed.length} album(s) failed to save (e.g. "${firstErr?.album_title || 'Untitled'}": ${firstErr?.error || 'database error'}).`
        );
      }

      if (totalSkipped > 0) {
        setSuccessMsg(
          `Imported ${importedCount} new album(s) into the database. Skipped ${totalSkipped} duplicate album(s).`
        );
      } else if (importedCount > 0) {
        setSuccessMsg(`Successfully imported ${importedCount} album(s) into the database.`);
      }

      await Promise.all([onImportComplete(importedCount), refreshFullCatalog()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database import failed');
    } finally {
      setCommitting(false);
      setParseProgress('');
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
            Upload as many Excel workbooks (.xlsx, .xls, .csv) at once as needed. Identical releases already in the database or repeated across uploaded files are automatically skipped.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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

      {/* Multi-file Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
        className={`bg-white dark:bg-slate-900 border-2 border-dashed rounded-lg p-6 sm:p-10 text-center transition-colors ${
          dragActive
            ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          aria-label="Upload spreadsheet files"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleFiles(e.target.files);
            }
            e.target.value = '';
          }}
        />
        <FileSpreadsheet className="w-10 h-10 text-blue-700 dark:text-blue-400 mx-auto" />
        <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
          Drop multiple .xlsx workbooks here, or select files from disk
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
          Select any number of .xlsx, .xls, or .csv files together — or add more batches to the queue below. Duplicate albums are detected automatically by barcode, catalog number, and title.
        </p>
        <button
          type="button"
          disabled={parsing}
          onClick={() => fileInputRef.current?.click()}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-60 rounded-lg cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          <span>{parsing ? parseProgress || 'Parsing Workbooks...' : 'Select .xlsx / .csv Files'}</span>
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
              Add Pasted Sheet to Queue
            </button>
          </div>
        </div>
      )}

      {/* Parsed Preview Queue */}
      {analyzedQueue.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4">
            <div className="space-y-1.5 min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Import Queue — {summaryCounts.fileCount} File(s) · {summaryCounts.total} Album Sheet(s)
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{summaryCounts.ready} Ready to Import</span>
                </span>
                {summaryCounts.duplicatesTotal > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                    <CopyCheck className="w-3.5 h-3.5" />
                    <span>
                      {summaryCounts.duplicatesTotal} Duplicate(s) Skipped ({summaryCounts.duplicateDb} in DB, {summaryCounts.duplicateBatch} in batch)
                    </span>
                  </span>
                )}
                {summaryCounts.invalid > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{summaryCounts.invalid} Validation Issue(s)</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {summaryCounts.duplicatesTotal > 0 && (
                <button
                  type="button"
                  onClick={handleClearDuplicates}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800 rounded-lg cursor-pointer"
                >
                  <CopyCheck className="w-3.5 h-3.5" />
                  <span>Remove Duplicates</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleClearQueue}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Queue</span>
              </button>
              <button
                type="button"
                disabled={committing || summaryCounts.ready === 0}
                onClick={handleCommitAll}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {committing
                    ? 'Importing...'
                    : summaryCounts.ready > 0
                    ? `Import ${summaryCounts.ready} New Album(s)`
                    : 'No New Albums to Import'}
                </span>
              </button>
            </div>
          </div>

          {analyzedQueue.map(({ item, validation, status, matchedLabel }) => {
            const { album } = item;
            const stats = computeAlbumStats(album.songs);
            const isDuplicate = status === 'duplicate-db' || status === 'duplicate-batch';

            return (
              <div
                key={item.queueId}
                className={`bg-white dark:bg-slate-900 border rounded-lg overflow-hidden ${
                  isDuplicate
                    ? 'border-amber-300 dark:border-amber-800/80 opacity-85'
                    : status === 'invalid'
                    ? 'border-red-300 dark:border-red-800/80'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/50">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 truncate max-w-xs">
                        {item.filename}
                        {item.sheetName ? ` · ${item.sheetName}` : ''}
                      </span>
                      <span className="font-mono-tabular text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {album.catalog_number || 'No Catalog #'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 break-words">
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

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {status === 'ready' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Ready to Import</span>
                      </span>
                    )}

                    {status === 'duplicate-db' && (
                      <span
                        title={matchedLabel}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 rounded-md"
                      >
                        <CopyCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>Already in Database (Skipped)</span>
                      </span>
                    )}

                    {status === 'duplicate-batch' && (
                      <span
                        title={matchedLabel}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 rounded-md"
                      >
                        <CopyCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>Duplicate in Upload Batch (Skipped)</span>
                      </span>
                    )}

                    {status === 'invalid' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        <span>{validation.errors[0]}</span>
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenInEditor(album)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md cursor-pointer"
                    >
                      <span>Open in Editor</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      aria-label={`Remove ${album.album_title || item.filename} from queue`}
                      onClick={() => handleRemoveItem(item.queueId)}
                      className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 rounded-md cursor-pointer"
                    >
                      <X className="w-4 h-4" />
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
