import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import type { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import type { Album, AlbumSummary, DbStatus, Musician, MysqlConfig, Song, SqliteConfig } from '../src/types/catalog';
import {
  computeAlbumStats,
  computeSongSeconds,
  deduplicateAlbumBatch,
  findDuplicateAlbum as findDuplicateInList,
} from '../src/utils/catalogMath';
import { getInitialSeedAlbums } from './seedData';

interface LocalStore {
  nextAlbumId: number;
  albums: Album[];
}

export class CatalogDatabase {
  private dataDir: string;
  private localStorePath: string;
  private configPath: string;
  private sqliteConfigPath: string;
  private sqlitePath: string;
  private sqlJs: SqlJsStatic | null = null;
  private sqliteDb: SqlJsDatabase | null = null;
  private lastSqliteError = '';

  private mysqlPool: Pool | null = null;
  private mysqlConfig: MysqlConfig;
  private mysqlConnected = false;
  private lastMysqlError = '';

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.APP_DATA_DIR || path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.localStorePath = path.join(this.dataDir, 'catalog.json');
    this.configPath = path.join(this.dataDir, 'mysql-config.json');
    this.sqliteConfigPath = path.join(this.dataDir, 'sqlite-config.json');
    this.sqlitePath = this.loadSqlitePath();
    this.mysqlConfig = this.loadMysqlConfig();
  }

  private loadSqlitePath(): string {
    const fallback = process.env.SQLITE_DB_PATH || path.join(this.dataDir, 'discbase_catalog.sqlite');
    if (fs.existsSync(this.sqliteConfigPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.sqliteConfigPath, 'utf-8')) as Partial<SqliteConfig>;
        if (saved.filePath && saved.filePath.trim()) {
          return path.resolve(saved.filePath.trim());
        }
      } catch {
        return path.resolve(fallback);
      }
    }
    return path.resolve(fallback);
  }

  private saveSqliteConfig(filePath: string): void {
    const cfg: SqliteConfig = { filePath };
    fs.writeFileSync(this.sqliteConfigPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }

  private loadMysqlConfig(): MysqlConfig {
    const envConfig: MysqlConfig = {
      host: process.env.MYSQL_HOST || '',
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE || 'discbase_catalog',
      user: process.env.MYSQL_USER || '',
      password: process.env.MYSQL_PASSWORD || '',
      ssl: process.env.MYSQL_SSL === 'true',
      autoConnect: process.env.MYSQL_AUTO_CONNECT !== 'false',
    };

    if (fs.existsSync(this.configPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<MysqlConfig>;
        return {
          host: saved.host ?? envConfig.host,
          port: saved.port ?? envConfig.port,
          database: saved.database ?? envConfig.database,
          user: saved.user ?? envConfig.user,
          password: saved.password ?? envConfig.password,
          ssl: saved.ssl ?? envConfig.ssl,
          autoConnect: saved.autoConnect ?? envConfig.autoConnect,
        };
      } catch {
        return envConfig;
      }
    }

    return envConfig;
  }

  public getSafeMysqlConfig(): Omit<MysqlConfig, 'password'> & { hasPassword: boolean } {
    return {
      host: this.mysqlConfig.host,
      port: this.mysqlConfig.port,
      database: this.mysqlConfig.database,
      user: this.mysqlConfig.user,
      ssl: this.mysqlConfig.ssl,
      autoConnect: this.mysqlConfig.autoConnect,
      hasPassword: Boolean(this.mysqlConfig.password),
    };
  }

  public getSqliteConfig(): SqliteConfig {
    return { filePath: this.sqlitePath };
  }

  public async initialize(): Promise<void> {
    await this.initSqliteDatabase(this.sqlitePath, true);
    if (
      this.mysqlConfig.autoConnect &&
      this.mysqlConfig.host.trim() &&
      this.mysqlConfig.user.trim() &&
      this.mysqlConfig.database.trim()
    ) {
      await this.connectMysql(this.mysqlConfig);
    }
  }

  // ---------------- SQLite Engine (sql.js WASM + Atomic File Persistence) ----------------

  private resolveSqlWasmPath(): string | null {
    const appRoot = process.env.APP_ROOT_DIR || '';
    const unpackedRoot = appRoot.endsWith('app.asar')
      ? appRoot.replace(/app\.asar$/, 'app.asar.unpacked')
      : '';
    const candidates = [
      unpackedRoot ? path.resolve(unpackedRoot, 'server/sql-wasm.wasm') : '',
      unpackedRoot ? path.resolve(unpackedRoot, 'dist-server/sql-wasm.wasm') : '',
      appRoot ? path.resolve(appRoot, 'server/sql-wasm.wasm') : '',
      appRoot ? path.resolve(appRoot, 'dist-server/sql-wasm.wasm') : '',
      typeof __dirname !== 'undefined' ? path.resolve(__dirname, 'sql-wasm.wasm') : '',
      typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../server/sql-wasm.wasm') : '',
      path.resolve(process.cwd(), 'server/sql-wasm.wasm'),
      path.resolve(process.cwd(), 'dist-server/sql-wasm.wasm'),
      path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private resolveFileInApp(relativePath: string): string | null {
    const appRoot = process.env.APP_ROOT_DIR || '';
    const unpackedRoot = appRoot.endsWith('app.asar')
      ? appRoot.replace(/app\.asar$/, 'app.asar.unpacked')
      : '';
    const candidates = [
      unpackedRoot ? path.resolve(unpackedRoot, relativePath) : '',
      appRoot ? path.resolve(appRoot, relativePath) : '',
      typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..', relativePath) : '',
      path.resolve(process.cwd(), relativePath),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private async ensureSqlJsLoaded(): Promise<SqlJsStatic> {
    if (this.sqlJs) return this.sqlJs;
    const wasmPath = this.resolveSqlWasmPath();
    if (!wasmPath) {
      throw new Error('Could not locate sql-wasm.wasm for SQLite engine.');
    }
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmBinary = wasmBuffer.buffer.slice(
      wasmBuffer.byteOffset,
      wasmBuffer.byteOffset + wasmBuffer.byteLength
    );
    this.sqlJs = await initSqlJs({
      wasmBinary,
      useOldExtensionFunctions: false,
    });
    return this.sqlJs;
  }

  private getSqliteSchemaSql(): string {
    const schemaPath = this.resolveFileInApp('server/schema.sqlite.sql');
    if (schemaPath) {
      return fs.readFileSync(schemaPath, 'utf-8');
    }
    return `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL DEFAULT '',
        catalog_number TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        phonographic_company TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL DEFAULT 'CD',
        album_artist TEXT NOT NULL DEFAULT '',
        featured_artists TEXT DEFAULT '',
        album_title TEXT NOT NULL,
        album_time TEXT NOT NULL DEFAULT '00:00',
        total_seconds INTEGER NOT NULL DEFAULT 0,
        release_date TEXT NOT NULL DEFAULT '',
        return_date TEXT NOT NULL DEFAULT '',
        album_music_category TEXT NOT NULL DEFAULT '',
        producer TEXT NOT NULL DEFAULT '',
        production_company TEXT NOT NULL DEFAULT '',
        print_design TEXT NOT NULL DEFAULT '',
        cd_digital_playlist_link TEXT DEFAULT '',
        physical_product_web_link TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS album_musicians (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id INTEGER NOT NULL,
        track_no TEXT NOT NULL DEFAULT '',
        title_gr TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        duration_min INTEGER NULL,
        duration_sec INTEGER NULL,
        total_seconds INTEGER NOT NULL DEFAULT 0,
        full_track INTEGER NULL DEFAULT NULL,
        pot_pouri INTEGER NULL DEFAULT NULL,
        isrc_code TEXT NOT NULL DEFAULT '',
        iswc_code TEXT NOT NULL DEFAULT '',
        autodia_code TEXT NOT NULL DEFAULT '',
        composer_gr TEXT NOT NULL DEFAULT '',
        composer_en TEXT NOT NULL DEFAULT '',
        songwriter_gr TEXT NOT NULL DEFAULT '',
        songwriter_en TEXT NOT NULL DEFAULT '',
        digital_web_link TEXT DEFAULT '',
        singer_gr TEXT NOT NULL DEFAULT '',
        singer_en TEXT NOT NULL DEFAULT '',
        aepi_percent REAL NULL DEFAULT NULL,
        final_aepi_percent REAL NULL DEFAULT NULL,
        notes TEXT DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
      );
    `;
  }

  private sqliteAll<T = Record<string, unknown>>(
    sql: string,
    params: Array<string | number | null> = []
  ): T[] {
    if (!this.sqliteDb) throw new Error('SQLite database is not initialized.');
    const stmt = this.sqliteDb.prepare(sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private sqliteRun(sql: string, params: Array<string | number | null> = []): void {
    if (!this.sqliteDb) throw new Error('SQLite database is not initialized.');
    const stmt = this.sqliteDb.prepare(sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  private persistSqlite(): void {
    if (!this.sqliteDb) return;
    const dir = path.dirname(this.sqlitePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const bytes = this.sqliteDb.export();
    const tmpPath = `${this.sqlitePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, Buffer.from(bytes));
    fs.renameSync(tmpPath, this.sqlitePath);
  }

  private async initSqliteDatabase(targetPath: string, seedIfNew: boolean): Promise<void> {
    try {
      const SQL = await this.ensureSqlJsLoaded();
      const resolved = path.resolve(targetPath);
      const existed = fs.existsSync(resolved);

      const db = existed
        ? new SQL.Database(new Uint8Array(fs.readFileSync(resolved)))
        : new SQL.Database();

      db.exec('PRAGMA foreign_keys = ON;');
      db.exec(this.getSqliteSchemaSql());

      if (this.sqliteDb) {
        this.sqliteDb.close();
      }
      this.sqliteDb = db;
      this.sqlitePath = resolved;
      this.lastSqliteError = '';

      if (!existed) {
        if (seedIfNew) {
          if (fs.existsSync(this.localStorePath)) {
            // Migrate any existing local JSON catalog into SQLite automatically
            const legacy = JSON.parse(fs.readFileSync(this.localStorePath, 'utf-8')) as LocalStore;
            for (const album of legacy.albums || []) {
              this.insertAlbumIntoSqlite(this.normalizeAlbumPayload(album));
            }
          } else {
            const seeds = getInitialSeedAlbums();
            for (const seed of seeds) {
              this.insertAlbumIntoSqlite(this.normalizeAlbumPayload(seed));
            }
          }
        }
        this.persistSqlite();
      }
    } catch (err) {
      this.lastSqliteError = err instanceof Error ? err.message : 'Failed to initialize SQLite database';
    }
  }

  public async connectSqlite(filePath: string): Promise<DbStatus> {
    const trimmed = filePath.trim();
    if (!trimmed) {
      throw new Error('SQLite database file path is required.');
    }
    const resolved = path.resolve(trimmed);
    const existed = fs.existsSync(resolved);

    // Switch active engine away from MySQL so SQLite is active immediately
    if (this.mysqlPool) {
      await this.mysqlPool.end().catch(() => {});
      this.mysqlPool = null;
    }
    this.mysqlConnected = false;
    this.lastMysqlError = '';
    this.mysqlConfig = { ...this.mysqlConfig, autoConnect: false };
    fs.writeFileSync(this.configPath, JSON.stringify(this.mysqlConfig, null, 2), 'utf-8');

    await this.initSqliteDatabase(resolved, !existed && resolved === path.resolve(this.dataDir, 'discbase_catalog.sqlite'));
    if (this.lastSqliteError) {
      throw new Error(this.lastSqliteError);
    }
    this.saveSqliteConfig(resolved);
    return this.getDbStatus();
  }

  public async importSqliteBuffer(buffer: Buffer, filename?: string): Promise<DbStatus> {
    const SQL = await this.ensureSqlJsLoaded();
    const candidateDb = new SQL.Database(new Uint8Array(buffer));
    try {
      candidateDb.exec('PRAGMA foreign_keys = ON;');
      candidateDb.exec(this.getSqliteSchemaSql());
    } catch (err) {
      candidateDb.close();
      throw new Error(err instanceof Error ? `Invalid SQLite database file: ${err.message}` : 'Invalid SQLite file');
    }

    const cleanName = (filename || 'imported_catalog.sqlite').replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetName = /\.(sqlite|db|sqlite3)$/i.test(cleanName) ? cleanName : `${cleanName}.sqlite`;
    const targetPath = path.join(this.dataDir, targetName);

    if (this.mysqlPool) {
      await this.mysqlPool.end().catch(() => {});
      this.mysqlPool = null;
    }
    this.mysqlConnected = false;
    this.mysqlConfig = { ...this.mysqlConfig, autoConnect: false };
    fs.writeFileSync(this.configPath, JSON.stringify(this.mysqlConfig, null, 2), 'utf-8');

    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
    this.sqliteDb = candidateDb;
    this.sqlitePath = targetPath;
    this.lastSqliteError = '';
    this.persistSqlite();
    this.saveSqliteConfig(targetPath);

    return this.getDbStatus();
  }

  public getSqliteFileForDownload(): { filename: string; bytes: Buffer } {
    if (!this.sqliteDb) {
      throw new Error('SQLite database is not initialized.');
    }
    this.persistSqlite();
    return {
      filename: path.basename(this.sqlitePath) || 'discbase_catalog.sqlite',
      bytes: fs.readFileSync(this.sqlitePath),
    };
  }

  private insertAlbumIntoSqlite(clean: Album): number {
    if (!this.sqliteDb) throw new Error('SQLite database is not initialized.');
    this.sqliteDb.exec('BEGIN TRANSACTION;');
    try {
      this.sqliteRun(
        `INSERT INTO albums (
          barcode, catalog_number, label, phonographic_company, format,
          album_artist, featured_artists, album_title, album_time, total_seconds,
          release_date, return_date, album_music_category, producer, production_company,
          print_design, cd_digital_playlist_link, physical_product_web_link, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clean.barcode,
          clean.catalog_number,
          clean.label,
          clean.phonographic_company,
          clean.format,
          clean.album_artist,
          clean.featured_artists,
          clean.album_title,
          clean.album_time,
          clean.total_seconds,
          clean.release_date,
          clean.return_date,
          clean.album_music_category,
          clean.producer,
          clean.production_company,
          clean.print_design,
          clean.cd_digital_playlist_link,
          clean.physical_product_web_link,
          clean.notes,
        ]
      );
      const idRows = this.sqliteAll<{ id: number }>('SELECT last_insert_rowid() AS id');
      const albumId = Number(idRows[0]?.id || 0);

      for (const m of clean.musicians) {
        this.sqliteRun(
          'INSERT INTO album_musicians (album_id, role, name, sort_order) VALUES (?, ?, ?, ?)',
          [albumId, m.role, m.name, m.sort_order]
        );
      }

      for (const s of clean.songs) {
        this.sqliteRun(
          `INSERT INTO songs (
            album_id, track_no, title_gr, title_en, duration_min, duration_sec,
            total_seconds, full_track, pot_pouri, isrc_code, iswc_code, autodia_code,
            composer_gr, composer_en, songwriter_gr, songwriter_en, digital_web_link,
            singer_gr, singer_en, aepi_percent, final_aepi_percent, notes, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            albumId,
            s.track_no,
            s.title_gr,
            s.title_en,
            s.duration_min,
            s.duration_sec,
            s.total_seconds,
            s.full_track ? 1 : null,
            s.pot_pouri ? 1 : null,
            s.isrc_code,
            s.iswc_code,
            s.autodia_code,
            s.composer_gr,
            s.composer_en,
            s.songwriter_gr,
            s.songwriter_en,
            s.digital_web_link,
            s.singer_gr,
            s.singer_en,
            s.aepi_percent,
            s.final_aepi_percent,
            s.notes,
            s.sort_order,
          ]
        );
      }

      this.sqliteDb.exec('COMMIT;');
      return albumId;
    } catch (err) {
      try {
        this.sqliteDb.exec('ROLLBACK;');
      } catch {
        // ignore rollback failure
      }
      throw err;
    }
  }

  // ---------------- MySQL Helpers ----------------

  private buildPoolOptions(cfg: MysqlConfig, includeDb = true): PoolOptions {
    const opts: PoolOptions = {
      host: cfg.host.trim(),
      port: Number(cfg.port) || 3306,
      user: cfg.user.trim(),
      password: cfg.password,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      connectTimeout: 6000,
    };
    if (includeDb && cfg.database.trim()) {
      opts.database = cfg.database.trim();
    }
    if (cfg.ssl) {
      opts.ssl = { rejectUnauthorized: false };
    }
    return opts;
  }

  private formatMysqlError(err: unknown, fallback: string): string {
    if (!err) return fallback;
    if (typeof err === 'object' && err !== null) {
      const e = err as { message?: string; code?: string; sqlMessage?: string; errors?: unknown[] };
      if (Array.isArray(e.errors) && e.errors.length > 0) {
        const inner = e.errors
          .map((item) => this.formatMysqlError(item, ''))
          .filter(Boolean)
          .join('; ');
        if (inner) return inner;
      }
      if (e.sqlMessage) return e.sqlMessage;
      if (e.message && e.message.trim()) return e.message;
      if (e.code) return `MySQL error (${e.code})`;
    }
    return fallback;
  }

  public async testMysqlConnection(cfg: MysqlConfig): Promise<{ ok: boolean; error?: string; version?: string }> {
    let conn: mysql.Connection | null = null;
    try {
      const effectivePassword = cfg.password === '__KEEP_EXISTING__' ? this.mysqlConfig.password : cfg.password;
      const poolOpts = this.buildPoolOptions({ ...cfg, password: effectivePassword }, false);
      conn = await mysql.createConnection(poolOpts);
      const [rows] = await conn.query<RowDataPacket[]>('SELECT VERSION() AS version');
      const version = rows[0]?.version ? String(rows[0].version) : 'MySQL';
      return { ok: true, version };
    } catch (err) {
      return {
        ok: false,
        error: this.formatMysqlError(err, 'Unable to reach MySQL server.'),
      };
    } finally {
      if (conn) {
        await conn.end().catch(() => {});
      }
    }
  }

  public async saveAndConnectMysql(cfg: MysqlConfig): Promise<DbStatus> {
    const effectivePassword = cfg.password === '__KEEP_EXISTING__' ? this.mysqlConfig.password : cfg.password;
    const nextConfig: MysqlConfig = {
      host: cfg.host.trim(),
      port: Number(cfg.port) || 3306,
      database: cfg.database.trim() || 'discbase_catalog',
      user: cfg.user.trim(),
      password: effectivePassword,
      ssl: Boolean(cfg.ssl),
      autoConnect: Boolean(cfg.autoConnect),
    };

    fs.writeFileSync(this.configPath, JSON.stringify(nextConfig, null, 2), 'utf-8');
    this.mysqlConfig = nextConfig;

    if (this.mysqlPool) {
      await this.mysqlPool.end().catch(() => {});
      this.mysqlPool = null;
      this.mysqlConnected = false;
    }

    if (nextConfig.host && nextConfig.user && nextConfig.database) {
      await this.connectMysql(nextConfig);
    } else {
      this.lastMysqlError = '';
    }

    return this.getDbStatus();
  }

  public async disconnectMysql(): Promise<DbStatus> {
    if (this.mysqlPool) {
      await this.mysqlPool.end().catch(() => {});
      this.mysqlPool = null;
    }
    this.mysqlConnected = false;
    this.lastMysqlError = '';
    this.mysqlConfig = { ...this.mysqlConfig, autoConnect: false };
    fs.writeFileSync(this.configPath, JSON.stringify(this.mysqlConfig, null, 2), 'utf-8');
    return this.getDbStatus();
  }

  private async connectMysql(cfg: MysqlConfig): Promise<void> {
    let pool: Pool | null = null;
    try {
      const safeDbName = cfg.database.trim().replace(/[^a-zA-Z0-9_$-]/g, '') || 'discbase_catalog';
      const dbCfg = { ...cfg, database: safeDbName };

      // First try connecting directly to the target database (works even without global CREATE DATABASE privilege)
      pool = mysql.createPool(this.buildPoolOptions(dbCfg, true));
      try {
        await pool.query('SELECT 1');
      } catch (directErr) {
        const errCode = (directErr as { code?: string })?.code;
        await pool.end().catch(() => {});
        pool = null;

        if (errCode === 'ER_BAD_DB_ERROR') {
          const bootstrapConn = await mysql.createConnection(this.buildPoolOptions(dbCfg, false));
          try {
            await bootstrapConn.query(
              `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
            );
          } finally {
            await bootstrapConn.end().catch(() => {});
          }
          pool = mysql.createPool(this.buildPoolOptions(dbCfg, true));
          await pool.query('SELECT 1');
        } else {
          throw directErr;
        }
      }

      await this.ensureMysqlSchema(pool);
      this.mysqlPool = pool;
      this.mysqlConnected = true;
      this.lastMysqlError = '';
    } catch (err) {
      if (pool) {
        await pool.end().catch(() => {});
      }
      this.mysqlPool = null;
      this.mysqlConnected = false;
      this.lastMysqlError = this.formatMysqlError(err, 'MySQL connection failed');
    }
  }

  private getMysqlSchemaSql(): string {
    const schemaPath = this.resolveFileInApp('server/schema.sql');
    if (schemaPath) {
      return fs.readFileSync(schemaPath, 'utf-8');
    }
    return `
      CREATE TABLE IF NOT EXISTS albums (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        barcode VARCHAR(191) NOT NULL DEFAULT '',
        catalog_number VARCHAR(191) NOT NULL DEFAULT '',
        label VARCHAR(191) NOT NULL DEFAULT '',
        phonographic_company VARCHAR(512) NOT NULL DEFAULT '',
        format VARCHAR(128) NOT NULL DEFAULT 'CD',
        album_artist VARCHAR(512) NOT NULL DEFAULT '',
        featured_artists TEXT,
        album_title VARCHAR(512) NOT NULL,
        album_time VARCHAR(64) NOT NULL DEFAULT '00:00',
        total_seconds INT UNSIGNED NOT NULL DEFAULT 0,
        release_date VARCHAR(191) NOT NULL DEFAULT '',
        return_date VARCHAR(191) NOT NULL DEFAULT '',
        album_music_category VARCHAR(191) NOT NULL DEFAULT '',
        producer VARCHAR(512) NOT NULL DEFAULT '',
        production_company VARCHAR(512) NOT NULL DEFAULT '',
        print_design VARCHAR(512) NOT NULL DEFAULT '',
        cd_digital_playlist_link TEXT,
        physical_product_web_link TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_albums_catalog (catalog_number),
        INDEX idx_albums_barcode (barcode),
        INDEX idx_albums_title (album_title(191)),
        INDEX idx_albums_category (album_music_category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS album_musicians (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        album_id INT UNSIGNED NOT NULL,
        role VARCHAR(191) NOT NULL DEFAULT '',
        name VARCHAR(512) NOT NULL DEFAULT '',
        sort_order INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        INDEX idx_musicians_album (album_id),
        CONSTRAINT fk_musicians_album
          FOREIGN KEY (album_id) REFERENCES albums(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS songs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        album_id INT UNSIGNED NOT NULL,
        track_no VARCHAR(64) NOT NULL DEFAULT '',
        title_gr VARCHAR(512) NOT NULL DEFAULT '',
        title_en VARCHAR(512) NOT NULL DEFAULT '',
        duration_min SMALLINT UNSIGNED NULL,
        duration_sec SMALLINT UNSIGNED NULL,
        total_seconds INT UNSIGNED NOT NULL DEFAULT 0,
        full_track TINYINT(1) NULL DEFAULT NULL,
        pot_pouri TINYINT(1) NULL DEFAULT NULL,
        isrc_code VARCHAR(128) NOT NULL DEFAULT '',
        iswc_code VARCHAR(128) NOT NULL DEFAULT '',
        autodia_code VARCHAR(128) NOT NULL DEFAULT '',
        composer_gr VARCHAR(512) NOT NULL DEFAULT '',
        composer_en VARCHAR(512) NOT NULL DEFAULT '',
        songwriter_gr VARCHAR(512) NOT NULL DEFAULT '',
        songwriter_en VARCHAR(512) NOT NULL DEFAULT '',
        digital_web_link TEXT,
        singer_gr VARCHAR(512) NOT NULL DEFAULT '',
        singer_en VARCHAR(512) NOT NULL DEFAULT '',
        aepi_percent DECIMAL(8,4) NULL DEFAULT NULL,
        final_aepi_percent DECIMAL(10,5) NULL DEFAULT NULL,
        notes TEXT,
        sort_order INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        INDEX idx_songs_album (album_id),
        INDEX idx_songs_isrc (isrc_code),
        INDEX idx_songs_iswc (iswc_code),
        INDEX idx_songs_autodia (autodia_code),
        INDEX idx_songs_title_gr (title_gr(191)),
        CONSTRAINT fk_songs_album
          FOREIGN KEY (album_id) REFERENCES albums(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
  }

  public static splitSqlStatements(sql: string): string[] {
    return sql
      .split(';')
      .map((chunk) =>
        chunk
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim()
      )
      .filter((stmt) => stmt.length > 0);
  }

  private async ensureMysqlSchema(pool: Pool): Promise<void> {
    const sql = this.getMysqlSchemaSql();
    const statements = CatalogDatabase.splitSqlStatements(sql);
    if (statements.length === 0) return;

    // Create `albums` table first
    await pool.query(statements[0]);

    // Check existing `albums.id` type & engine in case the table pre-existed with signed INT / BIGINT / MyISAM
    let fkAlbumIdType = 'INT UNSIGNED';
    try {
      const [cols] = await pool.query<RowDataPacket[]>(
        `SELECT c.COLUMN_TYPE AS columnType, t.ENGINE AS engine
         FROM information_schema.TABLES t
         JOIN information_schema.COLUMNS c
           ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
         WHERE t.TABLE_SCHEMA = DATABASE()
           AND t.TABLE_NAME = 'albums'
           AND c.COLUMN_NAME = 'id'
         LIMIT 1`
      );
      if (cols.length > 0) {
        const engine = String(cols[0].engine || '').toUpperCase();
        if (engine && engine !== 'INNODB') {
          await pool.query('ALTER TABLE albums ENGINE=InnoDB');
        }
        const colType = String(cols[0].columnType || '').toUpperCase();
        if (colType.includes('BIGINT')) {
          fkAlbumIdType = colType.includes('UNSIGNED') ? 'BIGINT UNSIGNED' : 'BIGINT';
        } else if (colType.includes('INT')) {
          fkAlbumIdType = colType.includes('UNSIGNED') ? 'INT UNSIGNED' : 'INT';
        }
      }
    } catch {
      // Fall back to default INT UNSIGNED if information_schema is restricted
    }

    for (let i = 1; i < statements.length; i++) {
      let stmt = statements[i];
      if (fkAlbumIdType !== 'INT UNSIGNED') {
        stmt = stmt.replace(/album_id\s+INT\s+UNSIGNED\s+NOT\s+NULL/gi, `album_id ${fkAlbumIdType} NOT NULL`);
      }
      await pool.query(stmt);
    }

    // Auto-widen legacy narrow VARCHAR columns on pre-existing databases (safe, non-destructive)
    try {
      const [existingCols] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, CHARACTER_MAXIMUM_LENGTH AS maxLen
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('albums', 'album_musicians', 'songs')`
      );
      const colLen = new Map<string, number>();
      for (const row of existingCols) {
        colLen.set(`${row.tbl}.${row.col}`, Number(row.maxLen || 0));
      }

      const widenSpecs: Array<{ tbl: string; col: string; minLen: number; sql: string }> = [
        { tbl: 'albums', col: 'barcode', minLen: 191, sql: "ALTER TABLE albums MODIFY COLUMN barcode VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'catalog_number', minLen: 191, sql: "ALTER TABLE albums MODIFY COLUMN catalog_number VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'label', minLen: 191, sql: "ALTER TABLE albums MODIFY COLUMN label VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'phonographic_company', minLen: 512, sql: "ALTER TABLE albums MODIFY COLUMN phonographic_company VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'format', minLen: 128, sql: "ALTER TABLE albums MODIFY COLUMN format VARCHAR(128) NOT NULL DEFAULT 'CD'" },
        { tbl: 'albums', col: 'album_artist', minLen: 512, sql: "ALTER TABLE albums MODIFY COLUMN album_artist VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'album_time', minLen: 64, sql: "ALTER TABLE albums MODIFY COLUMN album_time VARCHAR(64) NOT NULL DEFAULT '00:00'" },
        { tbl: 'albums', col: 'release_date', minLen: 191, sql: "ALTER TABLE albums MODIFY COLUMN release_date VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'return_date', minLen: 191, sql: "ALTER TABLE albums MODIFY COLUMN return_date VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'album_music_category', minLen: 191, sql: "ALTER TABLE albums MODIFY COLUMN album_music_category VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'producer', minLen: 512, sql: "ALTER TABLE albums MODIFY COLUMN producer VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'production_company', minLen: 512, sql: "ALTER TABLE albums MODIFY COLUMN production_company VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'albums', col: 'print_design', minLen: 512, sql: "ALTER TABLE albums MODIFY COLUMN print_design VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'album_musicians', col: 'role', minLen: 191, sql: "ALTER TABLE album_musicians MODIFY COLUMN role VARCHAR(191) NOT NULL DEFAULT ''" },
        { tbl: 'album_musicians', col: 'name', minLen: 512, sql: "ALTER TABLE album_musicians MODIFY COLUMN name VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'track_no', minLen: 64, sql: "ALTER TABLE songs MODIFY COLUMN track_no VARCHAR(64) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'title_en', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN title_en VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'isrc_code', minLen: 128, sql: "ALTER TABLE songs MODIFY COLUMN isrc_code VARCHAR(128) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'iswc_code', minLen: 128, sql: "ALTER TABLE songs MODIFY COLUMN iswc_code VARCHAR(128) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'autodia_code', minLen: 128, sql: "ALTER TABLE songs MODIFY COLUMN autodia_code VARCHAR(128) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'composer_gr', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN composer_gr VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'composer_en', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN composer_en VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'songwriter_gr', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN songwriter_gr VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'songwriter_en', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN songwriter_en VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'singer_gr', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN singer_gr VARCHAR(512) NOT NULL DEFAULT ''" },
        { tbl: 'songs', col: 'singer_en', minLen: 512, sql: "ALTER TABLE songs MODIFY COLUMN singer_en VARCHAR(512) NOT NULL DEFAULT ''" },
      ];

      for (const spec of widenSpecs) {
        const cur = colLen.get(`${spec.tbl}.${spec.col}`);
        if (cur && cur < spec.minLen) {
          await pool.query(spec.sql).catch(() => {});
        }
      }
    } catch {
      // Non-fatal if user lacks ALTER privileges
    }
  }

  public async getDbStatus(): Promise<DbStatus> {
    if (this.mysqlConnected && this.mysqlPool) {
      try {
        const [aRows] = await this.mysqlPool.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM albums');
        const [sRows] = await this.mysqlPool.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM songs');
        return {
          mode: 'mysql',
          connected: true,
          host: this.mysqlConfig.host,
          port: this.mysqlConfig.port,
          database: this.mysqlConfig.database,
          sqlitePath: this.sqlitePath,
          albumCount: Number(aRows[0]?.cnt || 0),
          songCount: Number(sRows[0]?.cnt || 0),
          autoConnect: this.mysqlConfig.autoConnect,
        };
      } catch (err) {
        this.mysqlConnected = false;
        this.lastMysqlError = err instanceof Error ? err.message : 'Lost MySQL connection';
      }
    }

    if (this.sqliteDb) {
      const aRows = this.sqliteAll<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM albums');
      const sRows = this.sqliteAll<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM songs');
      return {
        mode: 'sqlite',
        connected: true,
        host: this.mysqlConfig.host || undefined,
        port: this.mysqlConfig.port,
        database: this.mysqlConfig.database || undefined,
        sqlitePath: this.sqlitePath,
        error: this.lastMysqlError || undefined,
        albumCount: Number(aRows[0]?.cnt || 0),
        songCount: Number(sRows[0]?.cnt || 0),
        autoConnect: this.mysqlConfig.autoConnect,
      };
    }

    const local = this.readLocalStore();
    const songCount = local.albums.reduce((acc, a) => acc + a.songs.length, 0);
    return {
      mode: 'local',
      connected: true,
      host: this.mysqlConfig.host || undefined,
      port: this.mysqlConfig.port,
      database: this.mysqlConfig.database || undefined,
      error: this.lastSqliteError || this.lastMysqlError || undefined,
      albumCount: local.albums.length,
      songCount,
      autoConnect: this.mysqlConfig.autoConnect,
    };
  }

  public async syncLocalToMysql(): Promise<{ imported: number; skipped: number }> {
    if (!this.mysqlConnected || !this.mysqlPool) {
      throw new Error('MySQL is not connected.');
    }

    const localAlbums: Album[] = [];
    if (this.sqliteDb) {
      const ids = this.sqliteAll<{ id: number }>('SELECT id FROM albums ORDER BY id ASC');
      for (const row of ids) {
        const album = this.getAlbumFromSqlite(Number(row.id));
        if (album) localAlbums.push(album);
      }
    } else {
      localAlbums.push(...this.readLocalStore().albums);
    }

    const existing = await this.listAlbums();
    const { unique, skipped: skippedItems } = deduplicateAlbumBatch(localAlbums, existing);

    let imported = 0;
    for (const album of unique) {
      await this.createAlbum(album);
      imported += 1;
    }
    return { imported, skipped: skippedItems.length };
  }

  public async findDuplicateAlbum(candidate: Album, excludeId?: number): Promise<AlbumSummary | null> {
    const existing = await this.listAlbums();
    const filtered = excludeId ? existing.filter((a) => a.id !== excludeId) : existing;
    return findDuplicateInList(candidate, filtered);
  }

  public async importAlbumsDeduplicated(albums: Album[]): Promise<{
    imported: Album[];
    skipped: Array<{
      album_title: string;
      catalog_number: string;
      barcode: string;
      reason: 'database' | 'batch';
    }>;
    failed: Array<{
      album_title: string;
      catalog_number: string;
      error: string;
    }>;
  }> {
    const existing = await this.listAlbums();
    const { unique, skipped } = deduplicateAlbumBatch(albums, existing);

    const imported: Album[] = [];
    const failed: Array<{ album_title: string; catalog_number: string; error: string }> = [];

    // Fast path for SQLite: insert all unique albums and persist disk buffer once at the end
    if (!this.mysqlConnected && this.sqliteDb) {
      for (const album of unique) {
        try {
          const clean = this.normalizeAlbumPayload(album);
          const albumId = this.insertAlbumIntoSqlite(clean);
          const created = this.getAlbumFromSqlite(albumId);
          if (created) imported.push(created);
        } catch (err) {
          failed.push({
            album_title: album.album_title || 'Untitled',
            catalog_number: album.catalog_number || '',
            error: err instanceof Error ? err.message : 'Failed to import album',
          });
        }
      }
      if (imported.length > 0) {
        this.persistSqlite();
      }
    } else {
      for (const album of unique) {
        try {
          const saved = await this.createAlbum(album);
          imported.push(saved);
        } catch (err) {
          failed.push({
            album_title: album.album_title || 'Untitled',
            catalog_number: album.catalog_number || '',
            error: err instanceof Error ? err.message : 'Failed to import album',
          });
        }
      }
    }

    return {
      imported,
      skipped: skipped.map((s) => ({
        album_title: s.item.album_title,
        catalog_number: s.item.catalog_number,
        barcode: s.item.barcode,
        reason: s.reason,
      })),
      failed,
    };
  }

  // ---------------- Legacy JSON Local Store Fallback ----------------

  private ensureLocalStoreSeeded(): void {
    if (fs.existsSync(this.localStorePath)) return;
    const seeds = getInitialSeedAlbums();
    const now = new Date().toISOString();
    const seededAlbums: Album[] = seeds.map((album, idx) => {
      const stats = computeAlbumStats(album.songs);
      return {
        ...album,
        id: idx + 1,
        total_seconds: stats.totalSeconds,
        album_time: stats.formattedTime,
        created_at: now,
        updated_at: now,
      };
    });
    const store: LocalStore = {
      nextAlbumId: seededAlbums.length + 1,
      albums: seededAlbums,
    };
    fs.writeFileSync(this.localStorePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  private readLocalStore(): LocalStore {
    this.ensureLocalStoreSeeded();
    return JSON.parse(fs.readFileSync(this.localStorePath, 'utf-8')) as LocalStore;
  }

  private writeLocalStore(store: LocalStore): void {
    fs.writeFileSync(this.localStorePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  private normalizeAlbumPayload(input: Album): Album {
    const clampField = (v: unknown, maxLen: number): string => {
      const str = String(v ?? '').trim();
      return str.length > maxLen ? str.slice(0, maxLen) : str;
    };

    const songs: Song[] = (input.songs || []).map((s, idx) => {
      const total_seconds = computeSongSeconds(s.duration_min, s.duration_sec);
      return {
        ...s,
        track_no: clampField(s.track_no, 64),
        title_gr: clampField(s.title_gr, 255),
        title_en: clampField(s.title_en, 255),
        duration_min: s.duration_min ?? null,
        duration_sec: s.duration_sec ?? null,
        total_seconds,
        full_track: Boolean(s.full_track),
        pot_pouri: Boolean(s.pot_pouri),
        isrc_code: clampField(s.isrc_code, 128),
        iswc_code: clampField(s.iswc_code, 128),
        autodia_code: clampField(s.autodia_code, 128),
        composer_gr: clampField(s.composer_gr, 255),
        composer_en: clampField(s.composer_en, 255),
        songwriter_gr: clampField(s.songwriter_gr, 255),
        songwriter_en: clampField(s.songwriter_en, 255),
        digital_web_link: String(s.digital_web_link ?? '').trim(),
        singer_gr: clampField(s.singer_gr, 255),
        singer_en: clampField(s.singer_en, 255),
        aepi_percent: s.aepi_percent ?? null,
        final_aepi_percent: s.final_aepi_percent ?? null,
        notes: String(s.notes ?? '').trim(),
        sort_order: idx,
      };
    });

    const musicians: Musician[] = (input.musicians || [])
      .filter((m) => String(m.role || '').trim() || String(m.name || '').trim())
      .map((m, idx) => ({
        role: clampField(m.role, 128),
        name: clampField(m.name, 255),
        sort_order: idx,
      }));

    const stats = computeAlbumStats(songs);

    return {
      ...input,
      barcode: clampField(input.barcode, 64),
      catalog_number: clampField(input.catalog_number, 64),
      label: clampField(input.label, 128),
      phonographic_company: clampField(input.phonographic_company, 255),
      format: clampField(input.format || 'CD', 64) || 'CD',
      album_artist: clampField(input.album_artist, 255),
      featured_artists: String(input.featured_artists || '').trim(),
      album_title: clampField(input.album_title, 255),
      album_time: clampField(
        !input.album_time?.trim() || (input.album_time.trim() === '00:00' && stats.totalSeconds > 0)
          ? stats.formattedTime
          : input.album_time.trim(),
        32
      ),
      total_seconds: stats.totalSeconds,
      release_date: clampField(input.release_date, 64),
      return_date: clampField(input.return_date, 64),
      album_music_category: clampField(input.album_music_category, 128),
      producer: clampField(input.producer, 255),
      production_company: clampField(input.production_company, 255),
      print_design: clampField(input.print_design, 255),
      cd_digital_playlist_link: String(input.cd_digital_playlist_link || '').trim(),
      physical_product_web_link: String(input.physical_product_web_link || '').trim(),
      notes: String(input.notes || '').trim(),
      musicians,
      songs,
    };
  }

  private getAlbumFromSqlite(id: number): Album | null {
    const aRows = this.sqliteAll<Record<string, unknown>>('SELECT * FROM albums WHERE id = ?', [id]);
    if (aRows.length === 0) return null;
    const a = aRows[0];

    const mRows = this.sqliteAll<Record<string, unknown>>(
      'SELECT * FROM album_musicians WHERE album_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    const sRows = this.sqliteAll<Record<string, unknown>>(
      'SELECT * FROM songs WHERE album_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    return {
      id: Number(a.id),
      barcode: String(a.barcode || ''),
      catalog_number: String(a.catalog_number || ''),
      label: String(a.label || ''),
      phonographic_company: String(a.phonographic_company || ''),
      format: String(a.format || 'CD'),
      album_artist: String(a.album_artist || ''),
      featured_artists: String(a.featured_artists || ''),
      album_title: String(a.album_title || ''),
      album_time: String(a.album_time || '00:00'),
      total_seconds: Number(a.total_seconds || 0),
      release_date: String(a.release_date || ''),
      return_date: String(a.return_date || ''),
      album_music_category: String(a.album_music_category || ''),
      producer: String(a.producer || ''),
      production_company: String(a.production_company || ''),
      print_design: String(a.print_design || ''),
      cd_digital_playlist_link: String(a.cd_digital_playlist_link || ''),
      physical_product_web_link: String(a.physical_product_web_link || ''),
      notes: String(a.notes || ''),
      created_at: a.created_at ? String(a.created_at) : undefined,
      updated_at: a.updated_at ? String(a.updated_at) : undefined,
      musicians: mRows.map((m) => ({
        id: Number(m.id),
        role: String(m.role || ''),
        name: String(m.name || ''),
        sort_order: Number(m.sort_order || 0),
      })),
      songs: sRows.map((s) => ({
        id: Number(s.id),
        track_no: String(s.track_no || ''),
        title_gr: String(s.title_gr || ''),
        title_en: String(s.title_en || ''),
        duration_min: s.duration_min !== null && s.duration_min !== undefined ? Number(s.duration_min) : null,
        duration_sec: s.duration_sec !== null && s.duration_sec !== undefined ? Number(s.duration_sec) : null,
        total_seconds: Number(s.total_seconds || 0),
        full_track: Number(s.full_track) === 1,
        pot_pouri: Number(s.pot_pouri) === 1,
        isrc_code: String(s.isrc_code || ''),
        iswc_code: String(s.iswc_code || ''),
        autodia_code: String(s.autodia_code || ''),
        composer_gr: String(s.composer_gr || ''),
        composer_en: String(s.composer_en || ''),
        songwriter_gr: String(s.songwriter_gr || ''),
        songwriter_en: String(s.songwriter_en || ''),
        digital_web_link: String(s.digital_web_link || ''),
        singer_gr: String(s.singer_gr || ''),
        singer_en: String(s.singer_en || ''),
        aepi_percent: s.aepi_percent !== null && s.aepi_percent !== undefined ? Number(s.aepi_percent) : null,
        final_aepi_percent:
          s.final_aepi_percent !== null && s.final_aepi_percent !== undefined
            ? Number(s.final_aepi_percent)
            : null,
        notes: String(s.notes || ''),
        sort_order: Number(s.sort_order || 0),
      })),
    };
  }

  // ---------------- CRUD Operations ----------------

  public async listAlbums(query?: string): Promise<AlbumSummary[]> {
    const q = (query || '').trim().toLowerCase();

    if (this.mysqlConnected && this.mysqlPool) {
      const [rows] = await this.mysqlPool.query<RowDataPacket[]>(
        `SELECT 
          a.id, a.barcode, a.catalog_number, a.label, a.format,
          a.album_artist, a.album_title, a.album_time, a.total_seconds,
          a.release_date, a.album_music_category, a.producer, a.updated_at,
          COUNT(DISTINCT s.id) AS track_count,
          COALESCE(SUM(CASE WHEN s.full_track = 1 THEN 1 ELSE 0 END), 0) AS full_track_count,
          COALESCE(SUM(CASE WHEN s.pot_pouri = 1 THEN 1 ELSE 0 END), 0) AS pot_pouri_count,
          (SELECT COUNT(*) FROM album_musicians m WHERE m.album_id = a.id) AS musician_count
        FROM albums a
        LEFT JOIN songs s ON s.album_id = a.id
        GROUP BY a.id
        ORDER BY a.id DESC`
      );
      const mapped: AlbumSummary[] = rows.map((r) => ({
        id: Number(r.id),
        barcode: String(r.barcode || ''),
        catalog_number: String(r.catalog_number || ''),
        label: String(r.label || ''),
        format: String(r.format || ''),
        album_artist: String(r.album_artist || ''),
        album_title: String(r.album_title || ''),
        album_time: String(r.album_time || '00:00'),
        total_seconds: Number(r.total_seconds || 0),
        release_date: String(r.release_date || ''),
        album_music_category: String(r.album_music_category || ''),
        producer: String(r.producer || ''),
        track_count: Number(r.track_count || 0),
        full_track_count: Number(r.full_track_count || 0),
        pot_pouri_count: Number(r.pot_pouri_count || 0),
        musician_count: Number(r.musician_count || 0),
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
      }));
      if (!q) return mapped;
      return mapped.filter(
        (a) =>
          a.album_title.toLowerCase().includes(q) ||
          a.catalog_number.toLowerCase().includes(q) ||
          a.barcode.toLowerCase().includes(q) ||
          a.album_artist.toLowerCase().includes(q) ||
          a.label.toLowerCase().includes(q) ||
          a.album_music_category.toLowerCase().includes(q)
      );
    }

    if (this.sqliteDb) {
      const rows = this.sqliteAll<Record<string, unknown>>(
        `SELECT
          a.id, a.barcode, a.catalog_number, a.label, a.format,
          a.album_artist, a.album_title, a.album_time, a.total_seconds,
          a.release_date, a.album_music_category, a.producer, a.updated_at,
          COUNT(DISTINCT s.id) AS track_count,
          COALESCE(SUM(CASE WHEN s.full_track = 1 THEN 1 ELSE 0 END), 0) AS full_track_count,
          COALESCE(SUM(CASE WHEN s.pot_pouri = 1 THEN 1 ELSE 0 END), 0) AS pot_pouri_count,
          (SELECT COUNT(*) FROM album_musicians m WHERE m.album_id = a.id) AS musician_count
        FROM albums a
        LEFT JOIN songs s ON s.album_id = a.id
        GROUP BY a.id
        ORDER BY a.id DESC`
      );
      const mapped: AlbumSummary[] = rows.map((r) => ({
        id: Number(r.id),
        barcode: String(r.barcode || ''),
        catalog_number: String(r.catalog_number || ''),
        label: String(r.label || ''),
        format: String(r.format || ''),
        album_artist: String(r.album_artist || ''),
        album_title: String(r.album_title || ''),
        album_time: String(r.album_time || '00:00'),
        total_seconds: Number(r.total_seconds || 0),
        release_date: String(r.release_date || ''),
        album_music_category: String(r.album_music_category || ''),
        producer: String(r.producer || ''),
        track_count: Number(r.track_count || 0),
        full_track_count: Number(r.full_track_count || 0),
        pot_pouri_count: Number(r.pot_pouri_count || 0),
        musician_count: Number(r.musician_count || 0),
        updated_at: r.updated_at ? String(r.updated_at) : undefined,
      }));
      if (!q) return mapped;

      const matchingSongAlbumIds = new Set(
        this.sqliteAll<{ album_id: number }>(
          `SELECT DISTINCT album_id FROM songs
           WHERE LOWER(title_gr) LIKE ?
              OR LOWER(title_en) LIKE ?
              OR LOWER(isrc_code) LIKE ?
              OR LOWER(singer_gr) LIKE ?
              OR LOWER(composer_gr) LIKE ?`,
          [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
        ).map((row) => Number(row.album_id))
      );

      return mapped.filter(
        (a) =>
          a.album_title.toLowerCase().includes(q) ||
          a.catalog_number.toLowerCase().includes(q) ||
          a.barcode.toLowerCase().includes(q) ||
          a.album_artist.toLowerCase().includes(q) ||
          a.label.toLowerCase().includes(q) ||
          a.album_music_category.toLowerCase().includes(q) ||
          matchingSongAlbumIds.has(a.id)
      );
    }

    const store = this.readLocalStore();
    const summaries: AlbumSummary[] = store.albums
      .slice()
      .sort((a, b) => (b.id || 0) - (a.id || 0))
      .map((a) => {
        const stats = computeAlbumStats(a.songs);
        return {
          id: a.id || 0,
          barcode: a.barcode,
          catalog_number: a.catalog_number,
          label: a.label,
          format: a.format,
          album_artist: a.album_artist,
          album_title: a.album_title,
          album_time: a.album_time || stats.formattedTime,
          total_seconds: stats.totalSeconds,
          release_date: a.release_date,
          album_music_category: a.album_music_category,
          producer: a.producer,
          track_count: a.songs.length,
          full_track_count: stats.fullTrackCount,
          pot_pouri_count: stats.potPouriCount,
          musician_count: a.musicians.filter((m) => m.name || m.role).length,
          updated_at: a.updated_at,
        };
      });

    if (!q) return summaries;
    return summaries.filter((summary) => {
      const fullAlbum = store.albums.find((al) => al.id === summary.id);
      const matchesAlbum =
        summary.album_title.toLowerCase().includes(q) ||
        summary.catalog_number.toLowerCase().includes(q) ||
        summary.barcode.toLowerCase().includes(q) ||
        summary.album_artist.toLowerCase().includes(q) ||
        summary.label.toLowerCase().includes(q) ||
        summary.album_music_category.toLowerCase().includes(q);
      if (matchesAlbum) return true;
      return Boolean(
        fullAlbum?.songs.some(
          (s) =>
            s.title_gr.toLowerCase().includes(q) ||
            s.title_en.toLowerCase().includes(q) ||
            s.isrc_code.toLowerCase().includes(q) ||
            s.singer_gr.toLowerCase().includes(q) ||
            s.composer_gr.toLowerCase().includes(q)
        )
      );
    });
  }

  public async getAlbum(id: number): Promise<Album | null> {
    if (this.mysqlConnected && this.mysqlPool) {
      const [aRows] = await this.mysqlPool.query<RowDataPacket[]>('SELECT * FROM albums WHERE id = ?', [id]);
      if (aRows.length === 0) return null;
      const a = aRows[0];

      const [mRows] = await this.mysqlPool.query<RowDataPacket[]>(
        'SELECT * FROM album_musicians WHERE album_id = ? ORDER BY sort_order ASC, id ASC',
        [id]
      );
      const [sRows] = await this.mysqlPool.query<RowDataPacket[]>(
        'SELECT * FROM songs WHERE album_id = ? ORDER BY sort_order ASC, id ASC',
        [id]
      );

      return {
        id: Number(a.id),
        barcode: String(a.barcode || ''),
        catalog_number: String(a.catalog_number || ''),
        label: String(a.label || ''),
        phonographic_company: String(a.phonographic_company || ''),
        format: String(a.format || 'CD'),
        album_artist: String(a.album_artist || ''),
        featured_artists: String(a.featured_artists || ''),
        album_title: String(a.album_title || ''),
        album_time: String(a.album_time || '00:00'),
        total_seconds: Number(a.total_seconds || 0),
        release_date: String(a.release_date || ''),
        return_date: String(a.return_date || ''),
        album_music_category: String(a.album_music_category || ''),
        producer: String(a.producer || ''),
        production_company: String(a.production_company || ''),
        print_design: String(a.print_design || ''),
        cd_digital_playlist_link: String(a.cd_digital_playlist_link || ''),
        physical_product_web_link: String(a.physical_product_web_link || ''),
        notes: String(a.notes || ''),
        created_at: a.created_at ? new Date(a.created_at).toISOString() : undefined,
        updated_at: a.updated_at ? new Date(a.updated_at).toISOString() : undefined,
        musicians: mRows.map((m) => ({
          id: Number(m.id),
          role: String(m.role || ''),
          name: String(m.name || ''),
          sort_order: Number(m.sort_order || 0),
        })),
        songs: sRows.map((s) => ({
          id: Number(s.id),
          track_no: String(s.track_no || ''),
          title_gr: String(s.title_gr || ''),
          title_en: String(s.title_en || ''),
          duration_min: s.duration_min !== null ? Number(s.duration_min) : null,
          duration_sec: s.duration_sec !== null ? Number(s.duration_sec) : null,
          total_seconds: Number(s.total_seconds || 0),
          full_track: s.full_track === 1,
          pot_pouri: s.pot_pouri === 1,
          isrc_code: String(s.isrc_code || ''),
          iswc_code: String(s.iswc_code || ''),
          autodia_code: String(s.autodia_code || ''),
          composer_gr: String(s.composer_gr || ''),
          composer_en: String(s.composer_en || ''),
          songwriter_gr: String(s.songwriter_gr || ''),
          songwriter_en: String(s.songwriter_en || ''),
          digital_web_link: String(s.digital_web_link || ''),
          singer_gr: String(s.singer_gr || ''),
          singer_en: String(s.singer_en || ''),
          aepi_percent: s.aepi_percent !== null ? Number(s.aepi_percent) : null,
          final_aepi_percent: s.final_aepi_percent !== null ? Number(s.final_aepi_percent) : null,
          notes: String(s.notes || ''),
          sort_order: Number(s.sort_order || 0),
        })),
      };
    }

    if (this.sqliteDb) {
      return this.getAlbumFromSqlite(id);
    }

    const store = this.readLocalStore();
    return store.albums.find((a) => a.id === id) || null;
  }

  public async createAlbum(input: Album): Promise<Album> {
    const clean = this.normalizeAlbumPayload(input);

    if (this.mysqlConnected && this.mysqlPool) {
      const conn = await this.mysqlPool.getConnection();
      try {
        await conn.beginTransaction();
        const [res] = await conn.query<ResultSetHeader>(
          `INSERT INTO albums (
            barcode, catalog_number, label, phonographic_company, format,
            album_artist, featured_artists, album_title, album_time, total_seconds,
            release_date, return_date, album_music_category, producer, production_company,
            print_design, cd_digital_playlist_link, physical_product_web_link, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clean.barcode,
            clean.catalog_number,
            clean.label,
            clean.phonographic_company,
            clean.format,
            clean.album_artist,
            clean.featured_artists,
            clean.album_title,
            clean.album_time,
            clean.total_seconds,
            clean.release_date,
            clean.return_date,
            clean.album_music_category,
            clean.producer,
            clean.production_company,
            clean.print_design,
            clean.cd_digital_playlist_link,
            clean.physical_product_web_link,
            clean.notes,
          ]
        );
        const albumId = res.insertId;

        for (const m of clean.musicians) {
          await conn.query(
            'INSERT INTO album_musicians (album_id, role, name, sort_order) VALUES (?, ?, ?, ?)',
            [albumId, m.role, m.name, m.sort_order]
          );
        }

        for (const s of clean.songs) {
          await conn.query(
            `INSERT INTO songs (
              album_id, track_no, title_gr, title_en, duration_min, duration_sec,
              total_seconds, full_track, pot_pouri, isrc_code, iswc_code, autodia_code,
              composer_gr, composer_en, songwriter_gr, songwriter_en, digital_web_link,
              singer_gr, singer_en, aepi_percent, final_aepi_percent, notes, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              albumId,
              s.track_no,
              s.title_gr,
              s.title_en,
              s.duration_min,
              s.duration_sec,
              s.total_seconds,
              s.full_track ? 1 : null,
              s.pot_pouri ? 1 : null,
              s.isrc_code,
              s.iswc_code,
              s.autodia_code,
              s.composer_gr,
              s.composer_en,
              s.songwriter_gr,
              s.songwriter_en,
              s.digital_web_link,
              s.singer_gr,
              s.singer_en,
              s.aepi_percent,
              s.final_aepi_percent,
              s.notes,
              s.sort_order,
            ]
          );
        }

        await conn.commit();
        const created = await this.getAlbum(albumId);
        if (!created) throw new Error('Failed to load created album.');
        return created;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    if (this.sqliteDb) {
      const albumId = this.insertAlbumIntoSqlite(clean);
      this.persistSqlite();
      const created = this.getAlbumFromSqlite(albumId);
      if (!created) throw new Error('Failed to load created album from SQLite.');
      return created;
    }

    const store = this.readLocalStore();
    const now = new Date().toISOString();
    const newAlbum: Album = {
      ...clean,
      id: store.nextAlbumId++,
      created_at: now,
      updated_at: now,
    };
    store.albums.push(newAlbum);
    this.writeLocalStore(store);
    return newAlbum;
  }

  public async updateAlbum(id: number, input: Album): Promise<Album | null> {
    const clean = this.normalizeAlbumPayload(input);

    if (this.mysqlConnected && this.mysqlPool) {
      const conn = await this.mysqlPool.getConnection();
      try {
        await conn.beginTransaction();
        const [res] = await conn.query<ResultSetHeader>(
          `UPDATE albums SET
            barcode = ?, catalog_number = ?, label = ?, phonographic_company = ?, format = ?,
            album_artist = ?, featured_artists = ?, album_title = ?, album_time = ?, total_seconds = ?,
            release_date = ?, return_date = ?, album_music_category = ?, producer = ?, production_company = ?,
            print_design = ?, cd_digital_playlist_link = ?, physical_product_web_link = ?, notes = ?
          WHERE id = ?`,
          [
            clean.barcode,
            clean.catalog_number,
            clean.label,
            clean.phonographic_company,
            clean.format,
            clean.album_artist,
            clean.featured_artists,
            clean.album_title,
            clean.album_time,
            clean.total_seconds,
            clean.release_date,
            clean.return_date,
            clean.album_music_category,
            clean.producer,
            clean.production_company,
            clean.print_design,
            clean.cd_digital_playlist_link,
            clean.physical_product_web_link,
            clean.notes,
            id,
          ]
        );
        if (res.affectedRows === 0) {
          await conn.rollback();
          return null;
        }

        await conn.query('DELETE FROM album_musicians WHERE album_id = ?', [id]);
        for (const m of clean.musicians) {
          await conn.query(
            'INSERT INTO album_musicians (album_id, role, name, sort_order) VALUES (?, ?, ?, ?)',
            [id, m.role, m.name, m.sort_order]
          );
        }

        await conn.query('DELETE FROM songs WHERE album_id = ?', [id]);
        for (const s of clean.songs) {
          await conn.query(
            `INSERT INTO songs (
              album_id, track_no, title_gr, title_en, duration_min, duration_sec,
              total_seconds, full_track, pot_pouri, isrc_code, iswc_code, autodia_code,
              composer_gr, composer_en, songwriter_gr, songwriter_en, digital_web_link,
              singer_gr, singer_en, aepi_percent, final_aepi_percent, notes, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              s.track_no,
              s.title_gr,
              s.title_en,
              s.duration_min,
              s.duration_sec,
              s.total_seconds,
              s.full_track ? 1 : null,
              s.pot_pouri ? 1 : null,
              s.isrc_code,
              s.iswc_code,
              s.autodia_code,
              s.composer_gr,
              s.composer_en,
              s.songwriter_gr,
              s.songwriter_en,
              s.digital_web_link,
              s.singer_gr,
              s.singer_en,
              s.aepi_percent,
              s.final_aepi_percent,
              s.notes,
              s.sort_order,
            ]
          );
        }

        await conn.commit();
        return await this.getAlbum(id);
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    if (this.sqliteDb) {
      const existing = this.sqliteAll<{ id: number }>('SELECT id FROM albums WHERE id = ?', [id]);
      if (existing.length === 0) return null;

      this.sqliteDb.exec('BEGIN TRANSACTION;');
      try {
        this.sqliteRun(
          `UPDATE albums SET
            barcode = ?, catalog_number = ?, label = ?, phonographic_company = ?, format = ?,
            album_artist = ?, featured_artists = ?, album_title = ?, album_time = ?, total_seconds = ?,
            release_date = ?, return_date = ?, album_music_category = ?, producer = ?, production_company = ?,
            print_design = ?, cd_digital_playlist_link = ?, physical_product_web_link = ?, notes = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
          [
            clean.barcode,
            clean.catalog_number,
            clean.label,
            clean.phonographic_company,
            clean.format,
            clean.album_artist,
            clean.featured_artists,
            clean.album_title,
            clean.album_time,
            clean.total_seconds,
            clean.release_date,
            clean.return_date,
            clean.album_music_category,
            clean.producer,
            clean.production_company,
            clean.print_design,
            clean.cd_digital_playlist_link,
            clean.physical_product_web_link,
            clean.notes,
            id,
          ]
        );

        this.sqliteRun('DELETE FROM album_musicians WHERE album_id = ?', [id]);
        for (const m of clean.musicians) {
          this.sqliteRun(
            'INSERT INTO album_musicians (album_id, role, name, sort_order) VALUES (?, ?, ?, ?)',
            [id, m.role, m.name, m.sort_order]
          );
        }

        this.sqliteRun('DELETE FROM songs WHERE album_id = ?', [id]);
        for (const s of clean.songs) {
          this.sqliteRun(
            `INSERT INTO songs (
              album_id, track_no, title_gr, title_en, duration_min, duration_sec,
              total_seconds, full_track, pot_pouri, isrc_code, iswc_code, autodia_code,
              composer_gr, composer_en, songwriter_gr, songwriter_en, digital_web_link,
              singer_gr, singer_en, aepi_percent, final_aepi_percent, notes, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              s.track_no,
              s.title_gr,
              s.title_en,
              s.duration_min,
              s.duration_sec,
              s.total_seconds,
              s.full_track ? 1 : null,
              s.pot_pouri ? 1 : null,
              s.isrc_code,
              s.iswc_code,
              s.autodia_code,
              s.composer_gr,
              s.composer_en,
              s.songwriter_gr,
              s.songwriter_en,
              s.digital_web_link,
              s.singer_gr,
              s.singer_en,
              s.aepi_percent,
              s.final_aepi_percent,
              s.notes,
              s.sort_order,
            ]
          );
        }

        this.sqliteDb.exec('COMMIT;');
        this.persistSqlite();
        return this.getAlbumFromSqlite(id);
      } catch (err) {
        try {
          this.sqliteDb.exec('ROLLBACK;');
        } catch {
          // ignore
        }
        throw err;
      }
    }

    const store = this.readLocalStore();
    const idx = store.albums.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const updated: Album = {
      ...clean,
      id,
      created_at: store.albums[idx].created_at,
      updated_at: new Date().toISOString(),
    };
    store.albums[idx] = updated;
    this.writeLocalStore(store);
    return updated;
  }

  public async deleteAlbum(id: number): Promise<boolean> {
    if (this.mysqlConnected && this.mysqlPool) {
      const [res] = await this.mysqlPool.query<ResultSetHeader>('DELETE FROM albums WHERE id = ?', [id]);
      return res.affectedRows > 0;
    }

    if (this.sqliteDb) {
      this.sqliteDb.exec('PRAGMA foreign_keys = ON;');
      this.sqliteRun('DELETE FROM albums WHERE id = ?', [id]);
      const modified = this.sqliteDb.getRowsModified() > 0;
      if (modified) {
        this.persistSqlite();
      }
      return modified;
    }

    const store = this.readLocalStore();
    const before = store.albums.length;
    store.albums = store.albums.filter((a) => a.id !== id);
    if (store.albums.length === before) return false;
    this.writeLocalStore(store);
    return true;
  }
}
