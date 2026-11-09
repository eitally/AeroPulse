/**
 * Native Binary ANT+ / Garmin .FIT Workout File Encoder
 * Generates spec-compliant binary .FIT workout files (FileType = 5)
 * compatible with Garmin Fenix, Forerunner, Epix, and Edge head units.
 */

export interface FitWorkoutStepInput {
  label: string;
  durationSecs: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  targetMinHrBpm?: number;
  targetMaxHrBpm?: number;
  intensity?: 'warmup' | 'active' | 'rest' | 'cooldown';
}

export interface FitWorkoutInput {
  name: string;
  sport: 'Cycling' | 'Running';
  steps: FitWorkoutStepInput[];
}

const FIT_CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function computeFitCrc(bytes: Uint8Array, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 0x0f];

    tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0x0f];
  }
  return crc & 0xffff;
}

function writeFixedAscii(buf: number[], text: string, fixedLen: number): void {
  const clean = text.replace(/[^\x20-\x7E]/g, '').slice(0, fixedLen - 1);
  for (let i = 0; i < fixedLen; i++) {
    buf.push(i < clean.length ? clean.charCodeAt(i) : 0x00);
  }
}

function writeUint16LE(buf: number[], val: number): void {
  const v = Math.max(0, Math.min(0xffff, Math.round(val)));
  buf.push(v & 0xff, (v >> 8) & 0xff);
}

function writeUint32LE(buf: number[], val: number): void {
  const v = Math.max(0, Math.round(val)) >>> 0;
  buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}

/**
 * Encodes a structured workout into a binary Garmin .FIT Uint8Array
 */
export function encodeGarminFitWorkout(workout: FitWorkoutInput): Uint8Array {
  const dataPayload: number[] = [];

  // FIT Epoch is 1989-12-31T00:00:00Z (631065600 unix seconds)
  const fitTimestamp = Math.max(0, Math.floor(Date.now() / 1000) - 631065600);

  // ---------------------------------------------------------------------------
  // 1. Definition Message: file_id (Global Mesg Num 0, Local Mesg 0)
  // ---------------------------------------------------------------------------
  dataPayload.push(
    0x40, // Definition header, local mesg 0
    0x00, // Reserved
    0x00, // Little Endian
    0x00,
    0x00, // Global Mesg Num = 0 (file_id)
    0x04, // 4 fields
    // Field 0: type (enum, 1 byte) -> 5 = workout
    0x00,
    0x01,
    0x00,
    // Field 1: manufacturer (uint16, 2 bytes) -> 1 = Garmin
    0x01,
    0x02,
    0x84,
    // Field 2: product (uint16, 2 bytes) -> 65534 = Thresh
    0x02,
    0x02,
    0x84,
    // Field 4: time_created (uint32, 4 bytes)
    0x04,
    0x04,
    0x86
  );

  // Data Message: file_id (Local Mesg 0)
  dataPayload.push(0x00); // Data header, local mesg 0
  dataPayload.push(0x05); // type = 5 (workout)
  writeUint16LE(dataPayload, 1); // manufacturer = 1 (Garmin)
  writeUint16LE(dataPayload, 2026); // product = Thresh
  writeUint32LE(dataPayload, fitTimestamp);

  // ---------------------------------------------------------------------------
  // 2. Definition Message: workout (Global Mesg Num 26, Local Mesg 1)
  // ---------------------------------------------------------------------------
  dataPayload.push(
    0x41, // Definition header, local mesg 1
    0x00, // Reserved
    0x00, // Little Endian
    0x1a,
    0x00, // Global Mesg Num = 26 (workout)
    0x03, // 3 fields
    // Field 4: sport (enum, 1 byte) -> 1 = running, 2 = cycling
    0x04,
    0x01,
    0x00,
    // Field 6: num_valid_steps (uint16, 2 bytes)
    0x06,
    0x02,
    0x84,
    // Field 8: wkt_name (string, 24 bytes)
    0x08,
    24,
    0x07
  );

  // Data Message: workout (Local Mesg 1)
  dataPayload.push(0x01); // Data header, local mesg 1
  dataPayload.push(workout.sport === 'Running' ? 0x01 : 0x02); // 1=Running, 2=Cycling
  writeUint16LE(dataPayload, workout.steps.length);
  writeFixedAscii(dataPayload, workout.name || 'Thresh Workout', 24);

  // ---------------------------------------------------------------------------
  // 3. Definition Message: workout_step (Global Mesg Num 27, Local Mesg 2)
  // ---------------------------------------------------------------------------
  dataPayload.push(
    0x42, // Definition header, local mesg 2
    0x00, // Reserved
    0x00, // Little Endian
    0x1b,
    0x00, // Global Mesg Num = 27 (workout_step)
    0x08, // 8 fields
    // Field 254: message_index (uint16, 2 bytes)
    0xfe,
    0x02,
    0x84,
    // Field 0: wkt_step_name (string, 16 bytes)
    0x00,
    16,
    0x07,
    // Field 1: duration_type (enum, 1 byte) -> 0 = time
    0x01,
    0x01,
    0x00,
    // Field 2: duration_value (uint32, 4 bytes) -> milliseconds
    0x02,
    0x04,
    0x86,
    // Field 3: target_type (enum, 1 byte) -> 4 = power, 1 = heart_rate, 2 = open
    0x03,
    0x01,
    0x00,
    // Field 4: target_value (uint32, 4 bytes) -> 0 = custom range
    0x04,
    0x04,
    0x86,
    // Field 5: custom_target_value_low (uint32, 4 bytes) -> watts + 1000 or bpm + 100
    0x05,
    0x04,
    0x86,
    // Field 6: custom_target_value_high (uint32, 4 bytes) -> watts + 1000 or bpm + 100
    0x06,
    0x04,
    0x86,
    // Field 7: intensity (enum, 1 byte) -> 0=active, 1=rest, 2=warmup, 3=cooldown
    0x07,
    0x01,
    0x00
  );

  // Fix field count to 9 (254, 0, 1, 2, 3, 4, 5, 6, 7)
  const defMesg2Start = dataPayload.length - (6 + 9 * 3);
  dataPayload[defMesg2Start + 5] = 0x09;

  // Data Messages: workout_step (Local Mesg 2)
  workout.steps.forEach((step, idx) => {
    dataPayload.push(0x02); // Data header, local mesg 2
    writeUint16LE(dataPayload, idx); // message_index
    writeFixedAscii(dataPayload, step.label || `Step ${idx + 1}`, 16);
    dataPayload.push(0x00); // duration_type = 0 (time)
    writeUint32LE(dataPayload, Math.max(1, step.durationSecs) * 1000); // duration in ms

    if (
      typeof step.targetMinWatts === 'number' &&
      typeof step.targetMaxWatts === 'number' &&
      step.targetMaxWatts > 0
    ) {
      dataPayload.push(0x04); // target_type = 4 (power)
      writeUint32LE(dataPayload, 0); // target_value = 0 (use custom low/high range)
      // FIT specification: absolute watts in workout_step use +1000W offset
      writeUint32LE(dataPayload, Math.round(step.targetMinWatts) + 1000);
      writeUint32LE(dataPayload, Math.round(step.targetMaxWatts) + 1000);
    } else if (
      typeof step.targetMinHrBpm === 'number' &&
      typeof step.targetMaxHrBpm === 'number' &&
      step.targetMaxHrBpm > 0
    ) {
      dataPayload.push(0x01); // target_type = 1 (heart_rate)
      writeUint32LE(dataPayload, 0);
      // FIT specification: absolute HR bpm uses +100 bpm offset
      writeUint32LE(dataPayload, Math.round(step.targetMinHrBpm) + 100);
      writeUint32LE(dataPayload, Math.round(step.targetMaxHrBpm) + 100);
    } else {
      dataPayload.push(0x02); // target_type = 2 (open)
      writeUint32LE(dataPayload, 0);
      writeUint32LE(dataPayload, 0);
      writeUint32LE(dataPayload, 0);
    }

    const intensityMap: Record<string, number> = {
      active: 0,
      rest: 1,
      warmup: 2,
      cooldown: 3,
    };
    dataPayload.push(intensityMap[step.intensity || 'active'] ?? 0);
  });

  // ---------------------------------------------------------------------------
  // Assemble 14-byte FIT Header + Data Payload + 2-byte File CRC
  // ---------------------------------------------------------------------------
  const dataSize = dataPayload.length;
  const header: number[] = [
    14, // Header size (14 bytes)
    0x10, // Protocol version 1.0
    0x08,
    0x08, // Profile version 20.56 (LE)
  ];
  writeUint32LE(header, dataSize);
  header.push(0x2e, 0x46, 0x49, 0x54); // ".FIT" ASCII magic
  const headerBytes = new Uint8Array(header);
  const headerCrc = computeFitCrc(headerBytes, 12);
  writeUint16LE(header, headerCrc);

  const fullWithoutCrc = new Uint8Array(14 + dataSize);
  fullWithoutCrc.set(new Uint8Array(header), 0);
  fullWithoutCrc.set(new Uint8Array(dataPayload), 14);

  const fileCrc = computeFitCrc(fullWithoutCrc, fullWithoutCrc.length);
  const finalFit = new Uint8Array(14 + dataSize + 2);
  finalFit.set(fullWithoutCrc, 0);
  finalFit[14 + dataSize] = fileCrc & 0xff;
  finalFit[14 + dataSize + 1] = (fileCrc >> 8) & 0xff;

  return finalFit;
}

/**
 * Triggers a browser download of a native Garmin .FIT workout file
 */
export function downloadGarminFitWorkoutFile(
  workout: FitWorkoutInput,
  dateIso?: string
): void {
  const bytes = encodeGarminFitWorkout(workout);
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (workout.name || 'thresh-workout')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  a.href = url;
  a.download = dateIso ? `${dateIso}-${safeName}.fit` : `${safeName}.fit`;
  a.click();
  URL.revokeObjectURL(url);
}
