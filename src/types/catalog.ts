export interface Musician {
  id?: number;
  role: string;
  name: string;
  sort_order: number;
}

export interface Song {
  id?: number;
  track_no: string;
  title_gr: string;
  title_en: string;
  duration_min: number | null;
  duration_sec: number | null;
  total_seconds: number;
  full_track: boolean;
  pot_pouri: boolean;
  isrc_code: string;
  iswc_code: string;
  autodia_code: string;
  composer_gr: string;
  composer_en: string;
  songwriter_gr: string;
  songwriter_en: string;
  digital_web_link: string;
  singer_gr: string;
  singer_en: string;
  aepi_percent: number | null;
  final_aepi_percent: number | null;
  notes: string;
  sort_order: number;
}

export interface Album {
  id?: number;
  barcode: string;
  catalog_number: string;
  label: string;
  phonographic_company: string;
  format: string;
  album_artist: string;
  featured_artists: string;
  album_title: string;
  album_time: string;
  total_seconds: number;
  release_date: string;
  return_date: string;
  album_music_category: string;
  producer: string;
  production_company: string;
  print_design: string;
  cd_digital_playlist_link: string;
  physical_product_web_link: string;
  notes: string;
  musicians: Musician[];
  songs: Song[];
  created_at?: string;
  updated_at?: string;
}

export interface AlbumSummary {
  id: number;
  barcode: string;
  catalog_number: string;
  label: string;
  format: string;
  album_artist: string;
  album_title: string;
  album_time: string;
  total_seconds: number;
  release_date: string;
  album_music_category: string;
  producer: string;
  track_count: number;
  full_track_count: number;
  pot_pouri_count: number;
  musician_count: number;
  updated_at?: string;
}

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  autoConnect: boolean;
}

export interface DbStatus {
  mode: 'mysql' | 'local';
  connected: boolean;
  host?: string;
  port?: number;
  database?: string;
  error?: string;
  albumCount: number;
  songCount: number;
  autoConnect: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  songErrors: Record<number, string[]>;
}
