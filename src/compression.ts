import { gzipSync, gunzipSync } from 'zlib';
import { MongoBinary } from './types';

/**
 * Type guard to check if a value is a MongoDB Binary object.
 * @param value - The value to check.
 * @returns True if the value is a MongoDB Binary object.
 */
export function isMongoBinary(value: unknown): value is MongoBinary {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as MongoBinary)._bsontype === 'Binary' &&
    Buffer.isBuffer((value as MongoBinary).buffer)
  );
}

/**
 * Decompress a gzip-compressed Buffer or MongoDB Binary and return the original JavaScript object.
 * This function handles both raw Buffer objects and MongoDB Binary objects.
 *
 * @param buffer - The compressed data (Buffer, MongoDB Binary, or null/undefined).
 * @returns The decompressed JavaScript object, or null if input is falsy.
 */
export function decompressObject(buffer: Buffer | MongoBinary | null | undefined): unknown {
  if (!buffer) {
    return null;
  }

  let targetBuffer: Buffer;

  if (isMongoBinary(buffer)) {
    targetBuffer = buffer.buffer;
  } else if (Buffer.isBuffer(buffer)) {
    targetBuffer = buffer;
  } else {
    return buffer;
  }

  const decompressedString = gunzipSync(targetBuffer).toString();
  return JSON.parse(decompressedString);
}

/**
 * Compress a JavaScript object using gzip compression.
 * This is useful for reducing storage space when saving complete document snapshots.
 *
 * @param obj - The object to compress.
 * @returns The compressed Buffer, or null if input is falsy.
 */
export function compressObject(obj: unknown): Buffer | null {
  if (!obj) {
    return null;
  }

  const jsonString = JSON.stringify(obj);
  return gzipSync(jsonString);
}
