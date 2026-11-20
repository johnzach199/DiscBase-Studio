import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZipArchive } from './zipBuilder';

test('buildZipArchive generates a valid PKZIP buffer with local and central headers', () => {
  const zip = buildZipArchive([
    { name: '.github/workflows/build-desktop.yml', data: Buffer.from('name: Build\non: push\n', 'utf-8') },
    { name: 'package.json', data: Buffer.from('{"name":"discbase-studio"}\n', 'utf-8') },
  ]);

  // Local file header signature PK\x03\x04
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  // End of central directory signature PK\x05\x06 at tail
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  // Entry count = 2
  assert.equal(zip.readUInt16LE(zip.length - 12), 2);
});
