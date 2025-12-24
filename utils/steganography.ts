/**
 * Core steganography utilities for LSB embedding, XOR encryption, and Bit-Sieve visualization
 */

import { Image } from "@cross/image";

/**
 * Detects image format from file data using @cross/image's format handlers
 * Returns format name or null if unknown
 * Uses the same detection logic as Image.decode() but without decoding
 */
export function detectImageFormat(data: Uint8Array): string | null {
  const formats = Image.getFormats();

  // Try each format handler's canDecode method (same as Image.decode does internally)
  for (const format of formats) {
    if (format.canDecode(data)) {
      return format.name;
    }
  }

  return null;
}

/**
 * Checks if a format is lossy (will destroy LSB data on re-encoding)
 */
export function isLossyFormat(format: string | null): boolean {
  if (!format) return false;
  const lossyFormats = ["jpeg", "webp"]; // WebP can be lossy or lossless, but we'll treat it as potentially lossy
  return lossyFormats.includes(format.toLowerCase());
}

/**
 * Gets a recommended output format based on input format
 * Always returns a lossless format to preserve LSB data
 */
export function getRecommendedOutputFormat(inputFormat: string | null): {
  format: string;
  reason: string;
  useWebP?: boolean;
} {
  // Use PNG as default (most compatible)
  // WebP lossless can be smaller but has less browser support
  const useWebP = typeof OffscreenCanvas !== "undefined";

  if (inputFormat && isLossyFormat(inputFormat)) {
    return {
      format: useWebP ? "webp" : "png",
      reason:
        `Original format (${inputFormat.toUpperCase()}) is lossy. Saving as ${
          useWebP ? "WebP lossless" : "PNG"
        } to preserve hidden data. File size may increase.`,
      useWebP,
    };
  }

  return {
    format: useWebP ? "webp" : "png",
    reason: `${
      useWebP ? "WebP lossless" : "PNG"
    } format preserves hidden data perfectly.`,
    useWebP,
  };
}

/**
 * XOR encrypts data using a cyclic password key
 * Each byte is XORed with the corresponding byte from the password (repeated as needed)
 */
export function xorEncrypt(data: Uint8Array, password: string): Uint8Array {
  if (password.length === 0) return data;

  const passwordBytes = new TextEncoder().encode(password);
  const result = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ passwordBytes[i % passwordBytes.length];
  }

  return result;
}

/**
 * XOR decrypts data (XOR is its own inverse)
 */
export function xorDecrypt(data: Uint8Array, password: string): Uint8Array {
  return xorEncrypt(data, password);
}

/**
 * Converts a byte array to a bit array
 * Each byte becomes 8 bits (LSB first)
 */
export function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8);

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    for (let j = 0; j < 8; j++) {
      bits[i * 8 + j] = (byte >> j) & 1;
    }
  }

  return bits;
}

/**
 * Converts a bit array back to bytes
 * 8 bits become 1 byte (LSB first)
 */
export function bitsToBytes(bits: Uint8Array): Uint8Array {
  const byteCount = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteCount);

  for (let i = 0; i < byteCount; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      const bitIndex = i * 8 + j;
      if (bitIndex < bits.length) {
        byte |= (bits[bitIndex] & 1) << j;
      }
    }
    bytes[i] = byte;
  }

  return bytes;
}

/**
 * Embeds message bits into the LSB of image pixels
 * Uses RGB channels only (skips alpha for better visual quality)
 * @param bitDepth Number of bits to use per byte (1-4)
 */
export function embedLSB(
  imageData: Uint8Array,
  messageBits: Uint8Array,
  bitDepth: number = 1,
): Uint8Array {
  if (bitDepth < 1 || bitDepth > 4) {
    throw new Error("Bit depth must be between 1 and 4");
  }

  const result = new Uint8Array(imageData);
  const maxBits = Math.floor((imageData.length / 4) * 3) * bitDepth;

  if (messageBits.length > maxBits) {
    throw new Error(
      `Message too large. Max capacity: ${maxBits} bits, got: ${messageBits.length} bits`,
    );
  }

  // Create mask to clear the bits we'll modify
  // 1 bit: 0xFE (11111110), 2 bits: 0xFC (11111100), 3 bits: 0xF8 (11111000), 4 bits: 0xF0 (11110000)
  const mask = 0xFF << bitDepth;

  let bitIndex = 0;
  for (let i = 0; i < imageData.length && bitIndex < messageBits.length; i++) {
    // Skip alpha channel (every 4th byte, index 3, 7, 11, etc.)
    if (i % 4 === 3) continue;

    // Extract bits for this byte (up to bitDepth bits)
    let bitsToEmbed = 0;
    for (let j = 0; j < bitDepth && bitIndex < messageBits.length; j++) {
      const bit = messageBits[bitIndex] & 1;
      bitsToEmbed |= bit << j;
      bitIndex++;
    }

    // Clear the bits we'll modify, then set them
    result[i] = (result[i] & mask) | bitsToEmbed;
  }

  return result;
}

/**
 * Extracts LSB bits from image pixels
 * Uses RGB channels only (skips alpha)
 * @param bitDepth Number of bits to extract per byte (1-4)
 */
export function extractLSB(
  imageData: Uint8Array,
  bitCount: number,
  bitDepth: number = 1,
): Uint8Array {
  if (bitDepth < 1 || bitDepth > 4) {
    throw new Error("Bit depth must be between 1 and 4");
  }

  const bits = new Uint8Array(bitCount);
  const maxBits = Math.floor((imageData.length / 4) * 3) * bitDepth; // RGB only
  const actualBitCount = Math.min(bitCount, maxBits);

  let bitIndex = 0;
  for (let i = 0; i < imageData.length && bitIndex < actualBitCount; i++) {
    // Skip alpha channel
    if (i % 4 === 3) continue;

    // Extract bits (up to bitDepth bits) from this byte
    for (let j = 0; j < bitDepth && bitIndex < actualBitCount; j++) {
      bits[bitIndex] = (imageData[i] >> j) & 1;
      bitIndex++;
    }
  }

  return bits;
}

/**
 * Generates a Bit-Sieve visualization
 * Creates a high-contrast visualization by amplifying LSB differences
 * Uses a checkerboard pattern to make LSB changes more visible
 */
export function generateBitSieve(imageData: Uint8Array): Uint8Array {
  const result = new Uint8Array(imageData.length);
  const width = Math.sqrt(imageData.length / 4); // Approximate width for pattern

  // Process as RGBA (4 bytes per pixel)
  for (let i = 0; i < imageData.length; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    // Extract LSB from R, G, B channels
    const rLSB = imageData[i] & 1;
    const gLSB = imageData[i + 1] & 1;
    const bLSB = imageData[i + 2] & 1;

    // Create high-contrast visualization
    // Use checkerboard pattern to make LSB=1 stand out more
    const checker = (x + y) % 2 === 0 ? 1 : 0;

    // If LSB=1, make it bright white, if LSB=0 make it dark
    // Apply checkerboard to create visual texture
    const rValue = rLSB ? (checker ? 255 : 200) : (checker ? 50 : 0);
    const gValue = gLSB ? (checker ? 255 : 200) : (checker ? 50 : 0);
    const bValue = bLSB ? (checker ? 255 : 200) : (checker ? 50 : 0);

    result[i] = rValue;
    result[i + 1] = gValue;
    result[i + 2] = bValue;
    result[i + 3] = 255; // Fully opaque
  }

  return result;
}

/**
 * Generates LSB statistics for display
 * Returns counts of LSB=1 vs LSB=0 per channel
 * Optionally compares with original to show how many bits were changed
 */
export function generateLSBStats(
  imageData: Uint8Array,
  originalData?: Uint8Array,
): {
  red: { ones: number; zeros: number; changed?: number };
  green: { ones: number; zeros: number; changed?: number };
  blue: { ones: number; zeros: number; changed?: number };
  total: { ones: number; zeros: number; changed?: number };
} {
  let redOnes = 0, redZeros = 0, redChanged = 0;
  let greenOnes = 0, greenZeros = 0, greenChanged = 0;
  let blueOnes = 0, blueZeros = 0, blueChanged = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    // Skip alpha channel
    const rLSB = imageData[i] & 1;
    const gLSB = imageData[i + 1] & 1;
    const bLSB = imageData[i + 2] & 1;

    if (rLSB) redOnes++;
    else redZeros++;
    if (gLSB) greenOnes++;
    else greenZeros++;
    if (bLSB) blueOnes++;
    else blueZeros++;

    // Compare with original if provided
    if (originalData && i < originalData.length) {
      const origRLSB = originalData[i] & 1;
      const origGLSB = originalData[i + 1] & 1;
      const origBLSB = originalData[i + 2] & 1;

      if (rLSB !== origRLSB) redChanged++;
      if (gLSB !== origGLSB) greenChanged++;
      if (bLSB !== origBLSB) blueChanged++;
    }
  }

  const result: {
    red: { ones: number; zeros: number; changed?: number };
    green: { ones: number; zeros: number; changed?: number };
    blue: { ones: number; zeros: number; changed?: number };
    total: { ones: number; zeros: number; changed?: number };
  } = {
    red: { ones: redOnes, zeros: redZeros },
    green: { ones: greenOnes, zeros: greenZeros },
    blue: { ones: blueOnes, zeros: blueZeros },
    total: {
      ones: redOnes + greenOnes + blueOnes,
      zeros: redZeros + greenZeros + blueZeros,
    },
  };

  if (originalData) {
    result.red.changed = redChanged;
    result.green.changed = greenChanged;
    result.blue.changed = blueChanged;
    result.total.changed = redChanged + greenChanged + blueChanged;
  }

  return result;
}

/**
 * Prepares a binary header for file embedding
 * Format: [Magic(1), NameLen(1), Name(N), FileSize(4)]
 */
export function prepareFileHeader(
  fileName: string,
  fileSize: number,
): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(fileName);
  const header = new Uint8Array(1 + 1 + fileNameBytes.length + 4);
  const view = new DataView(header.buffer);

  header[0] = 0x55; // Magic byte 'U' for UnderByte
  header[1] = fileNameBytes.length;
  header.set(fileNameBytes, 2);
  view.setUint32(2 + fileNameBytes.length, fileSize, true); // little-endian

  return header;
}

/**
 * Parses a file header from bit array (converted to bytes)
 * Returns header info or null if magic byte not found
 */
export function parseFileHeader(
  bytes: Uint8Array,
): { fileName: string; fileSize: number; payloadOffset: number } | null {
  if (bytes.length < 2 || bytes[0] !== 0x55) {
    return null; // No magic byte found
  }

  const nameLen = bytes[1];
  if (bytes.length < 2 + nameLen + 4) {
    return null; // Header incomplete
  }

  const fileNameBytes = bytes.slice(2, 2 + nameLen);
  const fileName = new TextDecoder().decode(fileNameBytes);

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const fileSize = view.getUint32(2 + nameLen, true); // little-endian

  const payloadOffset = 2 + nameLen + 4;

  return { fileName, fileSize, payloadOffset };
}

/**
 * Calculates the bit capacity of an image
 * Returns the number of bytes that can be hidden (using RGB channels)
 * @param bitDepth Number of bits to use per byte (1-4)
 */
export function calculateBitCapacity(
  width: number,
  height: number,
  bitDepth: number = 1,
): number {
  // RGB only (skip alpha), variable bits per byte
  return Math.floor((width * height * 3 * bitDepth) / 8);
}
