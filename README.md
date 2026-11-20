# DiscBase Studio

**DiscBase Studio** is a desktop and web catalog workstation for managing music releases, tracklists, rights-society metadata (ISRC, ISWC, Autodia, AEPI %), and session musician credits in **MySQL Server** (or MariaDB), with spreadsheet-faithful manual entry and automated `.xlsx` / `.xls` / `.csv` / `.tsv` batch import.

---

## Features

- **Spreadsheet-Faithful Album & Track Editor**
  - **General Release Fields:** Phonographic company, Label, Format (`CD`, etc.), Catalog Number (`Αρ. Καταλόγου`), Barcode, General Title, Album Artist, Featured Artists, Release/Return Dates, Music Category, Producer, Production Company, Print/Design, and Web/Playlist links.
  - **Songs Grid:** Bilingual (`GR` / `EN`) titles, composers, songwriters, and singers, `min` / `sec` duration auto-calculation (`total_seconds`, `album_time`), `ΟΛΟΚΛΗΡΟ` (Full Track) and `ΠΟΤ-ΠΟΥΡΙ` (Medley) flags, `ISRC`, `ISWC`, `Autodia`, `ΠΟΣΟΣΤΟ ΑΕΠΙ %`, `ΤΕΛΙΚΟ ΠΟΣΟΣΤΟ`, YouTube/Digital links, and per-track notes.
  - **Session Musicians:** Dynamic role/instrument and musician rows (`Κλαρίνο`, `Όργανο`, `Κιθάρα/Λαούτο`, `Ντραμς`, `Μπάσο`, etc.) with live totals.
- **Automated `.xlsx` Import & Export**
  - Upload `.xlsx`, `.xls`, `.csv`, or tab-delimited `.txt` spreadsheets matching either the Greek studio sheet layout or English schema headers.
  - Multi-sheet workbook parsing with pre-commit preview, validation, and batch insert into MySQL.
  - Export any catalog album back to a formatted `.xlsx` workbook.
- **Zero-Friction MySQL Auto-Connect**
  - Automatically connects to your MySQL Server on launch using saved credentials or `.env` configuration.
  - Auto-creates the target database (if permitted) and initializes the `albums`, `album_musicians`, and `songs` tables (`utf8mb4_unicode_ci`) on first connect.
  - Falls back gracefully to a local persistent store when no MySQL server is reachable, with one-click **Push Local Records to MySQL** sync once connected.
- **Light & Dark Mode**
  - Built-in Light / Dark theme toggle in the top bar and settings panel with persistent preference.
- **Cross-Platform Desktop Executables**
  - Packages into native installers/binaries for **Fedora Linux** (`.rpm`, `.AppImage`), **macOS** (`.dmg`, `.zip`), and **Windows** (`.exe` installer & portable) via Electron and GitHub Actions.

---

## Database Schema

Tables are defined in [`server/schema.sql`](server/schema.sql) and initialized automatically when connecting to MySQL:

| Table | Purpose | Key Columns |
| :--- | :--- | :--- |
| `albums` | Release-level metadata & totals | `catalog_number`, `barcode`, `album_title`, `album_artist`, `total_seconds`, `album_time`, `producer`, `label`, `format` |
| `album_musicians` | Session musician credits per release | `album_id` (FK), `role`, `name`, `sort_order` |
| `songs` | Tracklist, durations & rights metadata | `album_id` (FK), `track_no`, `title_gr`, `title_en`, `duration_min`, `duration_sec`, `full_track`, `pot_pouri`, `isrc_code`, `iswc_code`, `autodia_code`, `aepi_percent`, `final_aepi_percent` |

All foreign keys use `ON DELETE CASCADE` and `utf8mb4_unicode_ci` for full Greek and English character support.

---

## Quick Start (Local Development)

### Prerequisites
- **Node.js 22+**
- *(Optional)* A running **MySQL 8.0+** or **MariaDB** server

### 1. Install dependencies
```bash
npm install --legacy-peer-deps
```

### 2. Configure MySQL auto-connect (optional)
Copy `.env.example` to `.env` and fill in your server credentials:
```env
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="3306"
MYSQL_DATABASE="discbase_catalog"
MYSQL_USER="your_mysql_user"
MYSQL_PASSWORD="your_mysql_password"
MYSQL_SSL="false"
MYSQL_AUTO_CONNECT="true"
PORT="3000"
```
You can also configure, test, and save credentials directly inside the app under **MySQL Setup**.

### 3. Run the application
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

### 4. Run tests & type checks
```bash
npm test
npm run lint
```

---

## Building Desktop Executables (Fedora, macOS, Windows)

### Option A: Automated via GitHub Actions (Recommended)
This repository includes both required packaging files:
- [`.github/workflows/build-desktop.yml`](.github/workflows/build-desktop.yml) — CI matrix workflow for Linux, macOS, and Windows.
- [`electron-builder.yml`](electron-builder.yml) — Electron Builder target and bundle configuration.

Push to `main` (or run **Actions → Build Cross-Platform Desktop Executables → Run workflow**) to generate downloadable artifacts:
- **`fedora-linux-packages`**: `.rpm` and `.AppImage`
- **`macos-packages`**: `.dmg` and `.zip`
- **`windows-packages`**: `.exe` (NSIS installer & portable executable)

### Option B: Local Desktop Build
Install Electron build tools once without modifying `package.json`:
```bash
npm install --no-save --legacy-peer-deps electron@35 electron-builder@25
```
Then build the frontend, bundled Express/MySQL server, and installer for your current OS:
```bash
npm run build:electron

# Fedora / Linux
npx electron-builder --linux rpm AppImage --config electron-builder.yml

# macOS
npx electron-builder --mac dmg zip --config electron-builder.yml

# Windows
npx electron-builder --win nsis portable --config electron-builder.yml
```
Packaged installers are written to `dist-electron/`.

---

## Project Structure

```text
.
├── .github/workflows/build-desktop.yml   # GitHub Actions multi-OS desktop build
├── electron/
│   ├── main.cjs                          # Electron main process & embedded server launcher
│   └── preload.cjs                       # Electron preload bridge
├── electron-builder.yml                  # Desktop packaging configuration
├── server/
│   ├── db.ts                             # MySQL pool + local persistent JSON store
│   ├── schema.sql                        # MySQL DDL (albums, album_musicians, songs)
│   ├── seedData.ts                       # Initial sample catalog loader
│   └── zipBuilder.ts                     # GitHub source archive builder
├── server.ts                             # Express API & Vite/static server entry point
└── src/
    ├── components/                       # Catalog browser, sheet editor, XLSX importer, MySQL setup
    ├── types/                            # Shared TypeScript interfaces
    └── utils/                            # Duration math, validation, spreadsheet parser/exporter
```
