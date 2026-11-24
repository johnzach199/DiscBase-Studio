import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import initSqlJs from 'sql.js';
import {
  areAlbumsIdentical,
  buildWorkbookMatrix,
  computeAlbumStats,
  computeSongSeconds,
  createEmptyAlbum,
  createEmptySong,
  createSampleTemplateAlbum,
  deduplicateAlbumBatch,
  findDuplicateAlbum,
  formatSecondsAsTime,
  parseDelimitedText,
  parseSpreadsheetRows,
  parseWorkbookSheetsToAlbums,
  safeHttpUrl,
  validateAlbum,
} from './catalogMath';
import { buildNumbersBuffer } from '../../server/numbersCodec';
import { CatalogDatabase } from '../../server/db';

test('computeSongSeconds and formatSecondsAsTime compute durations accurately', () => {
  assert.equal(computeSongSeconds(2, 50), 170);
  assert.equal(computeSongSeconds(0, 52), 52);
  assert.equal(computeSongSeconds(null, 30), 30);
  assert.equal(formatSecondsAsTime(170), '02:50');
  assert.equal(formatSecondsAsTime(3640), '1:00:40');
});

test('validateAlbum rejects missing title/catalog and invalid seconds', () => {
  const album = createEmptyAlbum();
  const res = validateAlbum(album);
  assert.equal(res.valid, false);
  assert.ok(res.errors.length >= 2);

  album.album_title = 'ΖΩΝΤΑΝΑ ΣΤΑ ΑΡΑΧΩΒΙΤΙΚΑ';
  album.catalog_number = 'GM 4314';
  album.songs[0].title_gr = 'Ο ΛΙΟΥΛΙΟΣ';
  album.songs[0].duration_min = 2;
  album.songs[0].duration_sec = 50;
  assert.equal(validateAlbum(album).valid, true);

  album.songs[0].duration_sec = 75;
  assert.equal(validateAlbum(album).valid, false);
});

test('parseSpreadsheetRows accurately parses 4314.txt tab-delimited sheet', () => {
  const filePath = path.resolve(process.cwd(), 'public/assets/aistudio/4314_ed51755c.txt');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = raw.split(/\r?\n/).map((line) => line.split('\t'));
  const parsed = parseSpreadsheetRows(rows);

  assert.equal(parsed.label, 'GM');
  assert.equal(parsed.format, 'CD');
  assert.equal(parsed.catalog_number, 'GM 4314');
  assert.equal(parsed.barcode, '5205299033028');
  assert.equal(parsed.album_title, 'ΖΩΝΤΑΝΑ ΣΤΑ ΑΡΑΧΩΒΙΤΙΚΑ');
  assert.equal(parsed.album_artist, 'ΔΙΑΦΟΡΟΙ');
  assert.equal(parsed.album_music_category, 'Δημοτικα');
  assert.equal(parsed.producer, 'ΑΝΔΡΕΑΣ ΣΤΑΜΑΤΕΛΑΤΟΣ');
  assert.equal(parsed.physical_product_web_link, 'https://www.generalmusic.gr/shop/dimotika/zontana-sta-arachobitika/');

  assert.equal(parsed.songs.length, 28);
  assert.equal(parsed.musicians.length, 5);
  assert.equal(parsed.musicians[0].role, 'Κλαρίνο');
  assert.equal(parsed.musicians[0].name, 'ΚΩΣΤΑΣ ΑΡΙΣΤΟΠΟΥΛΟΣ');

  const stats = computeAlbumStats(parsed.songs);
  assert.equal(stats.totalSeconds, 3640);
  assert.equal(stats.fullTrackCount, 21);
  assert.equal(stats.potPouriCount, 7);
});

test('parseSpreadsheetRows accurately parses 4128.txt tab-delimited sheet', () => {
  const filePath = path.resolve(process.cwd(), 'public/assets/aistudio/4128_c22d6e72.txt');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = raw.split(/\r?\n/).map((line) => line.split('\t'));
  const parsed = parseSpreadsheetRows(rows);

  assert.equal(parsed.catalog_number, 'GM 4128');
  assert.equal(parsed.barcode, '5205299000808');
  assert.equal(parsed.album_title, 'ΤΑ ΧΟΡΕΥΤΙΚΑ - (ΔΙΟΡΘΩΤΙΚΟ)');
  assert.equal(parsed.album_artist, 'ΑΝΝΟΥΛΑ ΤΣΑΧΑΛΟΥ');
  assert.equal(parsed.producer, 'ΑΝΔΡΕΑΣ ΣΤΑΜΑΤΕΛΑΤΟΣ');
  assert.equal(parsed.production_company, 'GENERAL MUSIC');

  assert.equal(parsed.songs.length, 21);
  assert.equal(parsed.musicians.length, 5);

  const stats = computeAlbumStats(parsed.songs);
  assert.equal(stats.totalSeconds, 3425);
  assert.equal(stats.fullTrackCount, 16);
  assert.equal(stats.potPouriCount, 5);
});

test('buildWorkbookMatrix round-trips through parseSpreadsheetRows cleanly', () => {
  const album = createEmptyAlbum();
  album.catalog_number = 'GM 9001';
  album.barcode = '5205299999999';
  album.label = 'GM';
  album.format = 'CD';
  album.album_artist = 'TEST ARTIST';
  album.album_title = 'TEST ALBUM';
  album.album_music_category = 'Δημοτικα';
  album.producer = 'TEST PRODUCER';
  album.physical_product_web_link = 'https://example.com/cd';
  album.musicians = [{ role: 'Κλαρίνο', name: 'ΚΩΣΤΑΣ', sort_order: 0 }];

  const s1 = createEmptySong(0);
  s1.track_no = '1';
  s1.title_gr = 'ΤΡΑΓΟΥΔΙ 1';
  s1.title_en = 'Song 1';
  s1.duration_min = 3;
  s1.duration_sec = 15;
  s1.full_track = true;
  s1.pot_pouri = false;
  s1.isrc_code = 'GRGM12600001';
  album.songs = [s1];

  const matrix = buildWorkbookMatrix(album);
  const parsed = parseSpreadsheetRows(matrix);

  assert.equal(parsed.catalog_number, 'GM 9001');
  assert.equal(parsed.barcode, '5205299999999');
  assert.equal(parsed.album_title, 'TEST ALBUM');
  assert.equal(parsed.songs.length, 1);
  assert.equal(parsed.songs[0].title_gr, 'ΤΡΑΓΟΥΔΙ 1');
  assert.equal(parsed.songs[0].total_seconds, 195);
  assert.equal(parsed.musicians[0].role, 'Κλαρίνο');
});

test('areAlbumsIdentical, findDuplicateAlbum, and deduplicateAlbumBatch prevent identical releases', () => {
  const dbAlbums = [
    {
      id: 1,
      catalog_number: 'GM 4314',
      barcode: '5205299033028',
      album_title: 'ΖΩΝΤΑΝΑ ΣΤΑ ΑΡΑΧΩΒΙΤΙΚΑ',
      album_artist: 'ΔΙΑΦΟΡΟΙ',
    },
  ];

  // Identical barcode with whitespace/case differences matches DB
  assert.equal(
    areAlbumsIdentical(dbAlbums[0], {
      catalog_number: 'gm-4314',
      barcode: ' 5205299033028 ',
      album_title: 'ζωντανα στα αραχωβιτικα',
    }),
    true
  );

  // Distinct release does NOT match
  assert.equal(
    areAlbumsIdentical(dbAlbums[0], {
      catalog_number: 'GM 5001',
      barcode: '5205299099999',
      album_title: 'ΝΕΟΣ ΔΙΣΚΟΣ',
      album_artist: 'ΝΕΟΣ ΚΑΛΛΙΤΕΧΝΗΣ',
    }),
    false
  );

  const batch = [
    {
      catalog_number: 'GM-4314',
      barcode: '5205299033028',
      album_title: 'ΖΩΝΤΑΝΑ ΣΤΑ ΑΡΑΧΩΒΙΤΙΚΑ',
      album_artist: 'ΔΙΑΦΟΡΟΙ',
    },
    {
      catalog_number: 'GM 5001',
      barcode: '5205299050011',
      album_title: 'ΔΙΣΚΟΣ Α',
      album_artist: 'ΚΑΛΛΙΤΕΧΝΗΣ Α',
    },
    {
      catalog_number: 'gm5001',
      barcode: '5205299050011',
      album_title: 'δισκος α',
      album_artist: 'ΚΑΛΛΙΤΕΧΝΗΣ Α',
    },
    {
      catalog_number: 'GM 5002',
      barcode: '5205299050028',
      album_title: 'ΔΙΣΚΟΣ Β',
      album_artist: 'ΚΑΛΛΙΤΕΧΝΗΣ Β',
    },
  ];

  assert.ok(findDuplicateAlbum(batch[0], dbAlbums));
  assert.equal(findDuplicateAlbum(batch[1], dbAlbums), null);

  const result = deduplicateAlbumBatch(batch, dbAlbums);
  assert.equal(result.unique.length, 2);
  assert.equal(result.unique[0].catalog_number, 'GM 5001');
  assert.equal(result.unique[1].catalog_number, 'GM 5002');
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped[0].reason, 'database');
  assert.equal(result.skipped[1].reason, 'batch');
});

test('parseSpreadsheetRows handles sparse rows with empty holes and prevents catalog_number spillover', () => {
  // Simulate SheetJS row arrays with empty holes (`new Array(...)` sparse slots)
  const sparseHeader: unknown[] = [];
  sparseHeader[2] = 'A/A';
  sparseHeader[3] = 'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ';
  sparseHeader[5] = 'min';
  sparseHeader[6] = 'sec';
  sparseHeader[8] = 'ΚΩΔ. ISRC';

  const sparseSong: unknown[] = [];
  sparseSong[2] = '1';
  sparseSong[3] = 'ΤΡΑΓΟΥΔΙ ΣΕ SPARSE ROW';
  sparseSong[5] = '3';
  sparseSong[6] = '25';
  sparseSong[8] = 'GRGM12600952';

  const metaRow: unknown[] = [];
  metaRow[0] = 'ΑΡ. ΚΑΤΑΛΟΓΟΥ : 952';
  metaRow[3] = 'ΠΟΛΥ ΜΕΓΑΛΗ ΣΗΜΕΙΩΣΗ ΠΟΥ ΔΕΝ ΠΡΕΠΕΙ ΝΑ ΜΠΕΙ ΣΤΟΝ ΑΡΙΘΜΟ ΚΑΤΑΛΟΓΟΥ '.repeat(3);

  const titleRow: unknown[] = [];
  titleRow[1] = 'ΓΕΝΙΚΟΣ ΤΙΤΛΟΣ : ΔΙΣΚΟΣ 952';

  const parsed = parseSpreadsheetRows([metaRow, titleRow, sparseHeader, sparseSong]);
  assert.equal(parsed.catalog_number, '952');
  assert.equal(parsed.album_title, 'ΔΙΣΚΟΣ 952');
  assert.equal(parsed.songs.length, 1);
  assert.equal(parsed.songs[0].title_gr, 'ΤΡΑΓΟΥΔΙ ΣΕ SPARSE ROW');
  assert.equal(parsed.songs[0].total_seconds, 205);
});

test('safeHttpUrl validates http/https links and blocks dangerous schemes', () => {
  assert.equal(safeHttpUrl('https://www.generalmusic.gr/shop/'), 'https://www.generalmusic.gr/shop/');
  assert.equal(safeHttpUrl('www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<script>'), null);
  assert.equal(safeHttpUrl('file:///etc/passwd'), null);
  assert.equal(safeHttpUrl('   '), null);
});

test('parseDelimitedText preserves quoted multi-line timestamped Greek lyrics cleanly', () => {
  const lyricsSample = [
    '0:10',
    '[μουσική]',
    '0:24',
    'δεν θέλω παιδιά να',
    '0:28',
    'δεν θέλω παιδιά να αγαπώ',
    '1:11',
    '[μουσική]',
  ].join('\n');

  const csv = [
    'A/A,CD,ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ,min,sec,ΣΤΙΧΟΥΡΓΟΣ,ΣΤΙΧΟΙ (Lyrics)',
    `1,1,"ΔΕΝ ΘΕΛΩ ΠΑΙΔΙΑ",3,45,"ΣΤΙΧΟΥΡΓΟΣ Α","${lyricsSample}"`,
    '2,2,"ΔΕΥΤΕΡΟΣ ΔΙΣΚΟΣ",4,10,"ΣΤΙΧΟΥΡΓΟΣ Β","0:05\n[μουσική]"',
  ].join('\n');

  const rows = parseDelimitedText(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][5], 'ΣΤΙΧΟΥΡΓΟΣ Α');
  assert.equal(rows[1][6], lyricsSample);

  const parsed = parseSpreadsheetRows(rows);
  assert.equal(parsed.songs.length, 2);
  assert.equal(parsed.songs[0].disc_number, 1);
  assert.equal(parsed.songs[0].songwriter_gr, 'ΣΤΙΧΟΥΡΓΟΣ Α');
  assert.equal(parsed.songs[0].lyrics, lyricsSample);
  assert.equal(parsed.songs[1].disc_number, 2);
});

test('parseWorkbookSheetsToAlbums merges CD 1 + CD 2 tabs while keeping distinct albums separate', () => {
  const sheetCd1 = [
    ['ΑΡ. ΚΑΤΑΛΟΓΟΥ : GM 7777', 'Barcode : 5205299777777', 'ΓΕΝΙΚΟΣ ΤΙΤΛΟΣ : ΔΙΠΛΟΣ ΔΙΣΚΟΣ'],
    ['A/A', 'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ', 'min', 'sec'],
    ['1', 'ΤΡΑΓΟΥΔΙ CD 1', '3', '10'],
  ];
  const sheetCd2 = [
    ['A/A', 'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ', 'min', 'sec'],
    ['1', 'ΤΡΑΓΟΥΔΙ CD 2', '4', '20'],
  ];
  const distinctAlbumSheet = [
    ['ΑΡ. ΚΑΤΑΛΟΓΟΥ : GM 8888', 'Barcode : 5205299888888', 'ΓΕΝΙΚΟΣ ΤΙΤΛΟΣ : ΑΛΛΟΣ ΔΙΣΚΟΣ'],
    ['A/A', 'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ', 'min', 'sec'],
    ['1', 'ΑΛΛΟ ΤΡΑΓΟΥΔΙ', '2', '30'],
  ];

  const albums = parseWorkbookSheetsToAlbums([
    { name: 'CD 1', rows: sheetCd1 },
    { name: 'CD 2', rows: sheetCd2 },
    { name: 'GM 8888', rows: distinctAlbumSheet },
  ]);

  assert.equal(albums.length, 2);
  assert.equal(albums[0].album.catalog_number, 'GM 7777');
  assert.equal(albums[0].album.songs.length, 2);
  assert.equal(albums[0].album.songs[0].disc_number, 1);
  assert.equal(albums[0].album.songs[1].disc_number, 2);
  assert.equal(computeAlbumStats(albums[0].album.songs).discCount, 2);
  assert.equal(albums[1].album.catalog_number, 'GM 8888');
  assert.equal(albums[1].album.songs.length, 1);
});

test('parseSpreadsheetRows supports inline CD 2 divider rows within a single sheet', () => {
  const rows: unknown[][] = [
    ['ΑΡ. ΚΑΤΑΛΟΓΟΥ : GM 6001', 'ΓΕΝΙΚΟΣ ΤΙΤΛΟΣ : SINGLE SHEET MULTI-CD'],
    ['A/A', 'ΤΙΤΛΟΣ ΤΡΑΓΟΥΔΙΟΥ', 'min', 'sec', 'ΣΤΙΧΟΙ'],
    ['1', 'ΠΡΩΤΟ CD ΤΡΑΓΟΥΔΙ', '3', '00', '0:10\n[μουσική]'],
    ['CD 2', '', '', '', ''],
    ['1', 'ΔΕΥΤΕΡΟ CD ΤΡΑΓΟΥΔΙ', '3', '30', '0:15\nΔεύτεροι στίχοι'],
  ];
  const parsed = parseSpreadsheetRows(rows);
  assert.equal(parsed.songs.length, 2);
  assert.equal(parsed.songs[0].disc_number, 1);
  assert.equal(parsed.songs[1].disc_number, 2);
  assert.equal(parsed.songs[1].lyrics, '0:15\nΔεύτεροι στίχοι');
});

test('Apple .numbers codec round-trips 23-column multi-CD album with full timestamped Greek lyrics', () => {
  const sample = createSampleTemplateAlbum();
  const fullPromptLyrics = [
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
    '0:44',
    'αυτοί είμαι σαν τυφλός χωρίς αγάπη',
    '0:52',
    'γιατί μου μίνο καημός και το δάκρυ γ',
    '0:57',
    'αυτή γιατί',
    '1:11',
    '[μουσική]',
    '1:22',
    '[μουσική]',
    '1:26',
    'δεν έχει αξία καμιά',
    '1:31',
    'για τη δική μου',
    '1:36',
    'καρδιά όταν μου λέτε γ αυτή με πονάει',
    '1:42',
    'καρδιά όταν μου λέτε γ αυτή με πονάει πιο',
    '1:45',
    'πολύ είμαι σαν τυφλός χωρίς αγάπη γιατί',
    '1:54',
    'α μου μείνω ο καημός και το δάκρυ γ αυτή',
    '2:00',
    'α μου μείνω ο καημός και το δάκρυ γ αυτή γιατί',
    '2:02',
    'γιατί γιατί',
  ].join('\n');
  sample.songs[0].lyrics = fullPromptLyrics;

  const matrix = buildWorkbookMatrix(sample);
  const numbersBuffer = buildNumbersBuffer(matrix, 'GM 0000');
  assert.ok(numbersBuffer.length > 500);

  const xlsxMod =
    (XLSX as unknown as { default?: typeof XLSX }).default?.read
      ? (XLSX as unknown as { default: typeof XLSX }).default
      : XLSX;
  const wb = xlsxMod.read(numbersBuffer, { type: 'buffer' });
  assert.ok(wb.SheetNames.length >= 1);
  const rawSheets = wb.SheetNames.map((name) => ({
    name,
    rows: xlsxMod.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' }),
  }));

  const parsedAlbums = parseWorkbookSheetsToAlbums(rawSheets);
  assert.equal(parsedAlbums.length, 1);
  const parsed = parsedAlbums[0].album;
  assert.equal(parsed.catalog_number, sample.catalog_number);
  assert.equal(parsed.album_title, sample.album_title);
  assert.equal(parsed.songs.length, 2);
  assert.equal(parsed.songs[0].disc_number, 1);
  assert.equal(parsed.songs[1].disc_number, 2);
  assert.equal(parsed.songs[0].lyrics, fullPromptLyrics);
  assert.equal(parsed.cd_digital_playlist_link, sample.cd_digital_playlist_link);
  assert.equal(parsed.physical_product_web_link, sample.physical_product_web_link);
});

test('CatalogDatabase SQLite supports replace-existing deduplication and migrates legacy DB missing disc_number & lyrics', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbase-test-'));
  try {
    // 1. Create a legacy SQLite DB missing disc_number and lyrics columns on songs
    const legacyDbPath = path.join(tmpDir, 'legacy.sqlite');
    const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ locateFile: () => wasmPath, useOldExtensionFunctions: false });
    const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT DEFAULT '',
        catalog_number TEXT DEFAULT '',
        label TEXT DEFAULT '',
        phonographic_company TEXT DEFAULT '',
        format TEXT DEFAULT 'CD',
        album_artist TEXT DEFAULT '',
        featured_artists TEXT DEFAULT '',
        album_title TEXT NOT NULL,
        album_time TEXT DEFAULT '00:00',
        total_seconds INTEGER DEFAULT 0,
        release_date TEXT DEFAULT '',
        return_date TEXT DEFAULT '',
        album_music_category TEXT DEFAULT '',
        producer TEXT DEFAULT '',
        production_company TEXT DEFAULT '',
        print_design TEXT DEFAULT '',
        cd_digital_playlist_link TEXT DEFAULT '',
        physical_product_web_link TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id INTEGER NOT NULL,
        track_no TEXT DEFAULT '',
        title_gr TEXT DEFAULT '',
        title_en TEXT DEFAULT '',
        duration_min INTEGER DEFAULT NULL,
        duration_sec INTEGER DEFAULT NULL,
        total_seconds INTEGER DEFAULT 0,
        full_track INTEGER DEFAULT 1,
        pot_pouri INTEGER DEFAULT 0,
        isrc_code TEXT DEFAULT '',
        iswc_code TEXT DEFAULT '',
        autodia_code TEXT DEFAULT '',
        composer_gr TEXT DEFAULT '',
        composer_en TEXT DEFAULT '',
        songwriter_gr TEXT DEFAULT '',
        songwriter_en TEXT DEFAULT '',
        digital_web_link TEXT DEFAULT '',
        singer_gr TEXT DEFAULT '',
        singer_en TEXT DEFAULT '',
        aepi_percent REAL DEFAULT NULL,
        final_aepi_percent REAL DEFAULT NULL,
        notes TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE musicians (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id INTEGER NOT NULL,
        role TEXT DEFAULT '',
        name TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0
      );
    `);
    legacy.run(
      `INSERT INTO albums (barcode, catalog_number, album_title) VALUES ('5205299111111', 'GM 1111', 'OLD VERSION ALBUM');`
    );
    legacy.run(
      `INSERT INTO songs (album_id, track_no, title_gr, duration_min, duration_sec, total_seconds, sort_order) VALUES (1, '1', 'OLD TRACK', 3, 0, 180, 0);`
    );
    fs.writeFileSync(legacyDbPath, Buffer.from(legacy.export()));
    legacy.close();

    // 2. Open with CatalogDatabase configured to legacyDbPath -> verify auto-migration works
    process.env.SQLITE_DB_PATH = legacyDbPath;
    const db = new CatalogDatabase(tmpDir);
    await db.initialize();

    const initialList = await db.listAlbums();
    assert.equal(initialList.length, 1);
    assert.equal(initialList[0].album_title, 'OLD VERSION ALBUM');

    // 3. Import updated album with same catalog/barcode using replaceExisting: true -> must replace in-place (count stays 1!)
    const updatedAlbum = createSampleTemplateAlbum();
    updatedAlbum.catalog_number = 'GM 1111';
    updatedAlbum.barcode = '5205299111111';
    updatedAlbum.album_title = 'UPDATED MULTI-CD ALBUM';

    const skipRes = await db.importAlbumsDeduplicated([updatedAlbum], { replaceExisting: false });
    assert.equal(skipRes.imported.length, 0);
    assert.equal(skipRes.replaced.length, 0);
    assert.equal(skipRes.skipped.length, 1);

    const replaceRes = await db.importAlbumsDeduplicated([updatedAlbum], { replaceExisting: true });
    assert.equal(replaceRes.imported.length, 0);
    assert.equal(replaceRes.replaced.length, 1);
    assert.equal(replaceRes.skipped.length, 0);
    assert.equal(replaceRes.failed.length, 0);

    const afterList = await db.listAlbums();
    assert.equal(afterList.length, 1);
    assert.equal(afterList[0].album_title, 'UPDATED MULTI-CD ALBUM');
    assert.equal(afterList[0].disc_count, 2);

    const fetched = await db.getAlbum(afterList[0].id);
    assert.ok(fetched);
    assert.equal(fetched.songs.length, 2);
    assert.equal(fetched.songs[0].disc_number, 1);
    assert.equal(fetched.songs[1].disc_number, 2);
    assert.ok(fetched.songs[0].lyrics.includes('0:10\n[μουσική]'));
  } finally {
    delete process.env.SQLITE_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

