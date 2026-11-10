import { describe, expect, it } from 'vitest';
import { gzipSync, zipSync } from 'fflate';
import { parseFitBinaryBuffer } from '../src/workers/activityProcessor.worker';
import { extractWorkoutEntriesFromArchiveBytes } from '../src/utils/archiveImporter';

/**
 * Builds a minimal valid binary Garmin `.FIT` file containing:
 *  - 14-byte FIT header (".FIT" magic)
 *  - Definition Message for Record (Global Message 20, local type 0) with:
 *      field 253 (timestamp, 4B uint32), field 7 (power, 2B uint16), field 3 (heartrate, 1B uint8)
 *  - 1 Normal Data Record setting anchor timestamp = 1,100,000,000, power = 265W, HR = 152 bpm
 *  - 3 Garmin 5-bit Compressed Timestamp Data Records (`header = 0x80 | (localType << 5) | offset5`)
 *    advancing timestamp by +1s each with powers 280W, 295W, 310W!
 */
function buildCompressedTimestampFitBuffer(): ArrayBuffer {
  const recordsBytes: number[] = [];

  // Definition message: header 0x40 (local msg 0), reserved 0, arch 0 (little-endian), globalMsgNum 20 (0x14, 0x00), numFields 3
  recordsBytes.push(0x40, 0x00, 0x00, 20, 0x00, 3);
  // Field 1: timestamp (253), size 4, baseType uint32 (0x86)
  recordsBytes.push(253, 4, 0x86);
  // Field 2: power (7), size 2, baseType uint16 (0x84)
  recordsBytes.push(7, 2, 0x84);
  // Field 3: heartrate (3), size 1, baseType uint8 (0x02)
  recordsBytes.push(3, 1, 0x02);

  const pushUint32LE = (arr: number[], val: number) => {
    arr.push(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff);
  };
  const pushUint16LE = (arr: number[], val: number) => {
    arr.push(val & 0xff, (val >>> 8) & 0xff);
  };

  const baseTs = 1_100_000_032; // lower 5 bits = 0 (divisible by 32 for clean 5-bit offsets 1, 2, 3)

  // Sample 0: Normal record header (0x00, local msg 0)
  recordsBytes.push(0x00);
  pushUint32LE(recordsBytes, baseTs);
  pushUint16LE(recordsBytes, 265);
  recordsBytes.push(152);

  // Samples 1..3: Compressed timestamp headers (`0x80 | (0 << 5) | offset`)
  // Wait — note record payload still carries defined fields in definition; compressed header supplies rolling timestamp!
  for (let step = 1; step <= 3; step++) {
    const compressedHeader = 0x80 | (0 << 5) | (step & 0x1f);
    recordsBytes.push(compressedHeader);
    pushUint32LE(recordsBytes, 0xffffffff); // invalid field 253 so parser MUST use compressed header timestamp!
    pushUint16LE(recordsBytes, 265 + step * 15);
    recordsBytes.push(152 + step * 2);
  }

  const dataSize = recordsBytes.length;
  const headerSize = 14;
  const totalBytes = new Uint8Array(headerSize + dataSize + 2);
  const dv = new DataView(totalBytes.buffer);

  dv.setUint8(0, 14); // header size
  dv.setUint8(1, 0x20); // protocol 2.0
  dv.setUint16(2, 2100, true); // profile
  dv.setUint32(4, dataSize, true); // data length
  // ".FIT" ASCII
  totalBytes[8] = 0x2e;
  totalBytes[9] = 0x46;
  totalBytes[10] = 0x49;
  totalBytes[11] = 0x54;
  dv.setUint16(12, 0, true); // header CRC

  totalBytes.set(recordsBytes, headerSize);
  dv.setUint16(headerSize + dataSize, 0, true); // trailing 2-byte CRC

  return totalBytes.buffer;
}

describe('.FIT Compressed Timestamp Binary Decoder & Bulk .ZIP/.GZ Archive Extractor', () => {
  it('decodes Garmin .FIT 5-bit compressed timestamp records with exact 1Hz watts & HR', () => {
    const fitBuf = buildCompressedTimestampFitBuffer();
    const parsed = parseFitBinaryBuffer(fitBuf, 'morning_threshold_ride.fit', {
      ftp: 300,
      indoorFtp: 290,
      lthr: 171,
      maxHr: 192,
      restingHr: 48,
      weightKg: 70,
    });

    expect(parsed.sportCategory).toBe('Cycling');
    expect(parsed.streams.time).toEqual([0, 1, 2, 3]);
    expect(parsed.streams.watts).toEqual([265, 280, 295, 310]);
    expect(parsed.streams.heartrate).toEqual([152, 154, 156, 158]);
  });

  it('unpacks bulk .ZIP archives containing nested .fit.gz and .gpx workouts while ignoring __MACOSX junk', () => {
    const rawFit = new Uint8Array(buildCompressedTimestampFitBuffer());
    const gzippedFit = gzipSync(rawFit);
    const sampleGpx = new TextEncoder().encode(
      '<?xml version="1.0"?><gpx><trk><name>Track Run</name></trk></gpx>'
    );

    const archiveBytes = zipSync({
      'activities/2026_11_09_ride.fit.gz': gzippedFit,
      'activities/2026_11_10_run.gpx': sampleGpx,
      '__MACOSX/._2026_11_09_ride.fit.gz': new Uint8Array([1, 2, 3]),
      'activities/readme.txt': new Uint8Array([65, 66]),
    });

    const extracted = extractWorkoutEntriesFromArchiveBytes('strava_export.zip', archiveBytes);
    expect(extracted).toHaveLength(2);

    const fitEntry = extracted.find((e) => e.extension === 'fit')!;
    expect(fitEntry.fileName).toBe('2026_11_09_ride.fit');
    expect(fitEntry.bytes.byteLength).toBe(rawFit.byteLength);

    const gpxEntry = extracted.find((e) => e.extension === 'gpx')!;
    expect(gpxEntry.fileName).toBe('2026_11_10_run.gpx');
  });
});
