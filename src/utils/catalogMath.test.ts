import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  areAlbumsIdentical,
  buildWorkbookMatrix,
  computeAlbumStats,
  computeSongSeconds,
  createEmptyAlbum,
  createEmptySong,
  deduplicateAlbumBatch,
  findDuplicateAlbum,
  formatSecondsAsTime,
  parseSpreadsheetRows,
  validateAlbum,
} from './catalogMath';

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
