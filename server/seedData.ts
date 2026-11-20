import fs from 'node:fs';
import path from 'node:path';
import type { Album } from '../src/types/catalog';
import { parseSpreadsheetRows } from '../src/utils/catalogMath';

function loadSampleFromTsv(relativeFile: string): Album | null {
  try {
    const absPath = path.resolve(process.cwd(), relativeFile);
    if (!fs.existsSync(absPath)) return null;
    const raw = fs.readFileSync(absPath, 'utf-8');
    const rows = raw.split(/\r?\n/).map((line) => line.split('\t'));
    return parseSpreadsheetRows(rows);
  } catch {
    return null;
  }
}

export function getInitialSeedAlbums(): Album[] {
  const albums: Album[] = [];
  const a4314 = loadSampleFromTsv('public/assets/aistudio/4314_ed51755c.txt');
  if (a4314) albums.push(a4314);
  const a4128 = loadSampleFromTsv('public/assets/aistudio/4128_c22d6e72.txt');
  if (a4128) albums.push(a4128);
  return albums;
}
