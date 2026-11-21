import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CatalogDatabase } from './db';
import { createEmptyAlbum } from '../src/utils/catalogMath';

test('CatalogDatabase initializes SQLite 3 file, supports CRUD & search, and persists across restarts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbase-sqlite-test-'));
  try {
    const db1 = new CatalogDatabase(tmpDir);
    await db1.initialize();

    const status = await db1.getDbStatus();
    assert.equal(status.mode, 'sqlite');
    assert.equal(status.connected, true);
    assert.ok(status.sqlitePath && fs.existsSync(status.sqlitePath));
    assert.equal(status.albumCount, 2);

    // Verify valid SQLite 3 binary header on disk
    const header = fs.readFileSync(status.sqlitePath).subarray(0, 16).toString('utf-8');
    assert.equal(header, 'SQLite format 3\u0000');

    // Create a new album with Greek & English metadata + song ISRC
    const draft = createEmptyAlbum();
    draft.catalog_number = 'GM 9999';
    draft.barcode = '5205299999999';
    draft.album_title = 'ΔΟΚΙΜΑΣΤΙΚΟΣ ΔΙΣΚΟΣ SQLITE';
    draft.album_artist = 'ΔΟΚΙΜΗ';
    draft.songs[0].title_gr = 'ΠΡΩΤΟ ΤΡΑΓΟΥΔΙ';
    draft.songs[0].title_en = 'First Song';
    draft.songs[0].duration_min = 4;
    draft.songs[0].duration_sec = 15;
    draft.songs[0].isrc_code = 'GRGM12699901';
    draft.musicians = [{ role: 'Κλαρίνο', name: 'ΓΙΩΡΓΟΣ', sort_order: 0 }];

    const created = await db1.createAlbum(draft);
    assert.ok(created.id && created.id > 0);
    assert.equal(created.total_seconds, 255);
    assert.equal(created.album_time, '04:15');
    assert.equal(created.musicians.length, 1);

    // Search by song ISRC
    const isrcHits = await db1.listAlbums('GRGM12699901');
    assert.equal(isrcHits.length, 1);
    assert.equal(isrcHits[0].catalog_number, 'GM 9999');

    // Update album
    created.album_title = 'ΕΝΗΜΕΡΩΜΕΝΟΣ ΔΙΣΚΟΣ';
    const updated = await db1.updateAlbum(created.id!, created);
    assert.equal(updated?.album_title, 'ΕΝΗΜΕΡΩΜΕΝΟΣ ΔΙΣΚΟΣ');

    // Re-open database from disk to verify persistence
    const db2 = new CatalogDatabase(tmpDir);
    await db2.initialize();
    const loaded = await db2.getAlbum(created.id!);
    assert.equal(loaded?.album_title, 'ΕΝΗΜΕΡΩΜΕΝΟΣ ΔΙΣΚΟΣ');
    assert.equal(loaded?.songs[0].isrc_code, 'GRGM12699901');

    // Export downloadable .sqlite bytes
    const dl = db2.getSqliteFileForDownload();
    assert.equal(dl.bytes.subarray(0, 16).toString('utf-8'), 'SQLite format 3\u0000');

    // Switch to a second custom SQLite file path
    const customSqlite = path.join(tmpDir, 'custom-library.db');
    const customStatus = await db2.connectSqlite(customSqlite);
    assert.equal(customStatus.mode, 'sqlite');
    assert.equal(customStatus.sqlitePath, customSqlite);
    assert.equal(customStatus.albumCount, 0);
    assert.ok(fs.existsSync(customSqlite));

    // Delete from original DB check (re-connect original)
    const origStatus = await db2.connectSqlite(status.sqlitePath);
    assert.equal(origStatus.albumCount, 3);
    const deleted = await db2.deleteAlbum(created.id!);
    assert.equal(deleted, true);
    const afterDelete = await db2.getAlbum(created.id!);
    assert.equal(afterDelete, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CatalogDatabase.splitSqlStatements preserves CREATE TABLE albums despite leading SQL comments', () => {
  const mysqlSchema = fs.readFileSync(path.resolve(process.cwd(), 'server/schema.sql'), 'utf-8');
  const statements = CatalogDatabase.splitSqlStatements(mysqlSchema);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS albums\b/i);
  assert.match(statements[1], /^CREATE TABLE IF NOT EXISTS album_musicians\b/i);
  assert.match(statements[2], /^CREATE TABLE IF NOT EXISTS songs\b/i);
});

test('CatalogDatabase.importAlbumsDeduplicated skips database and in-batch duplicates', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbase-dedup-test-'));
  try {
    const db = new CatalogDatabase(tmpDir);
    await db.initialize();

    const existingDup = createEmptyAlbum();
    existingDup.catalog_number = 'gm-4314';
    existingDup.barcode = '5205299033028';
    existingDup.album_title = 'ζωντανα στα αραχωβιτικα';
    existingDup.album_artist = 'ΔΙΑΦΟΡΟΙ';
    existingDup.songs[0].title_gr = 'Ο ΛΙΟΥΛΙΟΣ';

    const uniqueNew = createEmptyAlbum();
    uniqueNew.catalog_number = 'GM 7777';
    uniqueNew.barcode = '5205299077771';
    uniqueNew.album_title = 'ΜΟΝΑΔΙΚΟΣ ΔΙΣΚΟΣ';
    uniqueNew.album_artist = 'ΚΑΛΛΙΤΕΧΝΗΣ 7777';
    uniqueNew.songs[0].title_gr = 'ΤΡΑΓΟΥΔΙ 7777';

    const batchDup = createEmptyAlbum();
    batchDup.catalog_number = 'GM7777';
    batchDup.barcode = '5205299077771';
    batchDup.album_title = 'μοναδικος δισκος';
    batchDup.album_artist = 'ΚΑΛΛΙΤΕΧΝΗΣ 7777';
    batchDup.songs[0].title_gr = 'ΤΡΑΓΟΥΔΙ 7777';

    const res1 = await db.importAlbumsDeduplicated([existingDup, uniqueNew, batchDup]);
    assert.equal(res1.imported.length, 1);
    assert.equal(res1.imported[0].catalog_number, 'GM 7777');
    assert.equal(res1.skipped.length, 2);
    assert.equal(res1.skipped[0].reason, 'database');
    assert.equal(res1.skipped[1].reason, 'batch');
    assert.equal(res1.failed.length, 0);

    const dupCheck = await db.findDuplicateAlbum(uniqueNew);
    assert.ok(dupCheck);
    assert.equal(dupCheck.catalog_number, 'GM 7777');

    const status = await db.getDbStatus();
    assert.equal(status.albumCount, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
