/**
 * Core steganography utilities for embedding, extraction, XOR encryption, and visualization
 * Supports both pixel-domain (LSB for lossless formats) and coefficient-domain (DCT for JPEG) steganography
 */

import {
  Image,
  type JPEGComponentCoefficients,
  type JPEGQuantizedCoefficients,
} from "@cross/image";

/**
 * Detects image format from file data using @cross/image's format handlers
 * Returns format name or null if unknown
 * Uses the same detection logic as Image.decode() but without decoding
 */
export function detectImageFormat(data: Uint8Array): string | null {
  const formats = Image.getFormats();

  for (const format of formats) {
    if (format.canDecode(data)) {
      return format.name;
    }
  }

  return null;
}

/**
 * Checks if a format is lossy (will destroy pixel-domain embedding data on re-encoding)
 */
export function isLossyFormat(format: string | null): boolean {
  if (!format) return false;
  const lossyFormats = ["jpeg", "webp"];
  return lossyFormats.includes(format.toLowerCase());
}

/**
 * Gets a recommended output format based on input format
 * Always returns a lossless format to preserve pixel-domain embedding data
 */
export function getRecommendedOutputFormat(inputFormat: string | null): {
  format: string;
  reason: string;
  useWebP?: boolean;
} {
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

  const mask = 0xFF << bitDepth;

  let bitIndex = 0;
  for (let i = 0; i < imageData.length && bitIndex < messageBits.length; i++) {
    if (i % 4 === 3) continue;

    let bitsToEmbed = 0;
    for (let j = 0; j < bitDepth && bitIndex < messageBits.length; j++) {
      const bit = messageBits[bitIndex] & 1;
      bitsToEmbed |= bit << j;
      bitIndex++;
    }

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
  const maxBits = Math.floor((imageData.length / 4) * 3) * bitDepth;
  const actualBitCount = Math.min(bitCount, maxBits);

  let bitIndex = 0;
  for (let i = 0; i < imageData.length && bitIndex < actualBitCount; i++) {
    if (i % 4 === 3) continue;

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
  const width = Math.sqrt(imageData.length / 4);

  for (let i = 0; i < imageData.length; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    const rLSB = imageData[i] & 1;
    const gLSB = imageData[i + 1] & 1;
    const bLSB = imageData[i + 2] & 1;

    const checker = (x + y) % 2 === 0 ? 1 : 0;

    const rValue = rLSB ? (checker ? 255 : 200) : (checker ? 50 : 0);
    const gValue = gLSB ? (checker ? 255 : 200) : (checker ? 50 : 0);
    const bValue = bLSB ? (checker ? 255 : 200) : (checker ? 50 : 0);

    result[i] = rValue;
    result[i + 1] = gValue;
    result[i + 2] = bValue;
    result[i + 3] = 255;
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
    const rLSB = imageData[i] & 1;
    const gLSB = imageData[i + 1] & 1;
    const bLSB = imageData[i + 2] & 1;

    if (rLSB) redOnes++;
    else redZeros++;
    if (gLSB) greenOnes++;
    else greenZeros++;
    if (bLSB) blueOnes++;
    else blueZeros++;

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

  header[0] = 0x55;
  header[1] = fileNameBytes.length;
  header.set(fileNameBytes, 2);
  view.setUint32(2 + fileNameBytes.length, fileSize, true);

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
    return null;
  }

  const nameLen = bytes[1];
  if (nameLen > MAX_FILENAME_LENGTH || bytes.length < 2 + nameLen + 4) {
    return null;
  }

  const fileNameBytes = bytes.slice(2, 2 + nameLen);
  const fileName = new TextDecoder("utf-8", { fatal: false }).decode(
    fileNameBytes,
  );

  if (!fileName || fileName.length === 0) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const fileSize = view.getUint32(2 + nameLen, true);

  if (fileSize > MAX_EMBED_FILE_SIZE || fileSize <= 0) {
    return null;
  }

  const payloadOffset = 2 + nameLen + 4;

  if (bytes.length < payloadOffset + fileSize) {
    return null;
  }

  return {
    fileName: sanitizeFilename(fileName),
    fileSize,
    payloadOffset,
  };
}

/**
 * Maximum file size limits (in bytes)
 */
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_EMBED_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGE_DIMENSION = 10000; // 10,000 pixels
export const MAX_FILENAME_LENGTH = 255;

/**
 * Validates image dimensions to prevent memory exhaustion
 */
export function validateImageDimensions(
  width: number,
  height: number,
): void {
  if (
    width <= 0 || height <= 0 || !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    throw new Error("Invalid image dimensions");
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new Error(
      `Image dimensions too large: ${width}x${height} (maximum ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION})`,
    );
  }
  const pixelCount = width * height;
  const maxPixels = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION;
  if (pixelCount > maxPixels) {
    throw new Error(
      `Image size too large: ${pixelCount} pixels (maximum ${maxPixels})`,
    );
  }
}

/**
 * Sanitizes a filename to prevent path traversal and XSS attacks
 * Removes path separators, limits length, and validates characters
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || filename.length === 0) {
    return "file";
  }

  let sanitized = filename
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/^\.+/, "")
    .trim();

  if (sanitized.length === 0) {
    return "file";
  }

  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const ext = sanitized.lastIndexOf(".");
    if (ext > 0) {
      const name = sanitized.substring(0, ext);
      const extension = sanitized.substring(ext);
      sanitized = name.substring(0, MAX_FILENAME_LENGTH - extension.length) +
        extension;
    } else {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH);
    }
  }

  return sanitized;
}

/**
 * Validates file size before processing
 */
export function validateFileSize(size: number, maxSize: number): void {
  if (size <= 0) {
    throw new Error("File size must be positive");
  }
  if (size > maxSize) {
    const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File too large: ${
        (size / (1024 * 1024)).toFixed(1)
      }MB (maximum ${maxMB}MB)`,
    );
  }
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
  validateImageDimensions(width, height);
  return Math.floor((width * height * 3 * bitDepth) / 8);
}

/**
 * Calculates the embedding capacity of JPEG coefficients
 * Uses non-zero AC coefficients (index 1-63) for embedding
 * DC coefficients (index 0) are skipped as they're too visually sensitive
 * @param coefficients JPEG quantized coefficients
 * @param useChroma Whether to also use chroma (Cb, Cr) components
 * @returns Number of bytes that can be hidden
 */
export function calculateJpegCoefficientCapacity(
  coefficients: JPEGQuantizedCoefficients,
  useChroma: boolean = true,
): number {
  let bitCount = 0;

  for (const component of coefficients.components) {
    if (!useChroma && component.id !== 1) continue;

    for (const row of component.blocks) {
      for (const block of row) {
        for (let i = 1; i < 64; i++) {
          if (block[i] !== 0 && block[i] !== 1 && block[i] !== -1) {
            bitCount++;
          }
        }
      }
    }
  }

  return Math.floor(bitCount / 8);
}

/**
 * Embeds message bits into JPEG coefficient LSBs
 * Uses non-zero AC coefficients with magnitude > 1 for embedding
 * Modifies coefficients in-place
 * @param coefficients JPEG quantized coefficients (will be modified)
 * @param messageBits Bits to embed
 * @param useChroma Whether to also use chroma (Cb, Cr) components
 * @returns The modified coefficients
 */
export function embedInCoefficients(
  coefficients: JPEGQuantizedCoefficients,
  messageBits: Uint8Array,
  useChroma: boolean = true,
): JPEGQuantizedCoefficients {
  let bitIndex = 0;

  for (const component of coefficients.components) {
    if (bitIndex >= messageBits.length) break;

    if (!useChroma && component.id !== 1) continue;

    for (const row of component.blocks) {
      if (bitIndex >= messageBits.length) break;

      for (const block of row) {
        if (bitIndex >= messageBits.length) break;

        for (let i = 1; i < 64 && bitIndex < messageBits.length; i++) {
          const coeff = block[i];

          if (coeff !== 0 && coeff !== 1 && coeff !== -1) {
            const messageBit = messageBits[bitIndex] & 1;
            const coeffLSB = Math.abs(coeff) & 1;

            if (coeffLSB !== messageBit) {
              if (coeff > 0) {
                block[i] = messageBit ? (coeff | 1) : (coeff & ~1);
                if (block[i] === 0 || block[i] === 1) {
                  block[i] = coeff;
                  continue;
                }
              } else {
                const absCoeff = -coeff;
                const newAbs = messageBit ? (absCoeff | 1) : (absCoeff & ~1);
                if (newAbs === 0 || newAbs === 1) {
                  continue;
                }
                block[i] = -newAbs;
              }
            }
            bitIndex++;
          }
        }
      }
    }
  }

  if (bitIndex < messageBits.length) {
    throw new Error(
      `Message too large. Capacity: ${bitIndex} bits, Required: ${messageBits.length} bits`,
    );
  }

  return coefficients;
}

/**
 * Extracts LSB bits from JPEG coefficient data
 * @param coefficients JPEG quantized coefficients
 * @param bitCount Number of bits to extract
 * @param useChroma Whether to also extract from chroma (Cb, Cr) components
 * @returns Extracted bits
 */
export function extractFromCoefficients(
  coefficients: JPEGQuantizedCoefficients,
  bitCount: number,
  useChroma: boolean = true,
): Uint8Array {
  const bits = new Uint8Array(bitCount);
  let bitIndex = 0;

  for (const component of coefficients.components) {
    if (bitIndex >= bitCount) break;

    if (!useChroma && component.id !== 1) continue;

    for (const row of component.blocks) {
      if (bitIndex >= bitCount) break;

      for (const block of row) {
        if (bitIndex >= bitCount) break;

        for (let i = 1; i < 64 && bitIndex < bitCount; i++) {
          const coeff = block[i];

          if (coeff !== 0 && coeff !== 1 && coeff !== -1) {
            bits[bitIndex] = Math.abs(coeff) & 1;
            bitIndex++;
          }
        }
      }
    }
  }

  return bits;
}

/**
 * Generates LSB statistics for JPEG coefficients
 * Returns counts of LSB=1 vs LSB=0 per component
 */
export function generateJpegCoefficientStats(
  coefficients: JPEGQuantizedCoefficients,
): {
  luminance: { ones: number; zeros: number; total: number };
  chroma: { ones: number; zeros: number; total: number };
  total: { ones: number; zeros: number; usable: number };
} {
  let lumOnes = 0, lumZeros = 0, lumTotal = 0;
  let chromaOnes = 0, chromaZeros = 0, chromaTotal = 0;

  for (const component of coefficients.components) {
    const isLuminance = component.id === 1;

    for (const row of component.blocks) {
      for (const block of row) {
        for (let i = 1; i < 64; i++) {
          const coeff = block[i];

          if (coeff !== 0 && coeff !== 1 && coeff !== -1) {
            const lsb = Math.abs(coeff) & 1;
            if (isLuminance) {
              if (lsb) lumOnes++;
              else lumZeros++;
              lumTotal++;
            } else {
              if (lsb) chromaOnes++;
              else chromaZeros++;
              chromaTotal++;
            }
          }
        }
      }
    }
  }

  return {
    luminance: { ones: lumOnes, zeros: lumZeros, total: lumTotal },
    chroma: { ones: chromaOnes, zeros: chromaZeros, total: chromaTotal },
    total: {
      ones: lumOnes + chromaOnes,
      zeros: lumZeros + chromaZeros,
      usable: lumTotal + chromaTotal,
    },
  };
}

export async function extractJpegCoefficients(
  jpegData: Uint8Array,
): Promise<JPEGQuantizedCoefficients | null> {
  const coeffs = await Image.extractCoefficients(jpegData, "jpeg");
  if (coeffs && coeffs.format === "jpeg") {
    return coeffs as JPEGQuantizedCoefficients;
  }
  return null;
}

export async function encodeJpegFromCoefficients(
  coefficients: JPEGQuantizedCoefficients,
): Promise<Uint8Array> {
  return await Image.encodeFromCoefficients(coefficients, "jpeg");
}

/**
 * Deep clones JPEG coefficients to avoid modifying the original
 */
export function cloneJpegCoefficients(
  coefficients: JPEGQuantizedCoefficients,
): JPEGQuantizedCoefficients {
  return {
    ...coefficients,
    components: coefficients.components.map(
      (comp: JPEGComponentCoefficients) => ({
        ...comp,
        blocks: comp.blocks.map((row: Int32Array[]) =>
          row.map((block: Int32Array) => new Int32Array(block))
        ),
      }),
    ),
    quantizationTables: coefficients.quantizationTables.map((table) =>
      table instanceof Uint8Array ? new Uint8Array(table) : [...table]
    ),
  };
}
