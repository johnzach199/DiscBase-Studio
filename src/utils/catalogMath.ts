import type { Album, Musician, Song, ValidationResult } from '../types/catalog';

export function computeSongSeconds(min: number | null | undefined, sec: number | null | undefined): number {
  const m = typeof min === 'number' && Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
  const s = typeof sec === 'number' && Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  return m * 60 + s;
}

export function formatSecondsAsTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function safeHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^www\./i.test(candidate) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export interface AlbumStats {
  totalSeconds: number;
  formattedTime: string;
  fullTrackCount: number;
  potPouriCount: number;
  totalTracks: number;
  totalAepiPercent: number;
  discCount: number;
}

export function computeAlbumStats(songs: Song[]): AlbumStats {
  let totalSeconds = 0;
  let fullTrackCount = 0;
  let potPouriCount = 0;
  let totalAepiPercent = 0;
  let maxDisc = 1;

  for (const song of songs) {
    const secs = computeSongSeconds(song.duration_min, song.duration_sec);
    totalSeconds += secs;
    if (song.full_track) fullTrackCount += 1;
    if (song.pot_pouri) potPouriCount += 1;
    if (typeof song.final_aepi_percent === 'number' && Number.isFinite(song.final_aepi_percent)) {
      totalAepiPercent += song.final_aepi_percent;
    }
    const disc = typeof song.disc_number === 'number' && Number.isFinite(song.disc_number) ? Math.max(1, Math.trunc(song.disc_number)) : 1;
    if (disc > maxDisc) maxDisc = disc;
  }

  return {
    totalSeconds,
    formattedTime: formatSecondsAsTime(totalSeconds),
    fullTrackCount,
    potPouriCount,
    totalTracks: songs.length,
    totalAepiPercent: Number(totalAepiPercent.toFixed(5)),
    discCount: songs.length > 0 ? maxDisc : 1,
  };
}

export function createEmptySong(sortOrder = 0, discNumber = 1): Song {
  return {
    disc_number: discNumber,
    track_no: String(sortOrder + 1),
    title_gr: '',
    title_en: '',
    duration_min: null,
    duration_sec: null,
    total_seconds: 0,
    full_track: true,
    pot_pouri: false,
    isrc_code: '',
    iswc_code: '',
    autodia_code: '',
    composer_gr: '',
    composer_en: '',
    songwriter_gr: '',
    songwriter_en: '',
    digital_web_link: '',
    singer_gr: '',
    singer_en: '',
    aepi_percent: null,
    final_aepi_percent: null,
    notes: '',
    lyrics: '',
    sort_order: sortOrder,
  };
}

export function createEmptyAlbum(): Album {
  return {
    barcode: '',
    catalog_number: '',
    label: '',
    phonographic_company: '',
    format: 'CD',
    album_artist: '',
    featured_artists: '',
    album_title: '',
    album_time: '00:00',
    total_seconds: 0,
    release_date: '',
    return_date: '',
    album_music_category: '',
    producer: '',
    production_company: '',
    print_design: '',
    cd_digital_playlist_link: '',
    physical_product_web_link: '',
    notes: '',
    musicians: [{ role: '', name: '', tracks: null, sort_order: 0 }],
    songs: [createEmptySong(0, 1)],
  };
}

export function createSampleTemplateAlbum(): Album {
  const sample = createEmptyAlbum();
  sample.phonographic_company = 'ΣΤΑΜΑΤΕΛΑΤΟΣ ΣΩΤΗΡΙΟΣ & ΣΙΑ Ο.Ε.';
  sample.catalog_number = 'GM 0000';
  sample.barcode = '5205299000000';
  sample.label = 'GM';
  sample.format = '2 CD';
  sample.album_title = 'SAMPLE MULTI-CD ALBUM';
  sample.album_artist = 'SAMPLE ARTIST';
  sample.album_music_category = 'Δημοτικα';
  sample.producer = 'PRODUCER NAME';
  sample.production_company = 'GENERAL MUSIC';
  sample.cd_digital_playlist_link = 'https://www.youtube.com/playlist?list=SAMPLE';
  sample.physical_product_web_link = 'https://www.generalmusic.gr/';

  const s1 = createEmptySong(0, 1);
  s1.track_no = '1';
  s1.title_gr = 'ΔΕΙΓΜΑ ΤΡΑΓΟΥΔΙΟΥ (CD 1)';
  s1.title_en = 'Sample Song (CD 1)';
  s1.duration_min = 3;
  s1.duration_sec = 20;
  s1.total_seconds = 200;
  s1.isrc_code = 'GRGM12600001';
  s1.singer_gr = 'SAMPLE ARTIST';
  s1.digital_web_link = 'https://www.youtube.com/watch?v=SAMPLE1';
  s1.lyrics = [
    '0:10',
    '[μουσική]',
    '0:24',
    'δεν θέλω παιδιά να',
    '0:28',
    'δεν θέλω παιδιά να αγαπώ',
    '0:30',
    'δεν θέλω πια να τη',
    '0:34',
    'δω μη με ρωτάτε γιατί μα ρωτήστε',
  ].join('\n');

  const s2 = createEmptySong(1, 2);
  s2.track_no = '1';
  s2.title_gr = 'ΔΕΙΓΜΑ ΤΡΑΓΟΥΔΙΟΥ (CD 2)';
  s2.title_en = 'Sample Song (CD 2)';
  s2.duration_min = 4;
  s2.duration_sec = 10;
  s2.total_seconds = 250;
  s2.isrc_code = 'GRGM12600002';
  s2.singer_gr = 'SAMPLE ARTIST';
  s2.digital_web_link = 'https://www.youtube.com/watch?v=SAMPLE2';
  s2.lyrics = '0:05\n[μουσική]\n0:18\nΣτίχοι δεύτερου δίσκου...';

  sample.songs = [s1, s2];
  const stats = computeAlbumStats(sample.songs);
  sample.total_seconds = stats.totalSeconds;
  sample.album_time = stats.formattedTime;
  sample.musicians = [{ role: 'Κλαρίνο', name: 'ΟΝΟΜΑ ΜΟΥΣΙΚΟΥ', tracks: '1,2', sort_order: 0 }];
  return sample;
}

export function validateAlbum(album: Album): ValidationResult {
  const errors: string[] = [];
  const songErrors: Record<number, string[]> = {};

  if (!album.album_title.trim()) {
    errors.push('Album Title is required.');
  }
  if (!album.catalog_number.trim() && !album.barcode.trim()) {
    errors.push('Either Catalog Number or Barcode is required.');
  }
  if (album.songs.length === 0) {
    errors.push('At least one song track is required.');
  }

  album.songs.forEach((song, idx) => {
    const rowErrs: string[] = [];
    if (!song.title_gr.trim() && !song.title_en.trim()) {
      rowErrs.push('Track needs Title GR or Title EN.');
    }
    if (song.duration_min !== null && (song.duration_min < 0 || !Number.isFinite(song.duration_min))) {
      rowErrs.push('Minutes must be 0 or higher.');
    }
    if (song.duration_sec !== null && (song.duration_sec < 0 || song.duration_sec > 59 || !Number.isFinite(song.duration_sec))) {
      rowErrs.push('Seconds must be between 0 and 59.');
    }
    if (rowErrs.length > 0) {
      songErrors[idx] = rowErrs;
    }
  });

  if (Object.keys(songErrors).length > 0) {
    errors.push(`${Object.keys(songErrors).length} track row(s) contain validation issues.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    songErrors,
  };
}

export interface AlbumIdentityLike {
  id?: number;
  barcode?: string | null;
  catalog_number?: string | null;
  album_title?: string | null;
  album_artist?: string | null;
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeMatchCode(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[\s-]+/g, '');
}

export function normalizeSearchText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ςΣ]/g, 'σ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSearchCode(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[\s\-_]+/g, '');
}

export function matchesAlbumSearch(album: Album, rawQuery: string): boolean {
  const qText = normalizeSearchText(rawQuery);
  const qCode = normalizeSearchCode(rawQuery);
  if (!qText && !qCode) return true;

  const textFields: Array<string | null | undefined> = [
    album.album_title,
    album.catalog_number,
    album.barcode,
    album.album_artist,
    album.featured_artists,
    album.label,
    album.phonographic_company,
    album.format,
    album.album_music_category,
    album.producer,
    album.production_company,
    album.print_design,
    album.notes,
  ];

  const codeFields: Array<string | null | undefined> = [
    album.catalog_number,
    album.barcode,
  ];

  for (const s of album.songs || []) {
    textFields.push(
      s.track_no,
      s.title_gr,
      s.title_en,
      s.isrc_code,
      s.iswc_code,
      s.autodia_code,
      s.composer_gr,
      s.composer_en,
      s.songwriter_gr,
      s.songwriter_en,
      s.singer_gr,
      s.singer_en,
      s.notes,
      s.lyrics
    );
    codeFields.push(s.isrc_code, s.iswc_code, s.autodia_code);
  }

  for (const m of album.musicians || []) {
    textFields.push(m.role, m.name, m.tracks || '');
  }

  if (qText && textFields.some((f) => normalizeSearchText(f).includes(qText))) {
    return true;
  }

  if (qCode.length >= 2 && codeFields.some((f) => normalizeSearchCode(f).includes(qCode))) {
    return true;
  }

  return false;
}

export function areAlbumsIdentical(a: AlbumIdentityLike, b: AlbumIdentityLike): boolean {
  const bcA = normalizeMatchCode(a.barcode);
  const bcB = normalizeMatchCode(b.barcode);
  const catA = normalizeMatchCode(a.catalog_number);
  const catB = normalizeMatchCode(b.catalog_number);
  const titleA = normalizeMatchText(a.album_title);
  const titleB = normalizeMatchText(b.album_title);
  const artistA = normalizeMatchText(a.album_artist);
  const artistB = normalizeMatchText(b.album_artist);

  if (bcA && bcB && bcA === bcB) {
    if (!catA || !catB || catA === catB || (titleA && titleA === titleB)) {
      return true;
    }
  }

  if (catA && catB && catA === catB && titleA && titleB && titleA === titleB) {
    if (!bcA || !bcB || bcA === bcB) {
      return true;
    }
  }

  if (catA && catB && catA === catB && artistA && artistB && artistA === artistB) {
    if ((!bcA || !bcB || bcA === bcB) && (!titleA || !titleB || titleA === titleB)) {
      return true;
    }
  }

  return false;
}

export function findDuplicateAlbum<T extends AlbumIdentityLike>(
  candidate: AlbumIdentityLike,
  existing: T[]
): T | null {
  for (const item of existing) {
    if (areAlbumsIdentical(candidate, item)) {
      return item;
    }
  }
  return null;
}

export interface BatchDeduplicationResult<T extends AlbumIdentityLike> {
  unique: T[];
  skipped: Array<{
    item: T;
    reason: 'database' | 'batch';
    matchedAlbum?: AlbumIdentityLike;
  }>;
}

export function deduplicateAlbumBatch<T extends AlbumIdentityLike>(
  candidates: T[],
  existingInDb: AlbumIdentityLike[]
): BatchDeduplicationResult<T> {
  const unique: T[] = [];
  const skipped: Array<{
    item: T;
    reason: 'database' | 'batch';
    matchedAlbum?: AlbumIdentityLike;
  }> = [];

  for (const candidate of candidates) {
    const dbMatch = findDuplicateAlbum(candidate, existingInDb);
    if (dbMatch) {
      skipped.push({ item: candidate, reason: 'database', matchedAlbum: dbMatch });
      continue;
    }

    const batchMatch = findDuplicateAlbum(candidate, unique);
    if (batchMatch) {
      skipped.push({ item: candidate, reason: 'batch', matchedAlbum: batchMatch });
      continue;
    }

    unique.push(candidate);
  }

  return { unique, skipped };
}

function cleanStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').trim();
}

function parseOptionalInt(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.round(v) : null;
  }
  const s = cleanStr(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseOptionalFloat(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Number(v.toPrecision(12)) : null;
  }
  const s = cleanStr(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Number(n.toPrecision(12)) : null;
}

function parseCheckFlag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v - 1) < 1e-4;
  const s = cleanStr(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'x' || s === '✓') return true;
  const num = Number(s);
  return s !== '' && Number.isFinite(num) && Math.abs(num - 1) < 1e-4;
}

function parseDiscCell(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const r = Math.round(v);
    if (Math.abs(v - r) < 1e-4 && r >= 1 && r <= 30) return r;
    return null;
  }
  const s = cleanStr(v);
  if (!s) return null;
  if (/^\d{1,2}(?:\.\d+)?$/.test(s)) {
    const num = Number(s);
    const r = Math.round(num);
    if (Number.isFinite(num) && Math.abs(num - r) < 1e-4 && r >= 1 && r <= 30) {
      return r;
    }
  }
  const m = s.match(/^(?:cd|disc|disk|δ[ιί]σκος)\s*[-_#:.]?\s*(\d{1,2})$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 30 ? n : null;
  }
  return null;
}

export function detectDiscNumberFromLabel(text: string): number | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  const standalone = cleaned.match(/^[-=\s*]*(?:cd|disc|disk|δ[ιί]σκος)\s*[-_#:.]?\s*(\d{1,2})[-=\s*]*$/i);
  if (standalone) {
    const n = parseInt(standalone[1], 10);
    return n >= 1 && n <= 30 ? n : null;
  }
  const suffix = cleaned.match(/\b(?:cd|disc|disk|δ[ιί]σκος)\s*[-_#:.]?\s*(\d{1,2})\b/i);
  if (suffix) {
    const n = parseInt(suffix[1], 10);
    return n >= 1 && n <= 30 ? n : null;
  }
  return null;
}

/**
 * RFC-4180 aware delimited parser supporting quoted multi-line cells (e.g. timestamped lyrics)
 * in both tab-delimited (TSV) and comma-delimited (CSV) pasted text.
 */
export function parseDelimitedText(text: string): unknown[][] {
  if (!text) return [];
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = text.includes('\t') && firstLine.includes('\t')
    ? '\t'
    : text.includes('\t')
    ? '\t'
    : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function extractLabeledTokens(text: string, labels: Array<{ key: string; patterns: RegExp[] }>): Record<string, string> {
  const out: Record<string, string> = {};
  const matches: Array<{ key: string; start: number; valueStart: number }> = [];

  for (const item of labels) {
    for (const pat of item.patterns) {
      const m = pat.exec(text);
      if (m) {
        matches.push({ key: item.key, start: m.index, valueStart: m.index + m[0].length });
        break;
      }
    }
  }

  matches.sort((a, b) => a.start - b.start);
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const rawVal = text.slice(cur.valueStart, nextStart).trim().replace(/^[:\s]+/, '').trim();
    if (rawVal) {
      out[cur.key] = rawVal;
    }
  }
  return out;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_LABELS = [
  { key: 'phonographic_company', patterns: [/ΦΩΝ\.?\s*ΕΤΑΙΡΙΑ\s*:/i, /PHONOGRAPHIC\s*COMPANY\s*:/i] },
  { key: 'label', patterns: [/LABEL\s*:/i] },
  { key: 'format', patterns: [/ΤΥΠΟΣ\s*:/i, /FORMAT\s*:/i] },
  { key: 'catalog_number', patterns: [/ΑΡ\.?\s*ΚΑΤΑΛΟΓΟΥ\s*:/i, /Aρ\.?\s*Καταλ\s*:/i, /CATALOG\s*NUMBER\s*:/i] },
  { key: 'album_artist', patterns: [/ΤΡΑΓΟΥΔΙΣΤΗΣ\s*:/i, /ALBUM\s*ARTIST\s*:/i] },
  { key: 'release_date', patterns: [/ΗΜ\.?\s*ΑΠΟΣΤΟΛΗΣ\s*:/i, /RELEASE\s*DATE\s*:/i] },
  { key: 'return_date', patterns: [/ΗΜ\.?\s*ΕΠΙΣΤΡΟΦΗΣ\s*:/i] },
  { key: 'barcode', patterns: [/Barcode\s*:/i] },
  { key: 'album_title', patterns: [/ΓΕΝΙΚΟΣ\s*ΤΙΤΛΟΣ\s*:/i, /ALBUM\s*TITLE\s*:/i] },
  { key: 'album_music_category', patterns: [/Κατηγορ[ιί]α\s*:/i, /Album\s*Music\s*Category\s*:/i] },
  { key: 'physical_product_web_link', patterns: [/Web\s*Link\s*CD\s*:/i, /Physical\s*Product\s*Web\s*link\s*:/i] },
  { key: 'cd_digital_playlist_link', patterns: [/CD\s*Digital\s*Playlist\s*link\s*:/i, /CD\s*Digital\s*Plallist\s*link\s*:/i] },
  { key: 'producer', patterns: [/Παραγωγ[όο]ς\s*:/i, /Producer\s*:/i] },
  { key: 'production_company', patterns: [/Παραγωγ[ήη]\s*:/i] },
  { key: 'print_design', patterns: [/Μακ[έε]τα[-\s/]*Εκτ[ύυ]πωση\s*:/i, /Μακ[έε]τα[-\s/]*Διαχωρισμο[ίι]\s*:/i] },
];

function isSongHeaderRow(normalizedCells: string[]): boolean {
  const hasTitle = normalizedCells.some(
    (c) => c.includes('τιτλος τραγουδιου') || c === 'title gr' || c === 'title_gr' || c === 'title en'
  );
  const hasIsrcOrMin = normalizedCells.some(
    (c) => c.includes('isrc') || c === 'min' || c === 'ολοκληρο' || c === 'full track'
  );
  return hasTitle && hasIsrcOrMin;
}

function buildColIdxMap(headerCells: string[]) {
  return {
    disc_number: headerCells.findIndex(
      (h) => h === 'cd' || h === 'disc' || h === 'disk' || h === 'cd #' || h === 'disc #' || h === 'δισκος'
    ),
    track_no: headerCells.findIndex((h) => h === 'a/a' || h === 'α/α' || h === 'track no' || h === '#'),
    title_gr: headerCells.findIndex((h) => h === 'τιτλος τραγουδιου' || h === 'title gr' || h === 'title_gr'),
    title_en: headerCells.findIndex(
      (h) => (h.includes('τιτλος τραγουδιου') && h.includes('eng')) || h === 'title en' || h === 'title_en'
    ),
    full_track: headerCells.findIndex((h) => h === 'ολοκληρο' || h === 'full track' || h === 'full_track'),
    pot_pouri: headerCells.findIndex((h) => h.includes('ποτ') || h.includes('pot pouri') || h === 'pot_pouri'),
    min: headerCells.findIndex((h) => h === 'min' || h === 'duration min'),
    sec: headerCells.findIndex((h) => h === 'sec' || h === 'duration sec'),
    isrc_code: headerCells.findIndex((h) => h.includes('isrc')),
    composer_gr: headerCells.findIndex((h) => h === 'συνθετης' || h === 'composer gr' || h === 'composer_gr'),
    composer_en: headerCells.findIndex((h) => h === 'composer en' || h === 'composer_en' || h.includes('δημιουργοι')),
    songwriter_gr: headerCells.findIndex((h) => h === 'στιχουργος' || h === 'songwriter gr' || h === 'songwriter_gr'),
    songwriter_en: headerCells.findIndex((h) => h === 'songwriter en' || h === 'songwriter_en'),
    autodia_code: headerCells.findIndex((h) => h.includes('autodia')),
    iswc_code: headerCells.findIndex((h) => h === 'iswc' || h === 'iswc code' || h === 'iswc_code'),
    digital_web_link: headerCells.findIndex((h) => h.includes('youtube') || h.includes('digital web link')),
    aepi_percent: headerCells.findIndex((h) => h === 'ποσοστο αεπι %' || h === 'ποσοστο αεπι%'),
    final_aepi_percent: headerCells.findIndex((h) => h.includes('τελικο ποσοστο αεπι')),
    singer_gr: headerCells.findIndex((h) => h === 'τραγουδιστης' || h === 'singer gr' || h === 'singer_gr'),
    singer_en: headerCells.findIndex((h) => h === 'singer en' || h === 'singer_en'),
    notes: headerCells.findIndex((h) => h === 'παρατηρησεις' || h === 'notes'),
    lyrics: headerCells.findIndex(
      (h) => !h.includes('στιχουργ') && (h === 'στιχοι' || h.startsWith('στιχοι') || h === 'lyrics' || h.includes('lyrics'))
    ),
  };
}

export function parseSpreadsheetRows(rows: unknown[][], defaultDiscNumber = 1): Album {
  const album = createEmptyAlbum();
  album.musicians = [];
  album.songs = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return createEmptyAlbum();
  }

  let headerRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const normalizedCells = Array.from(row, (c) => normalizeHeader(cleanStr(c)));
    if (isSongHeaderRow(normalizedCells)) {
      headerRowIdx = r;
      break;
    }
  }

  const metaEnd = headerRowIdx === -1 ? Math.min(rows.length, 15) : headerRowIdx;
  const extraArtistLines: string[] = [];

  for (let r = 0; r < metaEnd; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const denseCells = Array.from(row, cleanStr);
    const nonEmptyCells = denseCells.filter(Boolean);
    if (nonEmptyCells.length === 0) continue;

    const extracted: Record<string, string> = {};
    for (const cellText of nonEmptyCells) {
      const cellTokens = extractLabeledTokens(cellText, HEADER_LABELS);
      for (const [k, v] of Object.entries(cellTokens)) {
        if (!extracted[k]) extracted[k] = v;
      }
    }

    for (let c = 0; c < denseCells.length - 1; c++) {
      const k = denseCells[c];
      const v = denseCells[c + 1];
      if (!k || !v) continue;
      if (/^barcode\s*:?$/i.test(k) && !extracted.barcode) extracted.barcode = v;
      if (/^label\s*:?$/i.test(k) && !extracted.label) extracted.label = v;
      if (/^(τυπος|format)\s*:?$/i.test(k) && !extracted.format) extracted.format = v;
      if (/^(γενικος\s*τιτλος|album\s*title)\s*:?$/i.test(k) && !extracted.album_title) extracted.album_title = v;
      if (/^(αρ\.?\s*καταλογου|aρ\.?\s*καταλ|catalog\s*number)\s*:?$/i.test(k) && !extracted.catalog_number) {
        extracted.catalog_number = v;
      }
      if (/^(τραγουδιστης|album\s*artist)\s*:?$/i.test(k) && !extracted.album_artist) extracted.album_artist = v;
    }

    if (Object.keys(extracted).length === 0) {
      const joined = nonEmptyCells.join('   ');
      Object.assign(extracted, extractLabeledTokens(joined, HEADER_LABELS));
    }

    if (Object.keys(extracted).length === 0) {
      if (nonEmptyCells.length === 1 && album.album_artist && !album.album_title) {
        extraArtistLines.push(nonEmptyCells[0]);
      }
      continue;
    }

    if (extracted.phonographic_company) album.phonographic_company = extracted.phonographic_company;
    if (extracted.label) album.label = extracted.label;
    if (extracted.format) album.format = extracted.format;
    if (extracted.catalog_number) {
      const candidateCat = extracted.catalog_number.trim();
      if (
        !album.catalog_number ||
        (candidateCat.length <= 48 && candidateCat.length >= album.catalog_number.length)
      ) {
        album.catalog_number = candidateCat;
      }
    }
    if (extracted.album_artist) album.album_artist = extracted.album_artist;
    if (extracted.release_date) {
      const noteMatch = extracted.release_date.match(/\(Σημείωση\s*:?\s*([^)]+)\)/i);
      if (noteMatch) {
        album.notes = noteMatch[1].trim();
        album.release_date = extracted.release_date.replace(noteMatch[0], '').trim();
      } else {
        album.release_date = extracted.release_date;
      }
    }
    if (extracted.return_date) {
      const noteMatch = extracted.return_date.match(/\(Σημείωση\s*:?\s*([^)]+)\)/i);
      if (noteMatch) {
        album.notes = [album.notes, noteMatch[1].trim()].filter(Boolean).join(' | ');
        album.return_date = extracted.return_date.replace(noteMatch[0], '').trim();
      } else {
        album.return_date = extracted.return_date;
      }
    }
    if (extracted.barcode) album.barcode = extracted.barcode;
    if (extracted.album_title) album.album_title = extracted.album_title;
    if (extracted.physical_product_web_link) album.physical_product_web_link = extracted.physical_product_web_link;
    if (extracted.cd_digital_playlist_link) album.cd_digital_playlist_link = extracted.cd_digital_playlist_link;
  }

  if (extraArtistLines.length > 0) {
    album.featured_artists = extraArtistLines.join(' ').trim();
  }

  // Parse Song rows (supports both CD column & inline CD 1 / CD 2 section headers)
  let footerStartIdx = rows.length;
  let currentDiscNumber = Math.max(1, defaultDiscNumber);

  if (headerRowIdx !== -1) {
    const rawHeaderRow = Array.isArray(rows[headerRowIdx]) ? rows[headerRowIdx] : [];
    const headerCells = Array.from(rawHeaderRow, (c) => normalizeHeader(cleanStr(c)));
    let colIdx = buildColIdxMap(headerCells);

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = Array.isArray(rows[r]) ? rows[r] : [];
      const denseCells = Array.from(row, cleanStr);
      const nonEmptyCells = denseCells.filter(Boolean);
      if (nonEmptyCells.length === 0) continue;

      const rowJoined = nonEmptyCells.join(' ');

      if (
        /ΣΥΝΟΛΙΚΗ\s*ΔΙΑΡΚΕΙΑ|ΣΥΝΟΛΟ\s*ΟΛΟΚΛΗΡΩΝ|ΤΕΛΙΚΟ\s*ΠΟΣΟΣΤΟ|Έπαιξαν\s*οι\s*μουσικοί|Επαιξαν\s*οι\s*μουσικοί/i.test(
          rowJoined
        )
      ) {
        footerStartIdx = r;
        break;
      }

      // Check for inline repeated song header (e.g. CD 2 table header inside same sheet)
      const normalizedCells = denseCells.map((c) => normalizeHeader(c));
      if (isSongHeaderRow(normalizedCells)) {
        colIdx = buildColIdxMap(normalizedCells);
        continue;
      }

      // Check for inline CD section divider row like "CD 2", "Disc 2", "Δίσκος 2"
      if (nonEmptyCells.length <= 2) {
        const dividerDisc = detectDiscNumberFromLabel(nonEmptyCells[0]);
        if (dividerDisc !== null && !parseOptionalInt(colIdx.min >= 0 ? row[colIdx.min] : '')) {
          currentDiscNumber = dividerDisc;
          continue;
        }
      }

      const firstCell = cleanStr(row[0]);
      const titleCell = colIdx.title_gr >= 0 ? cleanStr(row[colIdx.title_gr]) : '';
      const titleEnCell = colIdx.title_en >= 0 ? cleanStr(row[colIdx.title_en]) : '';

      if (!titleCell && !titleEnCell && !firstCell) continue;
      if (!titleCell && !titleEnCell) continue;

      const rowDisc = colIdx.disc_number >= 0 ? parseDiscCell(row[colIdx.disc_number]) : null;
      const effectiveDisc = rowDisc ?? currentDiscNumber;
      if (rowDisc !== null) {
        currentDiscNumber = rowDisc;
      }

      const min = colIdx.min >= 0 ? parseOptionalInt(row[colIdx.min]) : null;
      const sec = colIdx.sec >= 0 ? parseOptionalInt(row[colIdx.sec]) : null;
      const total_seconds = computeSongSeconds(min, sec);

      const digitalLink = colIdx.digital_web_link >= 0 ? cleanStr(row[colIdx.digital_web_link]) : '';
      if (digitalLink && !album.cd_digital_playlist_link && digitalLink.includes('playlist')) {
        album.cd_digital_playlist_link = digitalLink;
      }

      const rawLyrics = colIdx.lyrics >= 0 ? cleanStr(row[colIdx.lyrics]) : '';

      const song: Song = {
        disc_number: effectiveDisc,
        track_no: colIdx.track_no >= 0 ? cleanStr(row[colIdx.track_no]) : String(album.songs.length + 1),
        title_gr: titleCell,
        title_en: titleEnCell,
        duration_min: min,
        duration_sec: sec,
        total_seconds,
        full_track: colIdx.full_track >= 0 ? parseCheckFlag(row[colIdx.full_track]) : false,
        pot_pouri: colIdx.pot_pouri >= 0 ? parseCheckFlag(row[colIdx.pot_pouri]) : false,
        isrc_code: colIdx.isrc_code >= 0 ? cleanStr(row[colIdx.isrc_code]) : '',
        iswc_code: colIdx.iswc_code >= 0 ? cleanStr(row[colIdx.iswc_code]) : '',
        autodia_code: colIdx.autodia_code >= 0 ? cleanStr(row[colIdx.autodia_code]) : '',
        composer_gr: colIdx.composer_gr >= 0 ? cleanStr(row[colIdx.composer_gr]) : '',
        composer_en: colIdx.composer_en >= 0 ? cleanStr(row[colIdx.composer_en]) : '',
        songwriter_gr: colIdx.songwriter_gr >= 0 ? cleanStr(row[colIdx.songwriter_gr]) : '',
        songwriter_en: colIdx.songwriter_en >= 0 ? cleanStr(row[colIdx.songwriter_en]) : '',
        digital_web_link: digitalLink,
        singer_gr: colIdx.singer_gr >= 0 ? cleanStr(row[colIdx.singer_gr]) : '',
        singer_en: colIdx.singer_en >= 0 ? cleanStr(row[colIdx.singer_en]) : '',
        aepi_percent: colIdx.aepi_percent >= 0 ? parseOptionalFloat(row[colIdx.aepi_percent]) : null,
        final_aepi_percent: colIdx.final_aepi_percent >= 0 ? parseOptionalFloat(row[colIdx.final_aepi_percent]) : null,
        notes: colIdx.notes >= 0 ? cleanStr(row[colIdx.notes]) : '',
        lyrics: rawLyrics,
        sort_order: album.songs.length,
      };

      album.songs.push(song);
    }
  }

  let inMusiciansSection = false;
  for (let r = footerStartIdx; r < rows.length; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const cells = Array.from(row, cleanStr).filter(Boolean);
    if (cells.length === 0) continue;

    let rowTracksOverride: string | null = null;
    const remainingCells: string[] = [];
    for (const cell of cells) {
      const tracksCellMatch = cell.match(/^(?:tracks?|τραγο[υύ]δια|κομμ[αά]τια)\s*:\s*(.*)$/i);
      if (inMusiciansSection && tracksCellMatch) {
        const cleanedTracks = tracksCellMatch[1].trim();
        rowTracksOverride = cleanedTracks || null;
      } else {
        remainingCells.push(cell);
      }
    }

    let rowAddedMusicianIdx = -1;
    for (const cell of remainingCells) {
      if (/Έπαιξαν\s*οι\s*μουσικοί|Επαιξαν\s*οι\s*μουσικοί|Musicians/i.test(cell)) {
        inMusiciansSection = true;
        continue;
      }

      const extracted = extractLabeledTokens(cell, HEADER_LABELS);
      if (extracted.physical_product_web_link) {
        album.physical_product_web_link = extracted.physical_product_web_link;
        continue;
      }
      if (extracted.cd_digital_playlist_link) {
        album.cd_digital_playlist_link = extracted.cd_digital_playlist_link;
        continue;
      }
      if (extracted.album_music_category) {
        album.album_music_category = extracted.album_music_category;
        continue;
      }
      if (extracted.producer) {
        album.producer = extracted.producer;
        inMusiciansSection = false;
        continue;
      }
      if (extracted.production_company) {
        album.production_company = extracted.production_company;
        inMusiciansSection = false;
        continue;
      }
      if (extracted.print_design) {
        album.print_design = extracted.print_design;
        inMusiciansSection = false;
        continue;
      }

      const colonIdx = cell.indexOf(':');
      if (inMusiciansSection && colonIdx > 0) {
        const role = cell.slice(0, colonIdx).trim();
        let name = cell.slice(colonIdx + 1).trim();
        let inlineTracks: string | null = null;
        const inlineMatch = name.match(/\s*[\[(](?:tracks?|τραγο[υύ]δια)\s*:\s*([^\]\)]+)[\])]\s*$/i);
        if (inlineMatch) {
          inlineTracks = inlineMatch[1].trim() || null;
          name = name.slice(0, inlineMatch.index).trim();
        }
        if (role && name && !/^https?/i.test(role)) {
          rowAddedMusicianIdx = album.musicians.length;
          album.musicians.push({
            role,
            name,
            tracks: rowTracksOverride ?? inlineTracks ?? null,
            sort_order: album.musicians.length,
          });
        }
      }
    }

    if (rowTracksOverride !== null && rowAddedMusicianIdx >= 0) {
      album.musicians[rowAddedMusicianIdx].tracks = rowTracksOverride;
    }
  }

  if (!album.producer && album.production_company) {
    album.producer = album.production_company;
  }

  const stats = computeAlbumStats(album.songs);
  album.total_seconds = stats.totalSeconds;
  album.album_time = stats.formattedTime;

  if (album.musicians.length === 0) {
    album.musicians = [{ role: '', name: '', tracks: null, sort_order: 0 }];
  }
  if (album.songs.length === 0) {
    album.songs = [createEmptySong(0, defaultDiscNumber)];
  }

  return album;
}

function songsHaveIdenticalTracklist(a: Song[], b: Song[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      normalizeMatchText(a[i].title_gr) !== normalizeMatchText(b[i].title_gr) ||
      normalizeMatchText(a[i].title_en) !== normalizeMatchText(b[i].title_en) ||
      normalizeMatchCode(a[i].isrc_code) !== normalizeMatchCode(b[i].isrc_code)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Converts multiple sheets inside a single `.xlsx` or `.numbers` workbook into Album records,
 * automatically merging `CD 1`, `CD 2`, `Disc 2`, ... tabs belonging to the same album
 * while keeping distinct albums on separate sheets separate.
 */
export function parseWorkbookSheetsToAlbums(
  sheets: Array<{ name: string; rows: unknown[][] }>
): Array<{ album: Album; sheetName: string }> {
  interface ParsedEntry {
    album: Album;
    sheetName: string;
    sheetDisc: number | null;
    hasSongs: boolean;
  }

  const parsedList: ParsedEntry[] = [];
  for (const sheet of sheets) {
    const sheetDisc = detectDiscNumberFromLabel(sheet.name);
    const parsed = parseSpreadsheetRows(sheet.rows, sheetDisc || 1);
    const realSongs = parsed.songs.filter((s) => s.title_gr.trim() || s.title_en.trim());
    if (realSongs.length === 0 && !parsed.album_title && !parsed.catalog_number) {
      continue;
    }
    if (!parsed.album_title && sheet.name && !sheetDisc) {
      parsed.album_title = sheet.name;
    }
    if (sheetDisc && parsed.songs.every((s) => (s.disc_number || 1) === 1)) {
      parsed.songs = parsed.songs.map((s) => ({ ...s, disc_number: sheetDisc }));
    }
    parsedList.push({
      album: parsed,
      sheetName: sheet.name,
      sheetDisc,
      hasSongs: realSongs.length > 0,
    });
  }

  const merged: Array<{ album: Album; sheetNames: string[] }> = [];

  for (const entry of parsedList) {
    let target = merged.find((m) => areAlbumsIdentical(m.album, entry.album));

    // Also merge an explicit CD 2 / Disc 2 sheet lacking its own catalog/barcode into previous album
    if (!target && entry.sheetDisc && entry.sheetDisc >= 2 && !entry.album.catalog_number && !entry.album.barcode && merged.length > 0) {
      target = merged[merged.length - 1];
    }

    if (target) {
      // If exact same album + exact same tracklist was pasted twice in two tabs, avoid doubling identical songs
      if (songsHaveIdenticalTracklist(target.album.songs, entry.album.songs) && !entry.sheetDisc) {
        continue;
      }

      const maxExistingDisc = target.album.songs.reduce(
        (m, s) => Math.max(m, s.disc_number || 1),
        1
      );
      const nextDisc =
        entry.sheetDisc && entry.sheetDisc > maxExistingDisc
          ? entry.sheetDisc
          : maxExistingDisc + 1;

      const appendedSongs = entry.album.songs
        .filter((s) => s.title_gr.trim() || s.title_en.trim())
        .map((s, idx) => ({
          ...s,
          disc_number: entry.sheetDisc || (s.disc_number > 1 ? s.disc_number : nextDisc),
          sort_order: target!.album.songs.length + idx,
        }));

      target.album.songs = [...target.album.songs, ...appendedSongs].map((s, idx) => ({
        ...s,
        sort_order: idx,
      }));

      // Fill any missing album-level metadata from subsequent CD sheets
      if (!target.album.cd_digital_playlist_link && entry.album.cd_digital_playlist_link) {
        target.album.cd_digital_playlist_link = entry.album.cd_digital_playlist_link;
      }
      if (!target.album.physical_product_web_link && entry.album.physical_product_web_link) {
        target.album.physical_product_web_link = entry.album.physical_product_web_link;
      }
      if (!target.album.album_music_category && entry.album.album_music_category) {
        target.album.album_music_category = entry.album.album_music_category;
      }
      if (!target.album.producer && entry.album.producer) {
        target.album.producer = entry.album.producer;
      }

      // Merge unique musicians
      const seenMusicians = new Set(
        target.album.musicians.map((m) => `${normalizeMatchText(m.role)}|${normalizeMatchText(m.name)}`)
      );
      for (const m of entry.album.musicians) {
        const key = `${normalizeMatchText(m.role)}|${normalizeMatchText(m.name)}`;
        if ((m.role || m.name) && !seenMusicians.has(key)) {
          seenMusicians.add(key);
          target.album.musicians.push({ ...m, sort_order: target.album.musicians.length });
        }
      }

      const stats = computeAlbumStats(target.album.songs);
      target.album.total_seconds = stats.totalSeconds;
      target.album.album_time = stats.formattedTime;
      if (stats.discCount > 1 && /^cd$/i.test(target.album.format.trim())) {
        target.album.format = `${stats.discCount} CD`;
      }
      if (entry.sheetName) {
        target.sheetNames.push(entry.sheetName);
      }
    } else {
      merged.push({
        album: entry.album,
        sheetNames: entry.sheetName ? [entry.sheetName] : [],
      });
    }
  }

  return merged.map((m) => ({
    album: m.album,
    sheetName: m.sheetNames.join(' + '),
  }));
}

export function buildWorkbookMatrix(album: Album): (string | number | null)[][] {
  const stats = computeAlbumStats(album.songs);
  const rows: (string | number | null)[][] = [];

  rows.push([
    `ΦΩΝ.ΕΤΑΙΡΙΑ : ${album.phonographic_company || ''}`,
    `LABEL : ${album.label || ''}`,
    `ΤΥΠΟΣ : ${album.format || 'CD'}`,
    `ΑΡ. ΚΑΤΑΛΟΓΟΥ : ${album.catalog_number || ''}`,
  ]);
  rows.push([
    `ΤΡΑΓΟΥΔΙΣΤΗΣ: ${album.album_artist || ''}`,
    `ΗΜ.ΑΠΟΣΤΟΛΗΣ : ${album.release_date || ''}`,
    album.return_date ? `ΗΜ.ΕΠΙΣΤΡΟΦΗΣ: ${album.return_date}` : '',
    `Barcode : ${album.barcode || ''}`,
  ]);
  if (album.featured_artists) {
    rows.push([album.featured_artists]);
  }
  rows.push([
    `Aρ.Καταλ: ${album.catalog_number || ''}`,
    '',
    '',
    `ΓΕΝΙΚΟΣ ΤΙΤΛΟΣ : ${album.album_title || ''}`,
  ]);

  rows.push([
    'A/A',
    'CD',
    'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ',
    'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ (eng)',
    'ΟΛΟΚΛΗΡΟ',
    'ΠΟΤ - ΠΟΥΡΙ',
    'min',
    'sec',
    'ΤΕΛΙΚΗ ΔΙΑΡΚΕΙΑ (sec)',
    'ΠΟΣΟΣΤΟ ΑΕΠΙ %',
    'ΚΩΔ. ISRC',
    'ΣΥΝΘΕΤΗΣ',
    'ΣΤΙΧΟΥΡΓΟΣ',
    'Autodia code',
    'ISWC',
    'Δημιουργοί (eng)',
    'Youtube link',
    'ΤΕΛΙΚΟ ΠΟΣΟΣΤΟ ΑΕΠΙ',
    'ΤΡΑΓΟΥΔΙΣΤΗΣ',
    'Singer EN',
    'Songwriter EN',
    'ΠΑΡΑΤΗΡΗΣΕΙΣ',
    'ΣΤΙΧΟΙ (Lyrics)',
  ]);

  for (const s of album.songs) {
    const secs = computeSongSeconds(s.duration_min, s.duration_sec);
    rows.push([
      s.track_no || null,
      s.disc_number || 1,
      s.title_gr,
      s.title_en,
      s.full_track ? 1 : null,
      s.pot_pouri ? 1 : null,
      s.duration_min,
      s.duration_sec,
      secs,
      s.aepi_percent,
      s.isrc_code,
      s.composer_gr,
      s.songwriter_gr,
      s.autodia_code,
      s.iswc_code,
      s.composer_en,
      s.digital_web_link || album.cd_digital_playlist_link,
      s.final_aepi_percent,
      s.singer_gr,
      s.singer_en,
      s.songwriter_en,
      s.notes,
      s.lyrics || '',
    ]);
  }

  rows.push([
    'ΣΥΝΟΛΙΚΗ ΔΙΑΡΚΕΙΑ ΤΡΑΓΟΥΔΙΩΝ',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    stats.totalSeconds,
  ]);
  rows.push([
    'ΣΥΝΟΛΟ ΟΛΟΚΛΗΡΩΝ & ΠΟΤ-ΠΟΥΡΙ',
    '',
    '',
    '',
    stats.fullTrackCount,
    stats.potPouriCount,
  ]);
  rows.push([
    'ΤΕΛΙΚΟ ΠΟΣΟΣΤΟ ΑΕΠΙ ΑΝΑ CD',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    stats.totalAepiPercent,
  ]);
  rows.push([]);
  rows.push([
    'Έπαιξαν οι μουσικοί:',
    '',
    '',
    `Web Link CD: ${album.physical_product_web_link || ''}`,
  ]);

  const activeMusicians = album.musicians.filter((m) => m.role.trim() || m.name.trim());
  activeMusicians.forEach((m, idx) => {
    const line = m.role && m.name ? `${m.role}: ${m.name}` : m.name || m.role;
    const tracksCell = m.tracks && m.tracks.trim() ? `Tracks: ${m.tracks.trim()}` : '';
    if (idx === 0) {
      rows.push([line, tracksCell, '', `Κατηγορια: ${album.album_music_category || ''}`]);
    } else if (idx === 1 && album.cd_digital_playlist_link) {
      rows.push([line, tracksCell, '', `CD Digital Playlist link: ${album.cd_digital_playlist_link}`]);
    } else if (tracksCell) {
      rows.push([line, tracksCell]);
    } else {
      rows.push([line]);
    }
  });

  if (activeMusicians.length === 0) {
    rows.push(['', '', '', `Κατηγορια: ${album.album_music_category || ''}`]);
  } else if (activeMusicians.length === 1 && album.cd_digital_playlist_link) {
    rows.push(['', '', '', `CD Digital Playlist link: ${album.cd_digital_playlist_link}`]);
  }

  rows.push([]);
  if (album.production_company) rows.push([`Παραγωγή: ${album.production_company}`]);
  if (album.producer) rows.push([`Παραγωγός: ${album.producer}`]);
  if (album.print_design) rows.push([`Μακέτα-Εκτύπωση: ${album.print_design}`]);

  return rows;
}
