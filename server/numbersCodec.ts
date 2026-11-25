import * as XLSX from 'xlsx';
import XLSX_ZAHL_PAYLOAD from 'xlsx/dist/xlsx.zahl.mjs';

const CFB_LIB: typeof XLSX.CFB =
  XLSX.CFB ||
  (XLSX as unknown as { default?: { CFB?: typeof XLSX.CFB } }).default?.CFB!;

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
  const usz = new Uint8Array(7);
  usz[0] = v & 127;
  let L = 1;
  let cur = v;
  sz: if (cur > 127) {
    usz[L - 1] |= 128;
    cur = Math.floor(cur / 128);
    usz[L] = cur & 127;
    ++L;
    if (cur <= 127) break sz;
    usz[L - 1] |= 128;
    cur = Math.floor(cur / 128);
    usz[L] = cur & 127;
    ++L;
    if (cur <= 127) break sz;
    usz[L - 1] |= 128;
    cur = Math.floor(cur / 128);
    usz[L] = cur & 127;
    ++L;
    if (cur <= 127) break sz;
    usz[L - 1] |= 128;
    cur = Math.floor(cur / 128);
    usz[L] = cur & 127;
    ++L;
    if (cur <= 127) break sz;
    usz[L - 1] |= 128;
    cur = Math.floor(cur / 128);
    usz[L] = cur & 127;
    ++L;
    if (cur <= 127) break sz;
    usz[L - 1] |= 128;
    cur = Math.floor(cur / 128);
    usz[L] = cur & 127;
    ++L;
  }
  return usz.slice(0, L);
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
    const c = Math.min(buf.length - l, 268435455);
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
    } else if (c <= 16777216) {
      L += 4;
      out.push(new Uint8Array([248, (c - 1) & 255, ((c - 1) >> 8) & 255, ((c - 1) >> 16) & 255]));
    } else {
      L += 5;
      out.push(
        new Uint8Array([
          252,
          (c - 1) & 255,
          ((c - 1) >> 8) & 255,
          ((c - 1) >> 16) & 255,
          ((c - 1) >>> 24) & 255,
        ])
      );
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

  // Trim any trailing fractional zeros
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

function writeNewStorage(cell: { t: 's' | 'n' | 'b'; v: string | number | boolean }, sstIndex: Map<string, number>): Uint8Array {
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
  return out.slice(0, l);
}

function writeOldStorage(cell: { t: 's' | 'n' | 'b'; v: string | number | boolean }, sstIndex: Map<string, number>): Uint8Array {
  const out = new Uint8Array(32);
  const dv = u8toDataview(out);
  let l = 12;
  let flags = 0;
  out[0] = 3;
  if (cell.t === 'n') {
    out[2] = 2;
    dv.setFloat64(l, Number(cell.v), true);
    flags |= 32;
    l += 8;
  } else if (cell.t === 'b') {
    out[2] = 6;
    dv.setFloat64(l, cell.v ? 1 : 0, true);
    flags |= 32;
    l += 8;
  } else {
    const idx = sstIndex.get(String(cell.v));
    if (idx === undefined) throw new Error('String missing from Numbers SST');
    out[2] = 3;
    dv.setUint32(l, idx, true);
    flags |= 16;
    l += 4;
  }
  dv.setUint32(4, flags, true);
  return out.slice(0, l);
}

function writeTileRow(
  tri: ProtoMessage,
  row: Array<string | number | boolean | null | undefined>,
  numCols: number,
  sstIndex: Map<string, number>
): number {
  const offsetByteLen = Math.max(tri[7]?.[0]?.data?.length || 510, numCols * 2);
  const newOffsets = new Uint8Array(offsetByteLen);
  const oldOffsets = new Uint8Array(offsetByteLen);
  newOffsets.fill(0xff);
  oldOffsets.fill(0xff);

  const dvNew = u8toDataview(newOffsets);
  const dvOld = u8toDataview(oldOffsets);
  const entries: Array<{ col: number; newBuf: Uint8Array; oldBuf: Uint8Array }> = [];
  let totalNewLen = 0;
  let totalOldLen = 0;

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

    const newBuf = writeNewStorage(cellObj, sstIndex);
    const oldBuf = writeOldStorage(cellObj, sstIndex);
    entries.push({ col: c, newBuf, oldBuf });
    totalNewLen += newBuf.length;
    totalOldLen += oldBuf.length;
  }

  const useWideOffsets = totalNewLen > 65530 || totalOldLen > 65530;
  const pad4 = (buf: Uint8Array): Uint8Array => {
    const rem = buf.length & 3;
    if (rem === 0) return buf;
    const padded = new Uint8Array(buf.length + (4 - rem));
    padded.set(buf);
    return padded;
  };

  let lastOffset = 0;
  let lastOldOffset = 0;
  const newPayloads: Uint8Array[] = [];
  const oldPayloads: Uint8Array[] = [];
  let cnt = 0;

  for (const item of entries) {
    const newBuf = useWideOffsets ? pad4(item.newBuf) : item.newBuf;
    const oldBuf = useWideOffsets ? pad4(item.oldBuf) : item.oldBuf;
    const encodedNewOffset = useWideOffsets ? lastOffset / 4 : lastOffset;
    const encodedOldOffset = useWideOffsets ? lastOldOffset / 4 : lastOldOffset;
    if (encodedNewOffset >= 65535 || encodedOldOffset >= 65535) {
      break;
    }

    dvNew.setUint16(item.col * 2, encodedNewOffset, true);
    dvOld.setUint16(item.col * 2, encodedOldOffset, true);
    newPayloads.push(newBuf);
    oldPayloads.push(oldBuf);
    lastOffset += newBuf.length;
    lastOldOffset += oldBuf.length;
    cnt++;
  }

  tri[2][0].data = writeVarint49(cnt);
  tri[5] = [{ type: 0, data: writeVarint49(5) }];
  tri[6] = [{ type: 2, data: u8concat(newPayloads) }];
  tri[7] = [{ type: 2, data: newOffsets }];
  tri[3] = [{ type: 2, data: u8concat(oldPayloads) }];
  tri[4] = [{ type: 2, data: oldOffsets }];
  if (useWideOffsets) {
    tri[8] = [{ type: 0, data: writeVarint49(1) }];
  } else {
    delete tri[8];
  }
  return cnt;
}

/**
 * Serializes a 2D spreadsheet matrix into an Apple `.numbers` ZIP/IWA archive Buffer.
 * Supports unlimited columns (all 23+ DiscBase columns) and full UTF-8 Greek/multi-line lyrics.
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

  if (!CFB_LIB?.read || !CFB_LIB?.find || !CFB_LIB?.write) {
    throw new Error('SheetJS CFB codec is unavailable.');
  }

  const cfb = CFB_LIB.read(XLSX_ZAHL_PAYLOAD, { type: 'base64' });
  const locations = new Map<number, string>();

  cfb.FileIndex.forEach((fi: { type: number; name: string; content: number[] | Uint8Array }, idx: number) => {
    const fp = cfb.FullPaths[idx];
    if (fi.type !== 2 || !/\.iwa$/i.test(fi.name)) return;
    const raw = decompressIwaFile(new Uint8Array(fi.content));
    const archives = parseIwaFile(raw);
    for (const ar of archives) {
      locations.set(ar.id, fp);
    }
  });

  const loadEntry = (id: number) => {
    const loc = locations.get(id);
    if (!loc) throw new Error(`Missing IWA object ${id} in Numbers template`);
    const entry = CFB_LIB.find(cfb, loc);
    if (!entry) throw new Error(`Missing CFB entry ${loc}`);
    const archives = parseIwaFile(decompressIwaFile(new Uint8Array(entry.content)));
    const packet = archives.find((a) => a.id === id);
    if (!packet) throw new Error(`Missing packet ${id} inside ${loc}`);
    return { entry, archives, packet };
  };

  // Document -> Sheet -> TableInfo -> TableModel
  const docLoaded = loadEntry(1);
  const docPb = parseShallow(docLoaded.packet.messages[0].data);
  const sheetId = parseTspReference(docPb[1][0].data);

  const sheetLoaded = loadEntry(sheetId);
  const sheetPb = parseShallow(sheetLoaded.packet.messages[0].data);
  if (sheetName.trim()) {
    sheetPb[1] = [{ type: 2, data: encodeUtf8(sheetName.trim().slice(0, 64)) }];
    sheetLoaded.packet.messages[0].data = writeShallow(sheetPb);
    const updatedSheetBytes = compressIwaFile(writeIwaFile(sheetLoaded.archives));
    sheetLoaded.entry.content = updatedSheetBytes as unknown as number[];
    sheetLoaded.entry.size = updatedSheetBytes.length;
  }

  const tableInfoId = parseTspReference(sheetPb[2][0].data);
  const tableInfoLoaded = loadEntry(tableInfoId);
  const tableInfoPb = parseShallow(tableInfoLoaded.packet.messages[0].data);
  const tableModelId = parseTspReference(tableInfoPb[2][0].data);

  const modelLoaded = loadEntry(tableModelId);
  const pb = parseShallow(modelLoaded.packet.messages[0].data);

  pb[6][0].data = writeVarint49(numRows);
  pb[7][0].data = writeVarint49(numCols);

  // Populate ColumnRowUIDMapArchive (in the same CalculationEngine.iwa archive set) so Numbers 14-16 maps all rows/cols
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
        const uidVal = writeVarint49(c + 420690);
        uuid[1] = [{ type: 0, data: uidVal }];
        uuid[2] = [{ type: 0, data: uidVal }];
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
        const uidVal = writeVarint49(r + 726270);
        uuid[1] = [{ type: 0, data: uidVal }];
        uuid[2] = [{ type: 0, data: uidVal }];
        cruids[4].push({ type: 2, data: writeShallow(uuid) });
        const idxBytes = writeVarint49(r);
        cruids[5].push({ type: 0, data: idxBytes });
        cruids[6].push({ type: 0, data: idxBytes });
      }
      cruidsPacket.messages[0].data = writeShallow(cruids);
    }
  }

  const store = parseShallow(pb[4][0].data);
  store[7][0].data = writeVarint49(numRows);

  // Update Row Headers
  const rowHeaders = parseShallow(store[1][0].data);
  const rowHeaderRef = parseTspReference(rowHeaders[2][0].data);
  const rowHeaderLoaded = loadEntry(rowHeaderRef);
  {
    const baseBucket = parseShallow(rowHeaderLoaded.packet.messages[0].data);
    const templateItem = baseBucket[2][0];
    baseBucket[2] = [];
    for (let r = 0; r < numRows; r++) {
      const bucket = parseShallow(templateItem.data);
      bucket[1][0].data = writeVarint49(r);
      bucket[4][0].data = writeVarint49(numCols);
      baseBucket[2].push({ type: templateItem.type, data: writeShallow(bucket) });
    }
    rowHeaderLoaded.packet.messages[0].data = writeShallow(baseBucket);
    const compressed = compressIwaFile(writeIwaFile(rowHeaderLoaded.archives));
    rowHeaderLoaded.entry.content = compressed as unknown as number[];
    rowHeaderLoaded.entry.size = compressed.length;
  }

  // Update Column Headers
  const colHeaderRef = parseTspReference(store[2][0].data);
  const colHeaderLoaded = loadEntry(colHeaderRef);
  {
    const baseBucket = parseShallow(colHeaderLoaded.packet.messages[0].data);
    const templateItem = baseBucket[2][0];
    baseBucket[2] = [];
    for (let c = 0; c < numCols; c++) {
      const bucket = parseShallow(templateItem.data);
      bucket[1][0].data = writeVarint49(c);
      bucket[4][0].data = writeVarint49(numRows);
      baseBucket[2].push({ type: templateItem.type, data: writeShallow(bucket) });
    }
    colHeaderLoaded.packet.messages[0].data = writeShallow(baseBucket);
    const compressed = compressIwaFile(writeIwaFile(colHeaderLoaded.archives));
    colHeaderLoaded.entry.content = compressed as unknown as number[];
    colHeaderLoaded.entry.size = compressed.length;
  }

  // Update Shared String Table (1-based IDs + accurate nextListID + reference counts)
  const sstRef = parseTspReference(store[4][0].data);
  const sstLoaded = loadEntry(sstRef);
  {
    const sstData = parseShallow(sstLoaded.packet.messages[0].data);
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
    const compressed = compressIwaFile(writeIwaFile(sstLoaded.archives));
    sstLoaded.entry.content = compressed as unknown as number[];
    sstLoaded.entry.size = compressed.length;
  }

  // Update Tile(s) preserving storage_version = 5 (tileData[6]) and storage = 1 (tileData[7])
  const tile = parseShallow(store[3][0].data);
  const tileEntryTemplate = tile[1][0];
  delete tile[2];
  tile[1] = [tileEntryTemplate];
  const tl = parseShallow(tileEntryTemplate.data);
  const tileRef = parseTspReference(tl[2][0].data);
  const tileLoaded = loadEntry(tileRef);
  {
    const tileData = parseShallow(tileLoaded.packet.messages[0].data);
    const rowLoadTemplate = new Uint8Array(tileData[5][0].data);
    tileData[5] = [];
    let cellCount = 0;
    for (let r = 0; r < numRows; r++) {
      const tilerow = parseShallow(rowLoadTemplate);
      cellCount += writeTileRow(tilerow, normalizedRows[r], numCols, sstIndex);
      tilerow[1][0].data = writeVarint49(r);
      tileData[5].push({ type: 2, data: writeShallow(tilerow) });
    }
    tileData[1] = [{ type: 0, data: writeVarint49(numCols) }];
    tileData[2] = [{ type: 0, data: writeVarint49(numRows) }];
    tileData[3] = [{ type: 0, data: writeVarint49(cellCount) }];
    tileData[4] = [{ type: 0, data: writeVarint49(numRows) }];
    tileData[6] = [{ type: 0, data: writeVarint49(5) }];
    tileData[7] = [{ type: 0, data: writeVarint49(1) }];
    tileLoaded.packet.messages[0].data = writeShallow(tileData);
    const compressed = compressIwaFile(writeIwaFile(tileLoaded.archives));
    tileLoaded.entry.content = compressed as unknown as number[];
    tileLoaded.entry.size = compressed.length;
  }
  tileEntryTemplate.data = writeShallow(tl);
  store[3][0].data = writeShallow(tile);

  pb[4][0].data = writeShallow(store);
  modelLoaded.packet.messages[0].data = writeShallow(pb);
  const compressedModel = compressIwaFile(writeIwaFile(modelLoaded.archives));
  modelLoaded.entry.content = compressedModel as unknown as number[];
  modelLoaded.entry.size = compressedModel.length;

  const zipBytes = CFB_LIB.write(cfb, { type: 'buffer', fileType: 'zip', compression: true });
  return Buffer.from(zipBytes);
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
  tileStorageVersion: number | null;
  tileStorageFlag: number | null;
  tileRowVersions: number[];
  wideOffsetRowCount: number;
}

export function inspectNumbersInternals(buf: Buffer): NumbersInternalsSummary {
  const cfb = CFB_LIB.read(buf, { type: 'buffer' });
  const archivesById = new Map<number, IwaArchive>();
  cfb.FileIndex.forEach((fi: { type: number; name: string; content: number[] | Uint8Array }, idx: number) => {
    if (fi.type !== 2 || !/\.iwa$/i.test(fi.name)) return;
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
  const tl = parseShallow(tileWrap[1][0].data);
  const tileRef = parseTspReference(tl[2][0].data);
  const tilePb = parseShallow(archivesById.get(tileRef)!.messages[0].data);

  const tileRowVersions: number[] = [];
  let wideOffsetRowCount = 0;
  for (const rowField of tilePb[5] || []) {
    const tri = parseShallow(rowField.data);
    tileRowVersions.push(tri[5]?.[0] ? varintToI32(tri[5][0].data) : 0);
    if (tri[8]?.[0] && varintToI32(tri[8][0].data) === 1) {
      wideOffsetRowCount++;
    }
  }

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
    tileStorageVersion: tilePb[6]?.[0] ? varintToI32(tilePb[6][0].data) : null,
    tileStorageFlag: tilePb[7]?.[0] ? varintToI32(tilePb[7][0].data) : null,
    tileRowVersions,
    wideOffsetRowCount,
  };
}

