import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import * as XLSX from 'xlsx';
import { CatalogDatabase } from './server/db';
import { buildNumbersBuffer } from './server/numbersCodec';
import { VersionService } from './server/versionService';
import { buildZipArchive, type ZipEntryInput } from './server/zipBuilder';
import type { Album, MysqlConfig } from './src/types/catalog';
import {
  buildWorkbookMatrix,
  createSampleTemplateAlbum,
  parseDelimitedText,
  parseSpreadsheetRows,
  parseWorkbookSheetsToAlbums,
  validateAlbum,
} from './src/utils/catalogMath';

function resolveAppPath(appRootOverride: string | undefined, ...segments: string[]): string {
  const baseRoot = appRootOverride || process.env.APP_ROOT_DIR || '';
  const unpackedRoot = baseRoot.endsWith('app.asar')
    ? baseRoot.replace(/app\.asar$/, 'app.asar.unpacked')
    : '';
  const candidates = [
    unpackedRoot ? path.resolve(unpackedRoot, ...segments) : '',
    appRootOverride ? path.resolve(appRootOverride, ...segments) : '',
    process.env.APP_ROOT_DIR ? path.resolve(process.env.APP_ROOT_DIR, ...segments) : '',
    typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..', ...segments) : '',
    path.resolve(process.cwd(), ...segments),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(appRootOverride || process.cwd(), ...segments);
}

export async function startAppServer(options?: {
  port?: number;
  dataDir?: string;
  appRoot?: string;
  isProduction?: boolean;
}) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const db = new CatalogDatabase(options?.dataDir);
  await db.initialize();
  const versionService = new VersionService({
    dataDir: options?.dataDir,
    appRoot: options?.appRoot,
  });

  // Health & DB Status
  app.get('/api/health', async (_req, res) => {
    const status = await db.getDbStatus();
    res.json({ ok: true, status, version: versionService.getCurrentVersion() });
  });

  // App Version & Update Checks
  app.get('/api/version', (_req, res) => {
    res.json(versionService.getVersionSummary());
  });

  app.get('/api/version/check', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const result = await versionService.checkLatestVersion({ force });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        currentVersion: versionService.getCurrentVersion(),
        latestVersion: null,
        isOutdated: false,
        status: 'error',
        repo: versionService.getConfig().repo,
        checkOnStartup: versionService.getConfig().checkOnStartup,
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Version check failed',
      });
    }
  });

  app.post('/api/version/config', async (req, res) => {
    try {
      const body = req.body as { repo?: string; checkOnStartup?: boolean };
      const config = versionService.saveConfig({
        repo: body?.repo,
        checkOnStartup: body?.checkOnStartup,
      });
      const checkResult = await versionService.checkLatestVersion({ force: true });
      res.json({ config, checkResult });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to save version settings',
      });
    }
  });

  app.get('/api/db/status', async (_req, res) => {
    try {
      const status = await db.getDbStatus();
      const config = db.getSafeMysqlConfig();
      const sqliteConfig = db.getSqliteConfig();
      res.json({ status, config, sqliteConfig });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Status check failed' });
    }
  });

  app.get('/api/db/schema', (_req, res) => {
    const schemaPath = resolveAppPath(options?.appRoot, 'server/schema.sql');
    const sqliteSchemaPath = resolveAppPath(options?.appRoot, 'server/schema.sqlite.sql');
    const sql = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf-8') : '';
    const sqliteSql = fs.existsSync(sqliteSchemaPath) ? fs.readFileSync(sqliteSchemaPath, 'utf-8') : '';
    res.json({ sql, sqliteSql });
  });

  app.post('/api/db/sqlite/connect', async (req, res) => {
    try {
      const { filePath } = req.body as { filePath?: string };
      if (!filePath || !filePath.trim()) {
        res.status(400).json({ error: 'SQLite file path is required.' });
        return;
      }
      const status = await db.connectSqlite(filePath);
      res.json({
        status,
        sqliteConfig: db.getSqliteConfig(),
        config: db.getSafeMysqlConfig(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to open SQLite database' });
    }
  });

  app.post('/api/db/sqlite/upload', async (req, res) => {
    try {
      const { base64, filename } = req.body as { base64?: string; filename?: string };
      if (!base64) {
        res.status(400).json({ error: 'SQLite file data is required.' });
        return;
      }
      const buffer = Buffer.from(base64, 'base64');
      const status = await db.importSqliteBuffer(buffer, filename);
      res.json({
        status,
        sqliteConfig: db.getSqliteConfig(),
        config: db.getSafeMysqlConfig(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid SQLite database file' });
    }
  });

  app.get('/api/db/sqlite/download', (_req, res) => {
    try {
      const { filename, bytes } = db.getSqliteFileForDownload();
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(bytes);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to export SQLite file' });
    }
  });

  app.post('/api/db/test', async (req, res) => {
    try {
      const cfg = req.body as MysqlConfig;
      if (!cfg?.host || !cfg?.user) {
        res.status(400).json({ ok: false, error: 'Host and Username are required to test connection.' });
        return;
      }
      const result = await db.testMysqlConnection(cfg);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Test failed' });
    }
  });

  app.post('/api/db/config', async (req, res) => {
    try {
      const cfg = req.body as MysqlConfig;
      const status = await db.saveAndConnectMysql(cfg);
      const safeConfig = db.getSafeMysqlConfig();
      res.json({ status, config: safeConfig, sqliteConfig: db.getSqliteConfig() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save MySQL config' });
    }
  });

  app.post('/api/db/disconnect', async (_req, res) => {
    try {
      const status = await db.disconnectMysql();
      const config = db.getSafeMysqlConfig();
      res.json({ status, config, sqliteConfig: db.getSqliteConfig() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to disconnect' });
    }
  });

  app.post('/api/db/sync-local-to-mysql', async (_req, res) => {
    try {
      const result = await db.syncLocalToMysql();
      const status = await db.getDbStatus();
      res.json({ result, status });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  // Albums CRUD & Search Export
  app.get('/api/albums', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const albums = await db.listAlbums(q);
      res.json({ albums });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list albums' });
    }
  });

  app.get('/api/albums/export-search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const category = typeof req.query.category === 'string' ? req.query.category : 'all';
      const format = typeof req.query.format === 'string' ? req.query.format : 'all';

      const summaries = await db.listAlbums(q);
      const filteredSummaries = summaries.filter((a) => {
        if (category !== 'all' && a.album_music_category !== category) return false;
        if (format !== 'all' && a.format !== format) return false;
        return true;
      });

      const fullAlbums: Album[] = [];
      for (const s of filteredSummaries) {
        const loaded = await db.getAlbum(s.id);
        if (loaded) fullAlbums.push(loaded);
      }

      const catalogRows: Array<Array<string | number | null>> = [
        [
          'Catalog #',
          'Barcode',
          'Album Title',
          'Album Artist',
          'Featured Singers',
          'Label',
          'Format',
          'Category',
          'CDs',
          'Tracks',
          'Full Tracks',
          'Pot-Pouri',
          'Album Time',
          'Total Seconds',
          'Producer',
          'Production',
          'Release Date',
          'Playlist Link',
          'Physical Web Link',
          'Notes',
        ],
      ];

      const songRows: Array<Array<string | number | null>> = [
        [
          'Catalog #',
          'Album Title',
          'Album Artist',
          'CD #',
          'A/A',
          'Title GR',
          'Title EN',
          'Min',
          'Sec',
          'Total (s)',
          'Full Track',
          'Pot-Pouri',
          'ISRC Code',
          'ISWC Code',
          'Autodia Code',
          'Composer GR',
          'Composer EN',
          'Songwriter GR',
          'Songwriter EN',
          'Singer GR',
          'Singer EN',
          'AEPI %',
          'Final AEPI %',
          'Digital Web Link',
          'Notes',
          'Lyrics',
        ],
      ];

      const musicianRows: Array<Array<string | number | null>> = [
        ['Catalog #', 'Album Title', 'Role / Instrument', 'Musician Name', 'Tracks (empty = all)'],
      ];

      for (const album of fullAlbums) {
        const matchedSummary = filteredSummaries.find((s) => s.id === album.id);
        catalogRows.push([
          album.catalog_number,
          album.barcode,
          album.album_title,
          album.album_artist,
          album.featured_artists,
          album.label,
          album.format,
          album.album_music_category,
          matchedSummary?.disc_count || 1,
          album.songs.length,
          matchedSummary?.full_track_count ?? album.songs.filter((s) => s.full_track).length,
          matchedSummary?.pot_pouri_count ?? album.songs.filter((s) => s.pot_pouri).length,
          album.album_time,
          album.total_seconds,
          album.producer,
          album.production_company,
          album.release_date,
          album.cd_digital_playlist_link,
          album.physical_product_web_link,
          album.notes,
        ]);

        for (const s of album.songs) {
          songRows.push([
            album.catalog_number,
            album.album_title,
            album.album_artist,
            s.disc_number || 1,
            s.track_no,
            s.title_gr,
            s.title_en,
            s.duration_min,
            s.duration_sec,
            s.total_seconds,
            s.full_track ? 1 : 0,
            s.pot_pouri ? 1 : 0,
            s.isrc_code,
            s.iswc_code,
            s.autodia_code,
            s.composer_gr,
            s.composer_en,
            s.songwriter_gr,
            s.songwriter_en,
            s.singer_gr,
            s.singer_en,
            s.aepi_percent,
            s.final_aepi_percent,
            s.digital_web_link,
            s.notes,
            s.lyrics,
          ]);
        }

        for (const m of album.musicians) {
          if (!m.role.trim() && !m.name.trim()) continue;
          musicianRows.push([
            album.catalog_number,
            album.album_title,
            m.role,
            m.name,
            m.tracks?.trim() || 'All tracks',
          ]);
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catalogRows), 'Catalog Results');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(songRows), 'Songs');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(musicianRows), 'Musicians');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="discbase_search_results.xlsx"');
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to export search results' });
    }
  });

  app.get('/api/albums/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid album ID' });
        return;
      }
      const album = await db.getAlbum(id);
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      res.json({ album });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load album' });
    }
  });

  app.post('/api/albums', async (req, res) => {
    try {
      const payload = req.body as Album;
      const validation = validateAlbum(payload);
      if (!validation.valid) {
        res.status(400).json({ error: validation.errors.join(' '), validation });
        return;
      }
      const dup = await db.findDuplicateAlbum(payload);
      if (dup) {
        res.status(409).json({
          error: `An identical album already exists in the catalog (${dup.catalog_number || dup.barcode} · ${dup.album_title}).`,
          duplicate: dup,
        });
        return;
      }
      const created = await db.createAlbum(payload);
      res.status(201).json({ album: created });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create album' });
    }
  });

  app.put('/api/albums/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid album ID' });
        return;
      }
      const payload = req.body as Album;
      const validation = validateAlbum(payload);
      if (!validation.valid) {
        res.status(400).json({ error: validation.errors.join(' '), validation });
        return;
      }
      const dup = await db.findDuplicateAlbum(payload, id);
      if (dup) {
        res.status(409).json({
          error: `Another album in the catalog already uses this exact identity (${dup.catalog_number || dup.barcode} · ${dup.album_title}).`,
          duplicate: dup,
        });
        return;
      }
      const updated = await db.updateAlbum(id, payload);
      if (!updated) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      res.json({ album: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update album' });
    }
  });

  app.delete('/api/albums/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid album ID' });
        return;
      }
      const ok = await db.deleteAlbum(id);
      if (!ok) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete album' });
    }
  });

  // XLSX / NUMBERS / TSV / CSV Parse & Batch Import
  app.post('/api/import/parse', (req, res) => {
    try {
      const parseSingleInput = (input: { base64?: string; text?: string; filename?: string }) => {
        const fname = input.filename || 'upload.xlsx';
        if (input.base64) {
          const buffer = Buffer.from(input.base64, 'base64');
          const wb = XLSX.read(buffer, { type: 'buffer' });
          const sheetInputs: Array<{ name: string; rows: unknown[][] }> = [];
          for (const sheetName of wb.SheetNames || []) {
            const sheet = wb.Sheets?.[sheetName];
            if (!sheet || !sheet['!ref']) continue;
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
            sheetInputs.push({ name: sheetName, rows });
          }
          const albums = parseWorkbookSheetsToAlbums(sheetInputs);
          return albums.map((entry) => ({
            album: entry.album,
            sheetName: entry.sheetName,
            filename: fname,
          }));
        }
        if (input.text) {
          const rows = parseDelimitedText(input.text);
          return [{ album: parseSpreadsheetRows(rows), sheetName: '', filename: fname }];
        }
        return [];
      };

      const body = req.body as {
        base64?: string;
        text?: string;
        filename?: string;
        files?: Array<{ base64?: string; text?: string; filename?: string }>;
      };

      if (Array.isArray(body.files) && body.files.length > 0) {
        const items = body.files.flatMap((fileInput) => parseSingleInput(fileInput));
        res.json({
          albums: items.map((i) => i.album),
          items,
        });
        return;
      }

      if (!body.base64 && !body.text) {
        res.status(400).json({ error: 'Provide either base64 workbook data or delimited text.' });
        return;
      }

      const items = parseSingleInput(body);
      res.json({
        filename: body.filename || 'upload.xlsx',
        albums: items.map((i) => i.album),
        items,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse spreadsheet file' });
    }
  });

  app.post('/api/import/commit', async (req, res) => {
    try {
      const { albums, replaceExisting, replaceIndices } = req.body as {
        albums: Album[];
        replaceExisting?: boolean;
        replaceIndices?: number[];
      };
      if (!Array.isArray(albums) || albums.length === 0) {
        res.status(400).json({ error: 'No albums provided to import.' });
        return;
      }

      for (const album of albums) {
        const validation = validateAlbum(album);
        if (!validation.valid) {
          res.status(400).json({
            error: `Validation failed for "${album.album_title || 'Untitled'}": ${validation.errors.join(' ')}`,
          });
          return;
        }
      }

      const result = await db.importAlbumsDeduplicated(albums, {
        replaceExisting,
        replaceIndices,
      });
      if (result.imported.length === 0 && result.replaced.length === 0 && result.failed.length > 0) {
        res.status(500).json({
          error: result.failed[0].error || 'Failed to save imported albums',
          failedCount: result.failed.length,
          failedAlbums: result.failed,
        });
        return;
      }

      const savedAll = [...result.imported, ...result.replaced];
      res.status(result.imported.length > 0 ? 201 : 200).json({
        importedCount: result.imported.length,
        replacedCount: result.replaced.length,
        skippedCount: result.skipped.length,
        failedCount: result.failed.length,
        skippedAlbums: result.skipped,
        failedAlbums: result.failed,
        replacedAlbums: result.replaced,
        albums: savedAll,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  // Download sample import template (.xlsx or .numbers) with multi-CD + timestamped lyrics
  app.get('/api/import/template', (req, res) => {
    try {
      const format = String(req.query.format || 'xlsx').toLowerCase() === 'numbers' ? 'numbers' : 'xlsx';
      const sample = createSampleTemplateAlbum();
      const matrix = buildWorkbookMatrix(sample);

      if (format === 'numbers') {
        const buf = buildNumbersBuffer(matrix, 'Template');
        res.setHeader('Content-Type', 'application/vnd.apple.numbers');
        res.setHeader('Content-Disposition', 'attachment; filename="discbase_import_template.numbers"');
        res.send(buf);
        return;
      }

      const ws = XLSX.utils.aoa_to_sheet(matrix);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="discbase_import_template.xlsx"');
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build template' });
    }
  });

  // Export single album as XLSX or Apple .numbers
  app.get('/api/albums/:id/export', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const format = String(req.query.format || 'xlsx').toLowerCase() === 'numbers' ? 'numbers' : 'xlsx';
      const album = await db.getAlbum(id);
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      const matrix = buildWorkbookMatrix(album);
      const safeSheetName = (album.catalog_number || album.album_title || 'Album')
        .slice(0, 31)
        .replace(/[\\/?*[\]]/g, '_');
      const safeFile = (album.catalog_number || `album_${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');

      if (format === 'numbers') {
        const buf = buildNumbersBuffer(matrix, safeSheetName || 'Album');
        res.setHeader('Content-Type', 'application/vnd.apple.numbers');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFile}.numbers"`);
        res.send(buf);
        return;
      }

      const ws = XLSX.utils.aoa_to_sheet(matrix);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName || 'Album');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFile}.xlsx"`);
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
    }
  });

  // Export GitHub Actions YML & electron-builder.yml
  app.get('/api/export/github-yml', (_req, res) => {
    const workflowPath = resolveAppPath(options?.appRoot, '.github/workflows/build-desktop.yml');
    const builderPath = resolveAppPath(options?.appRoot, 'electron-builder.yml');
    const workflowYml = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf-8') : '';
    const builderYml = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf-8') : '';
    res.json({ workflowYml, builderYml });
  });

  // Download complete GitHub repository source + YML bundle as .zip
  app.get('/api/export/github-bundle', (_req, res) => {
    try {
      const root = process.cwd();
      const entries: ZipEntryInput[] = [];
      const rootFiles = [
        'README.md',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'vite.config.ts',
        'index.html',
        'server.ts',
        'electron-builder.yml',
        'build-info.json',
        '.env.example',
        '.gitignore',
        'metadata.json',
      ];

      for (const rel of rootFiles) {
        const abs = path.join(root, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          entries.push({ name: rel, data: fs.readFileSync(abs) });
        }
      }

      const includeDirs = ['src', 'server', 'electron', 'build-resources', '.github'];
      const collectDir = (dirRel: string) => {
        const absDir = path.join(root, dirRel);
        if (!fs.existsSync(absDir)) return;
        for (const item of fs.readdirSync(absDir, { withFileTypes: true })) {
          if (item.name === 'node_modules' || item.name === 'dist' || item.name === 'data') continue;
          const itemRel = path.posix.join(dirRel.replace(/\\/g, '/'), item.name);
          const itemAbs = path.join(absDir, item.name);
          if (item.isDirectory()) {
            collectDir(itemRel);
          } else if (item.isFile()) {
            entries.push({ name: itemRel, data: fs.readFileSync(itemAbs) });
          }
        }
      };
      includeDirs.forEach(collectDir);

      // Include sample txt schemas if present for reference
      const sampleDir = 'public/assets/aistudio';
      if (fs.existsSync(path.join(root, sampleDir))) {
        for (const item of fs.readdirSync(path.join(root, sampleDir))) {
          if (item.endsWith('.txt')) {
            entries.push({
              name: path.posix.join(sampleDir, item),
              data: fs.readFileSync(path.join(root, sampleDir, item)),
            });
          }
        }
      }

      const zipBuf = buildZipArchive(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="discbase-studio-github.zip"');
      res.send(zipBuf);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build GitHub ZIP bundle' });
    }
  });

  // Frontend middleware / static files
  const isProd = options?.isProduction ?? process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = resolveAppPath(options?.appRoot, 'dist');
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.txt': 'text/plain; charset=utf-8',
    };

    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const cleanReqPath = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
      const candidate = path.join(distPath, cleanReqPath);
      const resolved = path.resolve(candidate);
      const distResolved = path.resolve(distPath);

      const targetFile =
        resolved.startsWith(distResolved) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
          ? resolved
          : path.join(distResolved, 'index.html');

      if (!fs.existsSync(targetFile)) {
        res.status(500).send(`Missing production bundle at ${distPath}`);
        return;
      }

      const ext = path.extname(targetFile).toLowerCase();
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.send(fs.readFileSync(targetFile));
    });
  }

  const requestedPort = options?.port ?? Number(process.env.PORT || 3000);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const srv = app.listen(requestedPort, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  console.log(`DiscBase Studio listening on http://127.0.0.1:${actualPort}`);

  return { app, server, db, port: actualPort };
}

// Start directly when executed as main entry point
const isDirectRun =
  !process.versions.electron &&
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js') ||
    process.argv[1].endsWith('server.mjs'));

if (isDirectRun) {
  startAppServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
