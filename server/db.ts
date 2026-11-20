import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import type { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Album, AlbumSummary, DbStatus, Musician, MysqlConfig, Song } from '../src/types/catalog';
import { computeAlbumStats, computeSongSeconds } from '../src/utils/catalogMath';
import { getInitialSeedAlbums } from './seedData';

interface LocalStore {
  nextAlbumId: number;
  albums: Album[];
}

export class CatalogDatabase {
  private dataDir: string;
  private localStorePath: string;
  private configPath: string;
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
    this.mysqlConfig = this.loadMysqlConfig();
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

  public async initialize(): Promise<void> {
    this.ensureLocalStoreSeeded();
    if (
      this.mysqlConfig.autoConnect &&
      this.mysqlConfig.host.trim() &&
      this.mysqlConfig.user.trim() &&
      this.mysqlConfig.database.trim()
    ) {
      await this.connectMysql(this.mysqlConfig);
    }
  }

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
        error: err instanceof Error ? err.message : 'Unable to reach MySQL server.',
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
    try {
      // Ensure database exists first
      const bootstrapConn = await mysql.createConnection(this.buildPoolOptions(cfg, false));
      const safeDbName = cfg.database.trim().replace(/[^a-zA-Z0-9_$-]/g, '');
      await bootstrapConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      await bootstrapConn.end();

      const pool = mysql.createPool(this.buildPoolOptions({ ...cfg, database: safeDbName }, true));
      await this.ensureMysqlSchema(pool);
      this.mysqlPool = pool;
      this.mysqlConnected = true;
      this.lastMysqlError = '';
    } catch (err) {
      this.mysqlPool = null;
      this.mysqlConnected = false;
      this.lastMysqlError = err instanceof Error ? err.message : 'MySQL connection failed';
    }
  }

  private resolveSchemaPath(): string | null {
    const appRoot = process.env.APP_ROOT_DIR || '';
    const unpackedRoot = appRoot.endsWith('app.asar')
      ? appRoot.replace(/app\.asar$/, 'app.asar.unpacked')
      : '';
    const candidates = [
      unpackedRoot ? path.resolve(unpackedRoot, 'server/schema.sql') : '',
      appRoot ? path.resolve(appRoot, 'server/schema.sql') : '',
      typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../server/schema.sql') : '',
      path.resolve(process.cwd(), 'server/schema.sql'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private async ensureMysqlSchema(pool: Pool): Promise<void> {
    const schemaPath = this.resolveSchemaPath();
    if (!schemaPath) return;
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      await pool.query(stmt);
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
          albumCount: Number(aRows[0]?.cnt || 0),
          songCount: Number(sRows[0]?.cnt || 0),
          autoConnect: this.mysqlConfig.autoConnect,
        };
      } catch (err) {
        this.mysqlConnected = false;
        this.lastMysqlError = err instanceof Error ? err.message : 'Lost MySQL connection';
      }
    }

    const local = this.readLocalStore();
    const songCount = local.albums.reduce((acc, a) => acc + a.songs.length, 0);
    return {
      mode: 'local',
      connected: true,
      host: this.mysqlConfig.host || undefined,
      port: this.mysqlConfig.port,
      database: this.mysqlConfig.database || undefined,
      error: this.lastMysqlError || undefined,
      albumCount: local.albums.length,
      songCount,
      autoConnect: this.mysqlConfig.autoConnect,
    };
  }

  public async syncLocalToMysql(): Promise<{ imported: number; skipped: number }> {
    if (!this.mysqlConnected || !this.mysqlPool) {
      throw new Error('MySQL is not connected.');
    }
    const local = this.readLocalStore();
    const existing = await this.listAlbums();
    const existingKeys = new Set(
      existing.map((a) => `${a.catalog_number.toLowerCase()}::${a.barcode.toLowerCase()}`)
    );

    let imported = 0;
    let skipped = 0;
    for (const album of local.albums) {
      const key = `${album.catalog_number.toLowerCase()}::${album.barcode.toLowerCase()}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      await this.createAlbum(album);
      imported += 1;
    }
    return { imported, skipped };
  }

  // ---------------- Local Store Helpers ----------------

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
    const songs: Song[] = (input.songs || []).map((s, idx) => {
      const total_seconds = computeSongSeconds(s.duration_min, s.duration_sec);
      return {
        ...s,
        track_no: s.track_no ?? '',
        title_gr: s.title_gr ?? '',
        title_en: s.title_en ?? '',
        duration_min: s.duration_min ?? null,
        duration_sec: s.duration_sec ?? null,
        total_seconds,
        full_track: Boolean(s.full_track),
        pot_pouri: Boolean(s.pot_pouri),
        isrc_code: s.isrc_code ?? '',
        iswc_code: s.iswc_code ?? '',
        autodia_code: s.autodia_code ?? '',
        composer_gr: s.composer_gr ?? '',
        composer_en: s.composer_en ?? '',
        songwriter_gr: s.songwriter_gr ?? '',
        songwriter_en: s.songwriter_en ?? '',
        digital_web_link: s.digital_web_link ?? '',
        singer_gr: s.singer_gr ?? '',
        singer_en: s.singer_en ?? '',
        aepi_percent: s.aepi_percent ?? null,
        final_aepi_percent: s.final_aepi_percent ?? null,
        notes: s.notes ?? '',
        sort_order: idx,
      };
    });

    const musicians: Musician[] = (input.musicians || [])
      .filter((m) => m.role.trim() || m.name.trim())
      .map((m, idx) => ({
        role: m.role.trim(),
        name: m.name.trim(),
        sort_order: idx,
      }));

    const stats = computeAlbumStats(songs);

    return {
      ...input,
      barcode: (input.barcode || '').trim(),
      catalog_number: (input.catalog_number || '').trim(),
      label: (input.label || '').trim(),
      phonographic_company: (input.phonographic_company || '').trim(),
      format: (input.format || 'CD').trim(),
      album_artist: (input.album_artist || '').trim(),
      featured_artists: (input.featured_artists || '').trim(),
      album_title: (input.album_title || '').trim(),
      album_time: input.album_time?.trim() || stats.formattedTime,
      total_seconds: stats.totalSeconds,
      release_date: (input.release_date || '').trim(),
      return_date: (input.return_date || '').trim(),
      album_music_category: (input.album_music_category || '').trim(),
      producer: (input.producer || '').trim(),
      production_company: (input.production_company || '').trim(),
      print_design: (input.print_design || '').trim(),
      cd_digital_playlist_link: (input.cd_digital_playlist_link || '').trim(),
      physical_product_web_link: (input.physical_product_web_link || '').trim(),
      notes: (input.notes || '').trim(),
      musicians,
      songs,
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

    const store = this.readLocalStore();
    const before = store.albums.length;
    store.albums = store.albums.filter((a) => a.id !== id);
    if (store.albums.length === before) return false;
    this.writeLocalStore(store);
    return true;
  }
}
