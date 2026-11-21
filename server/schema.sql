-- DiscBase Studio — MySQL 8.0 / MariaDB Schema
-- Full support for Greek & English Unicode text (utf8mb4)

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
