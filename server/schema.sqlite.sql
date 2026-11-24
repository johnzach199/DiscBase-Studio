-- DiscBase Studio — SQLite 3 Schema
-- Full support for Greek & English Unicode text (UTF-8)

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

CREATE INDEX IF NOT EXISTS idx_albums_catalog ON albums (catalog_number);
CREATE INDEX IF NOT EXISTS idx_albums_barcode ON albums (barcode);
CREATE INDEX IF NOT EXISTS idx_albums_title ON albums (album_title);
CREATE INDEX IF NOT EXISTS idx_albums_category ON albums (album_music_category);

CREATE TABLE IF NOT EXISTS album_musicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musicians_album ON album_musicians (album_id);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  disc_number INTEGER NOT NULL DEFAULT 1,
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
  lyrics TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_songs_album ON songs (album_id);
CREATE INDEX IF NOT EXISTS idx_songs_isrc ON songs (isrc_code);
CREATE INDEX IF NOT EXISTS idx_songs_iswc ON songs (iswc_code);
CREATE INDEX IF NOT EXISTS idx_songs_autodia ON songs (autodia_code);
CREATE INDEX IF NOT EXISTS idx_songs_title_gr ON songs (title_gr);
