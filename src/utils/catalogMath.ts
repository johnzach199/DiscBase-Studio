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

export interface AlbumStats {
  totalSeconds: number;
  formattedTime: string;
  fullTrackCount: number;
  potPouriCount: number;
  totalTracks: number;
  totalAepiPercent: number;
}

export function computeAlbumStats(songs: Song[]): AlbumStats {
  let totalSeconds = 0;
  let fullTrackCount = 0;
  let potPouriCount = 0;
  let totalAepiPercent = 0;

  for (const song of songs) {
    const secs = computeSongSeconds(song.duration_min, song.duration_sec);
    totalSeconds += secs;
    if (song.full_track) fullTrackCount += 1;
    if (song.pot_pouri) potPouriCount += 1;
    if (typeof song.final_aepi_percent === 'number' && Number.isFinite(song.final_aepi_percent)) {
      totalAepiPercent += song.final_aepi_percent;
    }
  }

  return {
    totalSeconds,
    formattedTime: formatSecondsAsTime(totalSeconds),
    fullTrackCount,
    potPouriCount,
    totalTracks: songs.length,
    totalAepiPercent: Number(totalAepiPercent.toFixed(5)),
  };
}

export function createEmptySong(sortOrder = 0): Song {
  return {
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
    musicians: [{ role: '', name: '', sort_order: 0 }],
    songs: [createEmptySong(0)],
  };
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

function cleanStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\u00a0/g, ' ').trim();
}

function parseOptionalInt(v: unknown): number | null {
  const s = cleanStr(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseOptionalFloat(v: unknown): number | null {
  const s = cleanStr(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseCheckFlag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = cleanStr(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'x' || s === '✓';
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

function normalizeHeader(h: string): string {
  return h
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

export function parseSpreadsheetRows(rows: unknown[][]): Album {
  const album = createEmptyAlbum();
  album.musicians = [];
  album.songs = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return createEmptyAlbum();
  }

  // Locate the song table header row
  let headerRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const normalizedCells = row.map((c) => normalizeHeader(cleanStr(c)));
    const hasTitle = normalizedCells.some(
      (c) => c.includes('τιτλος τραγουδιου') || c === 'title gr' || c === 'title_gr'
    );
    const hasIsrcOrMin = normalizedCells.some(
      (c) => c.includes('isrc') || c === 'min' || c === 'ολοκληρο' || c === 'full track'
    );
    if (hasTitle && hasIsrcOrMin) {
      headerRowIdx = r;
      break;
    }
  }

  // Parse header/general metadata rows above the song table
  const metaEnd = headerRowIdx === -1 ? Math.min(rows.length, 15) : headerRowIdx;
  const extraArtistLines: string[] = [];

  for (let r = 0; r < metaEnd; r++) {
    const row = rows[r] || [];
    const nonEmptyCells = row.map(cleanStr).filter(Boolean);
    if (nonEmptyCells.length === 0) continue;

    // Join cells with double-space so regex token extraction handles both merged single-cell and split-cell Excel layouts
    const joined = nonEmptyCells.join('   ');
    const extracted = extractLabeledTokens(joined, HEADER_LABELS);

    // Also handle adjacent cell pairs like ["Barcode", "5205299033028"]
    for (let c = 0; c < row.length - 1; c++) {
      const k = cleanStr(row[c]);
      const v = cleanStr(row[c + 1]);
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
      // Check if it's a featured artists continuation line (like in 4314 row 3)
      if (nonEmptyCells.length === 1 && album.album_artist && !album.album_title) {
        extraArtistLines.push(nonEmptyCells[0]);
      }
      continue;
    }

    if (extracted.phonographic_company) album.phonographic_company = extracted.phonographic_company;
    if (extracted.label) album.label = extracted.label;
    if (extracted.format) album.format = extracted.format;
    if (extracted.catalog_number) {
      // Keep the cleaner catalog number if e.g. "4314" then "GM 4314"
      if (!album.catalog_number || extracted.catalog_number.length >= album.catalog_number.length) {
        album.catalog_number = extracted.catalog_number;
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
  }

  if (extraArtistLines.length > 0) {
    album.featured_artists = extraArtistLines.join(' ').trim();
  }

  // Parse Song rows
  let footerStartIdx = rows.length;
  if (headerRowIdx !== -1) {
    const headerCells = (rows[headerRowIdx] || []).map((c) => normalizeHeader(cleanStr(c)));
    const colIdx = {
      track_no: headerCells.findIndex((h) => h === 'a/a' || h === 'α/α' || h === 'track no' || h === '#'),
      title_gr: headerCells.findIndex((h) => h === 'τιτλος τραγουδιου' || h === 'title gr' || h === 'title_gr'),
      title_en: headerCells.findIndex((h) => h.includes('τιτλος τραγουδιου') && h.includes('eng') || h === 'title en' || h === 'title_en'),
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
    };

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const firstCell = cleanStr(row[0]);
      const titleCell = colIdx.title_gr >= 0 ? cleanStr(row[colIdx.title_gr]) : '';
      const titleEnCell = colIdx.title_en >= 0 ? cleanStr(row[colIdx.title_en]) : '';
      const rowJoined = row.map(cleanStr).filter(Boolean).join(' ');

      if (!rowJoined) continue;

      if (
        /ΣΥΝΟΛΙΚΗ\s*ΔΙΑΡΚΕΙΑ|ΣΥΝΟΛΟ\s*ΟΛΟΚΛΗΡΩΝ|ΤΕΛΙΚΟ\s*ΠΟΣΟΣΤΟ|Έπαιξαν\s*οι\s*μουσικοί|Επαιξαν\s*οι\s*μουσικοί/i.test(
          rowJoined
        )
      ) {
        footerStartIdx = r;
        break;
      }

      if (!titleCell && !titleEnCell && !firstCell) continue;
      if (!titleCell && !titleEnCell) continue;

      const min = colIdx.min >= 0 ? parseOptionalInt(row[colIdx.min]) : null;
      const sec = colIdx.sec >= 0 ? parseOptionalInt(row[colIdx.sec]) : null;
      const total_seconds = computeSongSeconds(min, sec);

      const digitalLink = colIdx.digital_web_link >= 0 ? cleanStr(row[colIdx.digital_web_link]) : '';
      if (digitalLink && !album.cd_digital_playlist_link && digitalLink.includes('playlist')) {
        album.cd_digital_playlist_link = digitalLink;
      }

      const song: Song = {
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
        sort_order: album.songs.length,
      };

      album.songs.push(song);
    }
  }

  // Parse footer block (Musicians, Web Link CD, Category, Producer, Production, Print)
  let inMusiciansSection = false;
  for (let r = footerStartIdx; r < rows.length; r++) {
    const row = rows[r] || [];
    const cells = row.map(cleanStr).filter(Boolean);
    if (cells.length === 0) continue;

    for (const cell of cells) {
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

      // Check for "Instrument: Musician Name"
      const colonIdx = cell.indexOf(':');
      if (inMusiciansSection && colonIdx > 0) {
        const role = cell.slice(0, colonIdx).trim();
        const name = cell.slice(colonIdx + 1).trim();
        if (role && name && !/^https?/i.test(role)) {
          album.musicians.push({
            role,
            name,
            sort_order: album.musicians.length,
          });
        }
      }
    }
  }

  // If Producer wasn't labeled separately, fallback to production_company
  if (!album.producer && album.production_company) {
    album.producer = album.production_company;
  }

  // Compute Album Time from tracks
  const stats = computeAlbumStats(album.songs);
  album.total_seconds = stats.totalSeconds;
  album.album_time = stats.formattedTime;

  if (album.musicians.length === 0) {
    album.musicians = [{ role: '', name: '', sort_order: 0 }];
  }
  if (album.songs.length === 0) {
    album.songs = [createEmptySong(0)];
  }

  return album;
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
  ]);

  for (const s of album.songs) {
    const secs = computeSongSeconds(s.duration_min, s.duration_sec);
    rows.push([
      s.track_no || null,
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
    stats.totalSeconds,
  ]);
  rows.push([
    'ΣΥΝΟΛΟ ΟΛΟΚΛΗΡΩΝ & ΠΟΤ-ΠΟΥΡΙ',
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
    if (idx === 0) {
      rows.push([line, '', '', `Κατηγορια: ${album.album_music_category || ''}`]);
    } else if (idx === 1 && album.cd_digital_playlist_link) {
      rows.push([line, '', '', `CD Digital Playlist link: ${album.cd_digital_playlist_link}`]);
    } else {
      rows.push([line]);
    }
  });

  if (activeMusicians.length === 0) {
    rows.push(['', '', '', `Κατηγορια: ${album.album_music_category || ''}`]);
  }

  rows.push([]);
  if (album.production_company) rows.push([`Παραγωγή: ${album.production_company}`]);
  if (album.producer) rows.push([`Παραγωγός: ${album.producer}`]);
  if (album.print_design) rows.push([`Μακέτα-Εκτύπωση: ${album.print_design}`]);

  return rows;
}
