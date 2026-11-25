import * as XLSX from 'xlsx';
import { NUMBERS_TEMPLATE_BASE64 } from './numbersTemplate';
import { buildZipArchive } from './zipBuilder';

const CFB_LIB: typeof XLSX.CFB =
  XLSX.CFB ||
  (XLSX as unknown as { default?: { CFB?: typeof XLSX.CFB } }).default?.CFB!;

const MAX_TILE_SIZE = 256;
const MAX_IWA_SNAPPY_CHUNK = 65536;
const DEFAULT_ROW_HEIGHT = 20.0;
const DEFAULT_COLUMN_WIDTH = 120.0;
const DEFAULT_PRE_BNC_BYTES = encodeUtf8('🤠');

interface ProtoField {
  type: number;
  data: Uint8Array;
}

type ProtoMessage = ProtoField[][];

interface IwaMessage {
  meta: ProtoMessage;
  data: Uint8Array;
}

interface IwaArchive {
  id: number;
  messages: IwaMessage[];
  merge?: boolean;
}

function u8concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function u8toDataview(u8: Uint8Array): DataView {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function float32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  u8toDataview(buf).setFloat32(0, value, true);
  return buf;
}

function parseVarint49(buf: Uint8Array, ptr: [number] = [0]): number {
  let l = ptr[0];
  let usz = buf[l] & 127;
  if (buf[l++] >= 128) {
    usz |= (buf[l] & 127) << 7;
    if (buf[l++] >= 128) {
      usz |= (buf[l] & 127) << 14;
      if (buf[l++] >= 128) {
        usz |= (buf[l] & 127) << 21;
        if (buf[l++] >= 128) {
          usz += (buf[l] & 127) * Math.pow(2, 28);
          ++l;
          if (buf[l++] >= 128) {
            usz += (buf[l] & 127) * Math.pow(2, 35);
            ++l;
            if (buf[l++] >= 128) {
              usz += (buf[l] & 127) * Math.pow(2, 42);
              ++l;
            }
          }
        }
      }
    }
  }
  ptr[0] = l;
  return usz;
}

function writeVarint49(v: number): Uint8Array {
  const bytes: number[] = [];
  let cur = Math.max(0, Math.floor(v));
  while (cur > 127) {
    bytes.push((cur % 128) | 128);
    cur = Math.floor(cur / 128);
  }
  bytes.push(cur % 128);
  return new Uint8Array(bytes);
}

function writeVarintBigInt(v: bigint): Uint8Array {
  const bytes: number[] = [];
  let cur = v < 0n ? 0n : v;
  while (cur > 127n) {
    bytes.push(Number(cur & 127n) | 128);
    cur >>= 7n;
  }
  bytes.push(Number(cur));
  return new Uint8Array(bytes);
}

function varintToI32(buf: Uint8Array): number {
  const ptr: [number] = [0];
  return parseVarint49(buf, ptr) | 0;
}

function parseShallow(buf: Uint8Array): ProtoMessage {
  const out: ProtoMessage = [];
  const ptr: [number] = [0];
  while (ptr[0] < buf.length) {
    const num = parseVarint49(buf, ptr);
    const type = num & 7;
    const fieldNum = Math.floor(num / 8);
    let res: Uint8Array;
    if (type === 0) {
      const start = ptr[0];
      while (ptr[0] < buf.length && buf[ptr[0]] >= 128) ptr[0]++;
      ptr[0]++;
      res = buf.slice(start, ptr[0]);
    } else if (type === 1) {
      res = buf.slice(ptr[0], ptr[0] + 8);
      ptr[0] += 8;
    } else if (type === 2) {
      const len = parseVarint49(buf, ptr);
      res = buf.slice(ptr[0], ptr[0] + len);
      ptr[0] += len;
    } else if (type === 5) {
      res = buf.slice(ptr[0], ptr[0] + 4);
      ptr[0] += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${type} for field ${fieldNum}`);
    }
    const v: ProtoField = { type, data: res };
    if (!out[fieldNum]) out[fieldNum] = [v];
    else out[fieldNum].push(v);
  }
  return out;
}

function writeShallow(proto: ProtoMessage): Uint8Array {
  const out: Uint8Array[] = [];
  proto.forEach((field, idx) => {
    if (!field) return;
    field.forEach((item) => {
      if (!item || !item.data) return;
      out.push(writeVarint49(idx * 8 + item.type));
      if (item.type === 2) out.push(writeVarint49(item.data.length));
      out.push(item.data);
    });
  });
  return u8concat(out);
}

function parseSnappyChunk(type: number, buf: Uint8Array): Uint8Array {
  if (type !== 0) throw new Error(`Unexpected Snappy chunk type ${type}`);
  const ptr: [number] = [0];
  const usz = parseVarint49(buf, ptr);
  let chunks: Uint8Array[] = [];
  while (ptr[0] < buf.length) {
    const tag = buf[ptr[0]] & 3;
    if (tag === 0) {
      let len = buf[ptr[0]++] >> 2;
      if (len < 60) {
        ++len;
      } else {
        const c = len - 59;
        len = buf[ptr[0]];
        if (c > 1) len |= buf[ptr[0] + 1] << 8;
        if (c > 2) len |= buf[ptr[0] + 2] << 16;
        if (c > 3) len |= buf[ptr[0] + 3] << 24;
        len >>>= 0;
        len++;
        ptr[0] += c;
      }
      chunks.push(buf.slice(ptr[0], ptr[0] + len));
      ptr[0] += len;
    } else {
      let offset = 0;
      let length = 0;
      if (tag === 1) {
        length = ((buf[ptr[0]] >> 2) & 7) + 4;
        offset = (buf[ptr[0]++] & 224) << 3;
        offset |= buf[ptr[0]++];
      } else {
        length = (buf[ptr[0]++] >> 2) + 1;
        if (tag === 2) {
          offset = buf[ptr[0]] | (buf[ptr[0] + 1] << 8);
          ptr[0] += 2;
        } else {
          offset =
            (buf[ptr[0]] |
              (buf[ptr[0] + 1] << 8) |
              (buf[ptr[0] + 2] << 16) |
              (buf[ptr[0] + 3] << 24)) >>>
            0;
          ptr[0] += 4;
        }
      }
      chunks = [u8concat(chunks)];
      if (offset === 0 || offset > chunks[0].length) {
        throw new Error(`Invalid Snappy backreference offset ${offset}`);
      }
      if (length >= offset) {
        chunks.push(chunks[0].slice(-offset));
        length -= offset;
        while (length >= chunks[chunks.length - 1].length) {
          chunks.push(chunks[chunks.length - 1]);
          length -= chunks[chunks.length - 1].length;
        }
      }
      chunks.push(chunks[0].slice(-offset, -offset + length));
    }
  }
  const o = u8concat(chunks);
  if (o.length !== usz) throw new Error(`Unexpected IWA decompressed length ${o.length} != ${usz}`);
  return o;
}

function decompressIwaFile(buf: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let l = 0;
  while (l < buf.length) {
    const t = buf[l++];
    const len = buf[l] | (buf[l + 1] << 8) | (buf[l + 2] << 16);
    l += 3;
    out.push(parseSnappyChunk(t, buf.slice(l, l + len)));
    l += len;
  }
  if (l !== buf.length) throw new Error('Invalid IWA framed stream');
  return u8concat(out);
}

function compressIwaFile(buf: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let l = 0;
  while (l < buf.length) {
    // Apple iWork readers enforce 65,536-byte max uncompressed Snappy chunks
    const c = Math.min(buf.length - l, MAX_IWA_SNAPPY_CHUNK);
    const frame = new Uint8Array(4);
    out.push(frame);
    const usz = writeVarint49(c);
    let L = usz.length;
    out.push(usz);
    if (c <= 60) {
      L++;
      out.push(new Uint8Array([(c - 1) << 2]));
    } else if (c <= 256) {
      L += 2;
      out.push(new Uint8Array([240, (c - 1) & 255]));
    } else if (c <= 65536) {
      L += 3;
      out.push(new Uint8Array([244, (c - 1) & 255, ((c - 1) >> 8) & 255]));
    } else {
      L += 4;
      out.push(new Uint8Array([248, (c - 1) & 255, ((c - 1) >> 8) & 255, ((c - 1) >> 16) & 255]));
    }
    out.push(buf.slice(l, l + c));
    L += c;
    frame[0] = 0;
    frame[1] = L & 255;
    frame[2] = (L >> 8) & 255;
    frame[3] = (L >> 16) & 255;
    l += c;
  }
  return u8concat(out);
}

function parseIwaFile(buf: Uint8Array): IwaArchive[] {
  const out: IwaArchive[] = [];
  const ptr: [number] = [0];
  while (ptr[0] < buf.length) {
    const len = parseVarint49(buf, ptr);
    const ai = parseShallow(buf.slice(ptr[0], ptr[0] + len));
    ptr[0] += len;
    const res: IwaArchive = {
      id: varintToI32(ai[1][0].data),
      messages: [],
    };
    (ai[2] || []).forEach((b) => {
      const mi = parseShallow(b.data);
      const fl = varintToI32(mi[3][0].data);
      res.messages.push({
        meta: mi,
        data: buf.slice(ptr[0], ptr[0] + fl),
      });
      ptr[0] += fl;
    });
    if (ai[3]?.[0]) {
      res.merge = (varintToI32(ai[3][0].data) >>> 0) > 0;
    }
    out.push(res);
  }
  return out;
}

function writeIwaFile(ias: IwaArchive[]): Uint8Array {
  const bufs: Uint8Array[] = [];
  ias.forEach((ia) => {
    const ai: ProtoMessage = [];
    ai[1] = [{ data: writeVarint49(ia.id), type: 0 }];
    ai[2] = [];
    if (ia.merge != null) {
      ai[3] = [{ data: writeVarint49(ia.merge ? 1 : 0), type: 0 }];
    }
    const midata: Uint8Array[] = [];
    ia.messages.forEach((mi) => {
      midata.push(mi.data);
      mi.meta[3] = [{ type: 0, data: writeVarint49(mi.data.length) }];
      ai[2].push({ data: writeShallow(mi.meta), type: 2 });
    });
    const aipayload = writeShallow(ai);
    bufs.push(writeVarint49(aipayload.length));
    bufs.push(aipayload);
    midata.forEach((mid) => bufs.push(mid));
  });
  return u8concat(bufs);
}

function parseTspReference(buf: Uint8Array): number {
  const pb = parseShallow(buf);
  return parseVarint49(pb[1][0].data);
}

function writeTspReference(id: number): Uint8Array {
  const msg: ProtoMessage = [];
  msg[1] = [{ type: 0, data: writeVarint49(id) }];
  return writeShallow(msg);
}

function writePackedVarints(values: number[]): Uint8Array {
  return u8concat(values.map((v) => writeVarint49(v)));
}

function writeDecimal128LE(buf: Uint8Array, offset: number, value: number): void {
  if (!Number.isFinite(value) || value === 0) {
    const exp = 6176;
    buf[offset + 15] |= exp >> 7;
    buf[offset + 14] |= (exp & 127) << 1;
    return;
  }

  const negative = value < 0;
  const abs = Math.abs(value);
  let str = abs.toString();
  if (/[eE]/.test(str)) {
    str = abs.toFixed(12).replace(/\.?0+$/, '');
  }
  const dotIdx = str.indexOf('.');
  let digits = dotIdx === -1 ? str : str.slice(0, dotIdx) + str.slice(dotIdx + 1);
  let scale = dotIdx === -1 ? 0 : str.length - dotIdx - 1;

  while (scale > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }

  let mantissa = BigInt(digits || '0');
  const exp = 6176 - scale;

  buf[offset + 15] |= (exp >> 7) & 0x7f;
  buf[offset + 14] |= (exp & 127) << 1;
  for (let i = 0; mantissa > 0n && i < 14; ++i) {
    buf[offset + i] = Number(mantissa & 0xffn);
    mantissa >>= 8n;
  }
  if (negative) {
    buf[offset + 15] |= 0x80;
  }
}

function writeNewStorage(
  cell: { t: 's' | 'n' | 'b'; v: string | number | boolean },
  sstIndex: Map<string, number>
): Uint8Array {
  const out = new Uint8Array(32);
  const dv = u8toDataview(out);
  let l = 12;
  let flags = 0;
  out[0] = 5;
  if (cell.t === 'n') {
    out[1] = 2;
    writeDecimal128LE(out, l, Number(cell.v));
    flags |= 1;
    l += 16;
  } else if (cell.t === 'b') {
    out[1] = 6;
    dv.setFloat64(l, cell.v ? 1 : 0, true);
    flags |= 2;
    l += 8;
  } else {
    const idx = sstIndex.get(String(cell.v));
    if (idx === undefined) throw new Error('String missing from Numbers SST');
    out[1] = 3;
    dv.setUint32(l, idx, true);
    flags |= 8;
    l += 4;
  }
  dv.setUint32(8, flags, true);
  // Every v5 record (16, 20, 28 bytes) is already 4-byte aligned for wide offsets
  return out.slice(0, l);
}

function buildTileRowInfo(
  rowIndexInTile: number,
  row: Array<string | number | boolean | null | undefined>,
  numCols: number,
  sstIndex: Map<string, number>
): { data: Uint8Array; cellCount: number } {
  const offsets = new Uint8Array(numCols * 2);
  offsets.fill(0xff);
  const dv = u8toDataview(offsets);

  const cellPayloads: Uint8Array[] = [];
  let currentOffset = 0;
  let cellCount = 0;

  for (let c = 0; c < numCols; c++) {
    const val = row[c];
    if (val === null || val === undefined || val === '') {
      continue;
    }
    let cellObj: { t: 's' | 'n' | 'b'; v: string | number | boolean };
    if (typeof val === 'number' && Number.isFinite(val)) {
      cellObj = { t: 'n', v: val };
    } else if (typeof val === 'boolean') {
      cellObj = { t: 'b', v: val };
    } else {
      cellObj = { t: 's', v: String(val) };
    }

    const cellBuf = writeNewStorage(cellObj, sstIndex);
    const wideOffset = currentOffset >> 2;
    if (wideOffset >= 65535) {
      break;
    }
    dv.setUint16(c * 2, wideOffset, true);
    cellPayloads.push(cellBuf);
    currentOffset += cellBuf.length;
    cellCount++;
  }

  const tri: ProtoMessage = [];
  tri[1] = [{ type: 0, data: writeVarint49(rowIndexInTile) }];
  tri[2] = [{ type: 0, data: writeVarint49(cellCount) }];
  tri[3] = [{ type: 2, data: DEFAULT_PRE_BNC_BYTES }];
  tri[4] = [{ type: 2, data: DEFAULT_PRE_BNC_BYTES }];
  tri[5] = [{ type: 0, data: writeVarint49(5) }];
  tri[6] = [{ type: 2, data: u8concat(cellPayloads) }];
  tri[7] = [{ type: 2, data: offsets }];
  tri[8] = [{ type: 0, data: writeVarint49(1) }];

  return { data: writeShallow(tri), cellCount };
}

/**
 * Serializes a 2D spreadsheet matrix into a genuine Apple `.numbers` ZIP/IWA archive Buffer.
 * Uses a complete Apple Numbers 14+ document container, multi-tile row splitting (256 rows/tile),
 * 64KB Snappy framing chunks, synced ColumnRowUIDMapArchive & CalculationEngine dependency ranges,
 * v5 cell buffers with wide offsets, and clean PKZIP headers.
 */
export function buildNumbersBuffer(
  matrix: Array<Array<string | number | boolean | null | undefined>>,
  sheetName = 'Sheet 1'
): Buffer {
  const normalizedRows =
    matrix.length > 0 ? matrix.map((r) => (Array.isArray(r) ? r : [])) : [['']];
  const numRows = Math.max(1, normalizedRows.length);
  const numCols = Math.max(
    1,
    normalizedRows.reduce((max, row) => Math.max(max, row.length), 1)
  );

  // Build 1-based Shared String Table (Apple Numbers reserves key 0)
  const sst: string[] = [];
  const sstIndex = new Map<string, number>();
  const sstRefCounts: number[] = [0];

  for (const row of normalizedRows) {
    for (let c = 0; c < numCols; c++) {
      const val = row[c];
      if (val !== null && val !== undefined && val !== '' && typeof val !== 'number' && typeof val !== 'boolean') {
        const s = String(val);
        let id = sstIndex.get(s);
        if (id === undefined) {
          id = sst.length + 1;
          sstIndex.set(s, id);
          sst.push(s);
          sstRefCounts[id] = 1;
        } else {
          sstRefCounts[id] = (sstRefCounts[id] || 0) + 1;
        }
      }
    }
  }

  if (!CFB_LIB?.read) {
    throw new Error('SheetJS CFB reader is unavailable.');
  }

  const templateBuf = Buffer.from(NUMBERS_TEMPLATE_BASE64, 'base64');
  const cfb = CFB_LIB.read(templateBuf, { type: 'buffer' });

  // Extract all real package files cleanly by relative path (without CFB's "Root Entry/" prefix)
  const fileMap = new Map<string, Buffer>();
  const objectLocation = new Map<number, string>();
  let maxArchiveId = 0;

  cfb.FileIndex.forEach((fi: { type: number; name: string; content: number[] | Uint8Array }, idx: number) => {
    if (fi.type !== 2) return;
    const rawPath = (cfb.FullPaths[idx] || '').replace(/^Root Entry\//, '');
    if (!rawPath || rawPath.startsWith('\u0001')) return;
    const bytes = Buffer.from(fi.content);
    fileMap.set(rawPath, bytes);

    if (/\.iwa$/i.test(rawPath)) {
      const raw = decompressIwaFile(new Uint8Array(bytes));
      const archives = parseIwaFile(raw);
      for (const ar of archives) {
        objectLocation.set(ar.id, rawPath);
        if (ar.id > maxArchiveId) maxArchiveId = ar.id;
      }
    }
  });

  const iwaCache = new Map<string, IwaArchive[]>();
  const loadIwaFile = (zipPath: string): IwaArchive[] => {
    const existing = iwaCache.get(zipPath);
    if (existing) return existing;
    const rawZipBytes = fileMap.get(zipPath);
    if (!rawZipBytes) throw new Error(`Missing template IWA entry ${zipPath}`);
    const parsed = parseIwaFile(decompressIwaFile(new Uint8Array(rawZipBytes)));
    iwaCache.set(zipPath, parsed);
    return parsed;
  };

  const loadObject = (id: number) => {
    const zipPath = objectLocation.get(id);
    if (!zipPath) throw new Error(`Missing IWA object ${id} in Numbers template`);
    const archives = loadIwaFile(zipPath);
    const packet = archives.find((a) => a.id === id);
    if (!packet) throw new Error(`Missing packet ${id} inside ${zipPath}`);
    return { zipPath, archives, packet };
  };

  // Document -> Sheet -> TableInfo -> TableModel
  const docLoaded = loadObject(1);
  const docPb = parseShallow(docLoaded.packet.messages[0].data);
  const sheetId = parseTspReference(docPb[1][0].data);

  const sheetLoaded = loadObject(sheetId);
  const sheetPb = parseShallow(sheetLoaded.packet.messages[0].data);
  const cleanSheetName = (sheetName || '').trim().slice(0, 64) || 'Sheet 1';
  sheetPb[1] = [{ type: 2, data: encodeUtf8(cleanSheetName) }];
  sheetLoaded.packet.messages[0].data = writeShallow(sheetPb);

  const tableInfoId = parseTspReference(sheetPb[2][0].data);
  const tableInfoLoaded = loadObject(tableInfoId);
  const tableInfoPb = parseShallow(tableInfoLoaded.packet.messages[0].data);
  const tableModelId = parseTspReference(tableInfoPb[2][0].data);

  const modelLoaded = loadObject(tableModelId);
  const pb = parseShallow(modelLoaded.packet.messages[0].data);

  pb[6] = [{ type: 0, data: writeVarint49(numRows) }];
  pb[7] = [{ type: 0, data: writeVarint49(numCols) }];
  pb[8] = [{ type: 2, data: encodeUtf8(cleanSheetName) }];

  // Populate ColumnRowUIDMapArchive with strictly ascending 128-bit TSP.UUIDs
  const cruidsRef = pb[46]?.[0]?.data ? parseTspReference(pb[46][0].data) : null;
  if (cruidsRef) {
    const cruidsPacket = modelLoaded.archives.find((a) => a.id === cruidsRef);
    if (cruidsPacket) {
      const cruids = parseShallow(cruidsPacket.messages[0].data);
      cruids[1] = [];
      cruids[2] = [];
      cruids[3] = [];
      for (let c = 0; c < numCols; c++) {
        const uuid: ProtoMessage = [];
        uuid[1] = [{ type: 0, data: writeVarintBigInt(0x8000000000420690n + BigInt(c)) }];
        uuid[2] = [{ type: 0, data: writeVarintBigInt(0x1000000000000001n + BigInt(c)) }];
        cruids[1].push({ type: 2, data: writeShallow(uuid) });
        const idxBytes = writeVarint49(c);
        cruids[2].push({ type: 0, data: idxBytes });
        cruids[3].push({ type: 0, data: idxBytes });
      }
      cruids[4] = [];
      cruids[5] = [];
      cruids[6] = [];
      for (let r = 0; r < numRows; r++) {
        const uuid: ProtoMessage = [];
        uuid[1] = [{ type: 0, data: writeVarintBigInt(0x8000000000726270n + BigInt(r)) }];
        uuid[2] = [{ type: 0, data: writeVarintBigInt(0x2000000000000001n + BigInt(r)) }];
        cruids[4].push({ type: 2, data: writeShallow(uuid) });
        const idxBytes = writeVarint49(r);
        cruids[5].push({ type: 0, data: idxBytes });
        cruids[6].push({ type: 0, data: idxBytes });
      }
      cruidsPacket.messages[0].data = writeShallow(cruids);
    }
  }

  // Update FormulaOwnerDependenciesArchive (mtype=4008, owner_kind=6, formula_owner=tableInfoId)
  for (const ar of modelLoaded.archives) {
    const mtype = varintToI32(ar.messages[0].meta[1][0].data);
    if (mtype !== 4008) continue;
    const depPb = parseShallow(ar.messages[0].data);
    const ownerKind = depPb[3]?.[0] ? varintToI32(depPb[3][0].data) : 0;
    const ownerRef = depPb[11]?.[0] ? parseTspReference(depPb[11][0].data) : 0;
    if (ownerKind === 6 || ownerRef === tableInfoId) {
      const rangeMsg: ProtoMessage = [];
      rangeMsg[1] = [{ type: 0, data: writeVarint49(0) }];
      rangeMsg[2] = [{ type: 0, data: writeVarint49(0) }];
      rangeMsg[3] = [{ type: 0, data: writeVarint49(numCols - 1) }];
      rangeMsg[4] = [{ type: 0, data: writeVarint49(numRows - 1) }];
      const encodedRange = writeShallow(rangeMsg);
      for (const spanField of [7, 8]) {
        if (depPb[spanField]?.[0]) {
          const spanPb = parseShallow(depPb[spanField][0].data);
          spanPb[2] = [{ type: 2, data: encodedRange }];
          spanPb[3] = [{ type: 2, data: encodedRange }];
          depPb[spanField][0].data = writeShallow(spanPb);
        }
      }
      ar.messages[0].data = writeShallow(depPb);
    }
  }

  const store = parseShallow(pb[4][0].data);

  // Update Row Headers with explicit non-zero size (20.0pt) and populated cell counts
  const rowHeaders = parseShallow(store[1][0].data);
  const rowHeaderRef = parseTspReference(rowHeaders[2][0].data);
  const rowHeaderLoaded = loadObject(rowHeaderRef);
  {
    const baseBucket = parseShallow(rowHeaderLoaded.packet.messages[0].data);
    baseBucket[1] = [{ type: 0, data: writeVarint49(1) }];
    baseBucket[2] = [];
    const defaultHeight = float32LE(DEFAULT_ROW_HEIGHT);
    for (let r = 0; r < numRows; r++) {
      let populated = 0;
      const row = normalizedRows[r];
      for (let c = 0; c < numCols; c++) {
        const v = row[c];
        if (v !== null && v !== undefined && v !== '') populated++;
      }
      const header: ProtoMessage = [];
      header[1] = [{ type: 0, data: writeVarint49(r) }];
      header[2] = [{ type: 5, data: defaultHeight }];
      header[3] = [{ type: 0, data: writeVarint49(0) }];
      header[4] = [{ type: 0, data: writeVarint49(populated) }];
      baseBucket[2].push({ type: 2, data: writeShallow(header) });
    }
    rowHeaderLoaded.packet.messages[0].data = writeShallow(baseBucket);
  }

  // Update Column Headers with explicit non-zero size (120.0pt) and populated cell counts
  const colHeaderRef = parseTspReference(store[2][0].data);
  const colHeaderLoaded = loadObject(colHeaderRef);
  {
    const baseBucket = parseShallow(colHeaderLoaded.packet.messages[0].data);
    baseBucket[1] = [{ type: 0, data: writeVarint49(1) }];
    baseBucket[2] = [];
    const defaultWidth = float32LE(DEFAULT_COLUMN_WIDTH);
    for (let c = 0; c < numCols; c++) {
      let populated = 0;
      for (let r = 0; r < numRows; r++) {
        const v = normalizedRows[r][c];
        if (v !== null && v !== undefined && v !== '') populated++;
      }
      const header: ProtoMessage = [];
      header[1] = [{ type: 0, data: writeVarint49(c) }];
      header[2] = [{ type: 5, data: defaultWidth }];
      header[3] = [{ type: 0, data: writeVarint49(0) }];
      header[4] = [{ type: 0, data: writeVarint49(populated) }];
      baseBucket[2].push({ type: 2, data: writeShallow(header) });
    }
    colHeaderLoaded.packet.messages[0].data = writeShallow(baseBucket);
  }

  // Update Shared String Table (1-based IDs + nextListID + reference counts)
  const sstRef = parseTspReference(store[4][0].data);
  const sstLoaded = loadObject(sstRef);
  {
    const sstData = parseShallow(sstLoaded.packet.messages[0].data);
    sstData[1] = [{ type: 0, data: writeVarint49(1) }];
    sstData[2] = [{ type: 0, data: writeVarint49(sst.length + 1) }];
    sstData[3] = sst.map((str, i) => {
      const id = i + 1;
      const entryMsg: ProtoMessage = [];
      entryMsg[1] = [{ type: 0, data: writeVarint49(id) }];
      entryMsg[2] = [{ type: 0, data: writeVarint49(sstRefCounts[id] || 1) }];
      entryMsg[3] = [{ type: 2, data: encodeUtf8(str) }];
      return { type: 2, data: writeShallow(entryMsg) };
    });
    sstLoaded.packet.messages[0].data = writeShallow(sstData);
  }

  // Split rows into 256-row Tiles (Tile 0 reuses template Tile, Tiles 1+ allocated & registered in PackageMetadata)
  const tileWrap = parseShallow(store[3][0].data);
  const firstTileEntry = parseShallow(tileWrap[1][0].data);
  const baseTileId = parseTspReference(firstTileEntry[2][0].data);
  const baseTileLoaded = loadObject(baseTileId);
  const tileMetaTemplate = baseTileLoaded.packet.messages[0].meta;

  const metadataLoaded = loadObject(2);
  const pkgMeta = parseShallow(metadataLoaded.packet.messages[0].data);
  let nextObjectId = Math.max(
    pkgMeta[1]?.[0] ? parseVarint49(pkgMeta[1][0].data) : maxArchiveId,
    maxArchiveId
  ) + 1;

  const numTiles = Math.ceil(numRows / MAX_TILE_SIZE);
  const tileRefsField: ProtoField[] = [];
  const rowTileTreeNodes: ProtoField[] = [];
  const newTileIds: number[] = [];

  for (let tileIdx = 0; tileIdx < numTiles; tileIdx++) {
    const rowStart = tileIdx * MAX_TILE_SIZE;
    const rowEnd = Math.min(numRows, rowStart + MAX_TILE_SIZE);
    const tileRowsCount = rowEnd - rowStart;

    const rowInfos: ProtoField[] = [];
    for (let r = rowStart; r < rowEnd; r++) {
      const { data: triData } = buildTileRowInfo(r - rowStart, normalizedRows[r], numCols, sstIndex);
      rowInfos.push({ type: 2, data: triData });
    }

    const tileMsg: ProtoMessage = [];
    tileMsg[1] = [{ type: 0, data: writeVarint49(0) }];
    tileMsg[2] = [{ type: 0, data: writeVarint49(0) }];
    tileMsg[3] = [{ type: 0, data: writeVarint49(0) }];
    tileMsg[4] = [{ type: 0, data: writeVarint49(tileRowsCount) }];
    tileMsg[5] = rowInfos;
    tileMsg[6] = [{ type: 0, data: writeVarint49(5) }];
    tileMsg[7] = [{ type: 0, data: writeVarint49(1) }];
    tileMsg[8] = [{ type: 0, data: writeVarint49(1) }];
    const encodedTile = writeShallow(tileMsg);

    let tileArchiveId: number;
    if (tileIdx === 0) {
      tileArchiveId = baseTileId;
      baseTileLoaded.packet.messages[0].data = encodedTile;
    } else {
      tileArchiveId = nextObjectId++;
      newTileIds.push(tileArchiveId);
      const cloneMeta: ProtoMessage = [];
      tileMetaTemplate.forEach((arr, idx) => {
        if (!arr) return;
        cloneMeta[idx] = arr.map((f) => ({ type: f.type, data: new Uint8Array(f.data) }));
      });
      const newArchive: IwaArchive = {
        id: tileArchiveId,
        messages: [{ meta: cloneMeta, data: encodedTile }],
      };
      const tileZipPath = `Index/Tables/Tile-${tileArchiveId}.iwa`;
      iwaCache.set(tileZipPath, [newArchive]);
    }

    const tileRefEntry: ProtoMessage = [];
    tileRefEntry[1] = [{ type: 0, data: writeVarint49(tileIdx) }];
    tileRefEntry[2] = [{ type: 2, data: writeTspReference(tileArchiveId) }];
    tileRefsField.push({ type: 2, data: writeShallow(tileRefEntry) });

    const treeNode: ProtoMessage = [];
    treeNode[1] = [{ type: 0, data: writeVarint49(rowStart) }];
    treeNode[2] = [{ type: 0, data: writeVarint49(tileIdx) }];
    rowTileTreeNodes.push({ type: 2, data: writeShallow(treeNode) });
  }

  tileWrap[1] = tileRefsField;
  tileWrap[2] = [{ type: 0, data: writeVarint49(MAX_TILE_SIZE) }];
  tileWrap[3] = [{ type: 0, data: writeVarint49(1) }];
  store[3][0].data = writeShallow(tileWrap);
  store[7] = [{ type: 0, data: writeVarint49(numTiles) }];
  store[9] = [{ type: 2, data: writeShallow([[], rowTileTreeNodes]) }];

  // Register any additional Tiles (>256 rows) in PackageMetadata (Index/Metadata.iwa)
  if (newTileIds.length > 0) {
    pkgMeta[1] = [{ type: 0, data: writeVarint49(nextObjectId - 1) }];
    if (!pkgMeta[3]) pkgMeta[3] = [];

    let calcEngineCompIdx = -1;
    pkgMeta[3].forEach((compField, idx) => {
      const compPb = parseShallow(compField.data);
      const pref = compPb[2]?.[0] ? new TextDecoder().decode(compPb[2][0].data) : '';
      if (pref === 'CalculationEngine') calcEngineCompIdx = idx;
    });

    for (const tileArchiveId of newTileIds) {
      const compInfo: ProtoMessage = [];
      compInfo[1] = [{ type: 0, data: writeVarint49(tileArchiveId) }];
      compInfo[2] = [{ type: 2, data: encodeUtf8('Tables/Tile') }];
      compInfo[3] = [{ type: 2, data: encodeUtf8(`Tables/Tile-${tileArchiveId}`) }];
      compInfo[4] = [{ type: 2, data: writePackedVarints([2, 0, 0]) }];
      compInfo[5] = [{ type: 2, data: writePackedVarints([2, 0, 0]) }];
      compInfo[10] = [{ type: 0, data: writeVarint49(0) }];
      compInfo[12] = [{ type: 0, data: writeVarint49(1) }];
      pkgMeta[3].push({ type: 2, data: writeShallow(compInfo) });

      if (calcEngineCompIdx >= 0) {
        const calcComp = parseShallow(pkgMeta[3][calcEngineCompIdx].data);
        if (!calcComp[6]) calcComp[6] = [];
        const extRef: ProtoMessage = [];
        extRef[1] = [{ type: 0, data: writeVarint49(tileArchiveId) }];
        calcComp[6].push({ type: 2, data: writeShallow(extRef) });
        pkgMeta[3][calcEngineCompIdx].data = writeShallow(calcComp);
      }
    }
    metadataLoaded.packet.messages[0].data = writeShallow(pkgMeta);
  }

  pb[4][0].data = writeShallow(store);
  modelLoaded.packet.messages[0].data = writeShallow(pb);

  // Flush all modified or created IWA files back into fileMap
  for (const [zipPath, archives] of iwaCache.entries()) {
    fileMap.set(zipPath, Buffer.from(compressIwaFile(writeIwaFile(archives))));
  }

  // Package cleanly into standard PKZIP via buildZipArchive
  const zipEntries = Array.from(fileMap.entries()).map(([name, data]) => ({ name, data }));
  return buildZipArchive(zipEntries);
}

export interface NumbersInternalsSummary {
  sheetName: string;
  numRows: number;
  numCols: number;
  cruidsPresent: boolean;
  cruidsColCount: number;
  cruidsRowCount: number;
  sstNextListId: number;
  sstCount: number;
  sstMinId: number;
  tileCount: number;
  tileStorageVersion: number | null;
  tileStorageFlag: number | null;
  tileRowVersions: number[];
  wideOffsetRowCount: number;
  hasPropertiesPlist: boolean;
  hasBuildVersionHistory: boolean;
  hasDocumentIdentifier: boolean;
  hasSheetJsMarker: boolean;
  calcEngineBytes: number;
}

export function inspectNumbersInternals(buf: Buffer): NumbersInternalsSummary {
  const cfb = CFB_LIB.read(buf, { type: 'buffer' });
  const archivesById = new Map<number, IwaArchive>();
  const zipPaths = new Set<string>();

  cfb.FileIndex.forEach((fi: { type: number; name: string; content: number[] | Uint8Array }, idx: number) => {
    if (fi.type !== 2) return;
    const rel = (cfb.FullPaths[idx] || '').replace(/^Root Entry\//, '');
    zipPaths.add(rel);
    if (!/\.iwa$/i.test(fi.name)) return;
    const raw = decompressIwaFile(new Uint8Array(fi.content));
    for (const ar of parseIwaFile(raw)) {
      archivesById.set(ar.id, ar);
    }
  });

  const doc = parseShallow(archivesById.get(1)!.messages[0].data);
  const sheetId = parseTspReference(doc[1][0].data);
  const sheetPb = parseShallow(archivesById.get(sheetId)!.messages[0].data);
  const sheetName = sheetPb[1]?.[0]?.data ? new TextDecoder().decode(sheetPb[1][0].data) : '';

  const tableInfoId = parseTspReference(sheetPb[2][0].data);
  const tableInfoPb = parseShallow(archivesById.get(tableInfoId)!.messages[0].data);
  const tableModelId = parseTspReference(tableInfoPb[2][0].data);
  const modelPb = parseShallow(archivesById.get(tableModelId)!.messages[0].data);

  const numRows = varintToI32(modelPb[6][0].data);
  const numCols = varintToI32(modelPb[7][0].data);

  const cruidsRef = modelPb[46]?.[0]?.data ? parseTspReference(modelPb[46][0].data) : null;
  const cruidsArchive = cruidsRef ? archivesById.get(cruidsRef) : undefined;
  const cruidsPb = cruidsArchive ? parseShallow(cruidsArchive.messages[0].data) : null;

  const store = parseShallow(modelPb[4][0].data);
  const sstRef = parseTspReference(store[4][0].data);
  const sstPb = parseShallow(archivesById.get(sstRef)!.messages[0].data);
  const sstIds = (sstPb[3] || []).map((entry) => varintToI32(parseShallow(entry.data)[1][0].data));

  const tileWrap = parseShallow(store[3][0].data);
  const tileEntries = tileWrap[1] || [];
  const tileRowVersions: number[] = [];
  let wideOffsetRowCount = 0;
  let firstTileVersion: number | null = null;
  let firstTileFlag: number | null = null;

  for (let tIdx = 0; tIdx < tileEntries.length; tIdx++) {
    const tl = parseShallow(tileEntries[tIdx].data);
    const tileRef = parseTspReference(tl[2][0].data);
    const tilePb = parseShallow(archivesById.get(tileRef)!.messages[0].data);
    if (tIdx === 0) {
      firstTileVersion = tilePb[6]?.[0] ? varintToI32(tilePb[6][0].data) : null;
      firstTileFlag = tilePb[7]?.[0] ? varintToI32(tilePb[7][0].data) : null;
    }
    for (const rowField of tilePb[5] || []) {
      const tri = parseShallow(rowField.data);
      tileRowVersions.push(tri[5]?.[0] ? varintToI32(tri[5][0].data) : 0);
      if (tri[8]?.[0] && varintToI32(tri[8][0].data) === 1) {
        wideOffsetRowCount++;
      }
    }
  }

  const calcEngineArchive = archivesById.get(904977);

  return {
    sheetName,
    numRows,
    numCols,
    cruidsPresent: Boolean(cruidsPb),
    cruidsColCount: cruidsPb?.[1]?.length ?? 0,
    cruidsRowCount: cruidsPb?.[4]?.length ?? 0,
    sstNextListId: sstPb[2]?.[0] ? varintToI32(sstPb[2][0].data) : 0,
    sstCount: sstIds.length,
    sstMinId: sstIds.length > 0 ? Math.min(...sstIds) : 0,
    tileCount: tileEntries.length,
    tileStorageVersion: firstTileVersion,
    tileStorageFlag: firstTileFlag,
    tileRowVersions,
    wideOffsetRowCount,
    hasPropertiesPlist: zipPaths.has('Metadata/Properties.plist'),
    hasBuildVersionHistory: zipPaths.has('Metadata/BuildVersionHistory.plist'),
    hasDocumentIdentifier: zipPaths.has('Metadata/DocumentIdentifier'),
    hasSheetJsMarker: buf.includes(Buffer.from('Sh33tJ5')),
    calcEngineBytes: calcEngineArchive?.messages[0]?.data?.length ?? 0,
  };
}
