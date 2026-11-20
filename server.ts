import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import * as XLSX from 'xlsx';
import { CatalogDatabase } from './server/db';
import { buildZipArchive, type ZipEntryInput } from './server/zipBuilder';
import type { Album, MysqlConfig } from './src/types/catalog';
import { buildWorkbookMatrix, parseSpreadsheetRows, validateAlbum } from './src/utils/catalogMath';

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
  app.use(express.json({ limit: '25mb' }));

  const db = new CatalogDatabase(options?.dataDir);
  await db.initialize();

  // Health & DB Status
  app.get('/api/health', async (_req, res) => {
    const status = await db.getDbStatus();
    res.json({ ok: true, status });
  });

  app.get('/api/db/status', async (_req, res) => {
    try {
      const status = await db.getDbStatus();
      const config = db.getSafeMysqlConfig();
      res.json({ status, config });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Status check failed' });
    }
  });

  app.get('/api/db/schema', (_req, res) => {
    const schemaPath = resolveAppPath(options?.appRoot, 'server/schema.sql');
    const sql = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf-8') : '';
    res.json({ sql });
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
      res.json({ status, config: safeConfig });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save MySQL config' });
    }
  });

  app.post('/api/db/disconnect', async (_req, res) => {
    try {
      const status = await db.disconnectMysql();
      const config = db.getSafeMysqlConfig();
      res.json({ status, config });
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

  // Albums CRUD
  app.get('/api/albums', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const albums = await db.listAlbums(q);
      res.json({ albums });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list albums' });
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

  // XLSX / TSV / CSV Parse & Batch Import
  app.post('/api/import/parse', (req, res) => {
    try {
      const { base64, text, filename } = req.body as { base64?: string; text?: string; filename?: string };
      let albums: Album[] = [];

      if (base64) {
        const buffer = Buffer.from(base64, 'base64');
        const wb = XLSX.read(buffer, { type: 'buffer' });
        albums = wb.SheetNames.map((sheetName) => {
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][];
          const parsed = parseSpreadsheetRows(rows);
          if (!parsed.album_title && sheetName) {
            parsed.album_title = sheetName;
          }
          return parsed;
        }).filter((a) => a.songs.length > 0 || a.album_title);
      } else if (text) {
        const lines = text.split(/\r?\n/);
        const delimiter = lines.some((l) => l.includes('\t')) ? '\t' : ',';
        const rows = lines.map((line) => line.split(delimiter));
        albums = [parseSpreadsheetRows(rows)];
      } else {
        res.status(400).json({ error: 'Provide either base64 workbook data or delimited text.' });
        return;
      }

      res.json({ filename: filename || 'upload.xlsx', albums });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse spreadsheet file' });
    }
  });

  app.post('/api/import/commit', async (req, res) => {
    try {
      const { albums } = req.body as { albums: Album[] };
      if (!Array.isArray(albums) || albums.length === 0) {
        res.status(400).json({ error: 'No albums provided to import.' });
        return;
      }

      const created: Album[] = [];
      for (const album of albums) {
        const validation = validateAlbum(album);
        if (!validation.valid) {
          res.status(400).json({
            error: `Validation failed for "${album.album_title || 'Untitled'}": ${validation.errors.join(' ')}`,
          });
          return;
        }
        const saved = await db.createAlbum(album);
        created.push(saved);
      }

      res.status(201).json({ importedCount: created.length, albums: created });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  // Export single album as XLSX matching screenshot layout
  app.get('/api/albums/:id/export', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const album = await db.getAlbum(id);
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      const matrix = buildWorkbookMatrix(album);
      const ws = XLSX.utils.aoa_to_sheet(matrix);
      const wb = XLSX.utils.book_new();
      const safeSheetName = (album.catalog_number || album.album_title || 'Album').slice(0, 31).replace(/[\\/?*[\]]/g, '_');
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName || 'Album');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

      const safeFile = (album.catalog_number || `album_${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
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

      const includeDirs = ['src', 'server', 'electron', '.github'];
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
