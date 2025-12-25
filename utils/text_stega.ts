/**
 * Linguistic & Text Steganography Module
 *
 * Hides secret data in plain text using Zero-Width Characters (ZWC).
 * Pipeline: Compress → Encrypt (AES-256-CTR) → Base-6 ZWC encoding
 */

const ZWC_MAP = [
  "\u200b",
  "\u200c",
  "\u200d",
  "\ufeff",
  "\u2060",
  "\u2061",
] as const;

const START_SENTINEL = "\u200b\u200c\u200b";
const END_SENTINEL = "\u200c\u200b\u200c";

const ZWC_PATTERN = /[\u200b\u200c\u200d\ufeff\u2060\u2061]+/g;

/**
 * Compresses data using the native Web CompressionStream API (deflate)
 */
async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  const buffer = new Uint8Array(data);
  writer.write(buffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompresses data using the native Web DecompressionStream API (deflate)
 */
async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  const buffer = new Uint8Array(data);
  writer.write(buffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Check if Web Crypto API is available
 */
function checkCryptoAvailable(): void {
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
    throw new Error(
      "Web Crypto API not available. Encryption requires HTTPS or localhost. " +
        "Please access this page via https:// or http://localhost/",
    );
  }
}

/**
 * Derives an AES-256 key from a password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  checkCryptoAvailable();

  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-CTR", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts data using AES-256-CTR
 * Returns: [16-byte salt][16-byte counter][encrypted data]
 */
async function encrypt(
  data: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  checkCryptoAvailable();

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const counter = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);

  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-CTR", counter, length: 64 },
    key,
    new Uint8Array(data),
  );

  const result = new Uint8Array(32 + encrypted.byteLength);
  result.set(salt, 0);
  result.set(counter, 16);
  result.set(new Uint8Array(encrypted), 32);

  return result;
}

/**
 * Decrypts data using AES-256-CTR
 * Expects: [16-byte salt][16-byte counter][encrypted data]
 */
async function decrypt(
  data: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  checkCryptoAvailable();

  if (data.length < 33) {
    throw new Error("Encrypted data too short");
  }

  const salt = data.slice(0, 16);
  const counter = data.slice(16, 32);
  const ciphertext = data.slice(32);

  const key = await deriveKey(password, salt);

  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-CTR", counter, length: 64 },
    key,
    ciphertext,
  );

  return new Uint8Array(decrypted);
}

/**
 * Converts bytes to Base-6 ZWC string
 */
function bytesToZWC(bytes: Uint8Array): string {
  let result = "";

  for (const byte of bytes) {
    const digits = [];
    let value = byte;
    for (let i = 0; i < 4; i++) {
      digits.unshift(value % 6);
      value = Math.floor(value / 6);
    }
    result += digits.map((d) => ZWC_MAP[d]).join("");
  }

  return result;
}

/**
 * Converts Base-6 ZWC string back to bytes
 */
function zwcToBytes(zwcString: string): Uint8Array {
  const reverseMap: Record<string, number> = {};
  ZWC_MAP.forEach((char, index) => {
    reverseMap[char] = index;
  });

  const digits: number[] = [];
  for (const char of zwcString) {
    if (char in reverseMap) {
      digits.push(reverseMap[char]);
    }
  }

  if (digits.length % 4 !== 0) {
    throw new Error("Invalid ZWC data: length not divisible by 4");
  }

  const bytes: number[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    const value = digits[i] * 216 +
      digits[i + 1] * 36 +
      digits[i + 2] * 6 +
      digits[i + 3];
    bytes.push(value);
  }

  return new Uint8Array(bytes);
}

/**
 * Encodes a secret message into a cover text using ZWC steganography
 *
 * @param coverText - The visible text that will contain the hidden message
 * @param secretMessage - The secret text to hide
 * @param password - Optional password for AES-256-CTR encryption
 * @returns The cover text with invisible ZWC payload appended
 */
export async function encodeText(
  coverText: string,
  secretMessage: string,
  password?: string,
): Promise<string> {
  const encoder = new TextEncoder();
  let data: Uint8Array = new Uint8Array(encoder.encode(secretMessage));

  data = new Uint8Array(await compress(data));

  if (password) {
    data = new Uint8Array(await encrypt(data, password));
  }

  const lengthPrefix = new Uint8Array(4);
  const view = new DataView(lengthPrefix.buffer);
  view.setUint32(0, data.length, true);

  const payloadWithLength = new Uint8Array(4 + data.length);
  payloadWithLength.set(lengthPrefix);
  payloadWithLength.set(data, 4);

  const zwcPayload = bytesToZWC(payloadWithLength);

  return coverText + START_SENTINEL + zwcPayload + END_SENTINEL;
}

/**
 * Extracts only valid ZWC characters from a string
 */
function extractZWCChars(str: string): string {
  const zwcSet = new Set(ZWC_MAP);
  let result = "";
  for (const char of str) {
    if (zwcSet.has(char as typeof ZWC_MAP[number])) {
      result += char;
    }
  }
  return result;
}

/**
 * Decodes a hidden message from text containing ZWC steganography
 *
 * @param stegoText - Text potentially containing hidden ZWC data
 * @param password - Password if the message was encrypted
 * @returns Object with visible text and decoded secret (or null if no hidden data)
 */
export async function decodeText(
  stegoText: string,
  password?: string,
): Promise<{ visibleText: string; secretMessage: string | null }> {
  // Find start sentinel
  const startIdx = stegoText.indexOf(START_SENTINEL);

  if (startIdx === -1) {
    // No hidden data found - strip any stray ZWCs and return
    return {
      visibleText: stegoText.replace(ZWC_PATTERN, ""),
      secretMessage: null,
    };
  }

  const visibleText = stegoText.substring(0, startIdx).replace(ZWC_PATTERN, "");

  const afterStart = stegoText.substring(startIdx + START_SENTINEL.length);

  const allZWC = extractZWCChars(afterStart);

  if (allZWC.length < 16) {
    return {
      visibleText,
      secretMessage: null,
    };
  }

  try {
    const lengthZWC = allZWC.substring(0, 16);
    const lengthBytes = zwcToBytes(lengthZWC);
    const view = new DataView(lengthBytes.buffer, lengthBytes.byteOffset);
    const dataLength = view.getUint32(0, true);

    const dataZWCLength = dataLength * 4;
    const totalZWCNeeded = 16 + dataZWCLength;

    if (allZWC.length < totalZWCNeeded) {
      throw new Error("Incomplete data - payload appears truncated");
    }

    const dataZWC = allZWC.substring(16, totalZWCNeeded);
    let data = zwcToBytes(dataZWC);

    if (password) {
      data = await decrypt(data, password);
    }

    data = await decompress(data);

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const secretMessage = decoder.decode(data);

    return { visibleText, secretMessage };
  } catch (error) {
    throw new Error(
      `Decoding failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Checks if text contains hidden ZWC steganography data
 */
export function hasHiddenData(text: string): boolean {
  const startIdx = text.indexOf(START_SENTINEL);
  if (startIdx === -1) return false;

  const afterStart = text.substring(startIdx + START_SENTINEL.length);
  const zwcSet = new Set(ZWC_MAP);
  let zwcCount = 0;
  for (const char of afterStart) {
    if (zwcSet.has(char as typeof ZWC_MAP[number])) {
      zwcCount++;
      if (zwcCount >= 16) return true;
    }
  }
  return false;
}

/**
 * Strips all ZWC characters from text (removes any hidden data)
 */
export function stripZWC(text: string): string {
  return text.replace(ZWC_PATTERN, "");
}

/**
 * Visualizes hidden ZWC characters for debugging
 * Replaces invisible characters with visible colored representations
 */
export interface VisualizedChar {
  char: string;
  isZWC: boolean;
  type?: "ZWSP" | "ZWNJ" | "ZWJ" | "BOM" | "WJ" | "FUN" | "START" | "END";
  value?: number;
}

export function visualizeZWC(text: string): VisualizedChar[] {
  const result: VisualizedChar[] = [];

  const zwcNames: Record<
    string,
    { type: VisualizedChar["type"]; value: number }
  > = {
    "\u200b": { type: "ZWSP", value: 0 },
    "\u200c": { type: "ZWNJ", value: 1 },
    "\u200d": { type: "ZWJ", value: 2 },
    "\ufeff": { type: "BOM", value: 3 },
    "\u2060": { type: "WJ", value: 4 },
    "\u2061": { type: "FUN", value: 5 },
  };

  // Check for sentinels
  let i = 0;
  while (i < text.length) {
    const char = text[i];

    // Check for start sentinel
    if (text.substring(i, i + 3) === START_SENTINEL) {
      result.push({ char: "[START]", isZWC: true, type: "START" });
      i += 3;
      continue;
    }

    // Check for end sentinel
    if (text.substring(i, i + 3) === END_SENTINEL) {
      result.push({ char: "[END]", isZWC: true, type: "END" });
      i += 3;
      continue;
    }

    if (char in zwcNames) {
      const info = zwcNames[char];
      result.push({
        char: `[${info.type}]`,
        isZWC: true,
        type: info.type,
        value: info.value,
      });
    } else {
      result.push({ char, isZWC: false });
    }

    i++;
  }

  return result;
}

/**
 * Returns statistics about hidden data in text
 */
export interface ZWCStats {
  hasHiddenData: boolean;
  visibleLength: number;
  zwcCount: number;
  estimatedPayloadBytes: number;
  breakdown: Record<string, number>;
}

export function analyzeZWC(text: string): ZWCStats {
  const hasHidden = hasHiddenData(text);
  const visible = stripZWC(text);

  const breakdown: Record<string, number> = {
    ZWSP: 0,
    ZWNJ: 0,
    ZWJ: 0,
    BOM: 0,
    WJ: 0,
    FUN: 0,
  };

  let zwcCount = 0;
  for (const char of text) {
    switch (char) {
      case "\u200b":
        breakdown.ZWSP++;
        zwcCount++;
        break;
      case "\u200c":
        breakdown.ZWNJ++;
        zwcCount++;
        break;
      case "\u200d":
        breakdown.ZWJ++;
        zwcCount++;
        break;
      case "\ufeff":
        breakdown.BOM++;
        zwcCount++;
        break;
      case "\u2060":
        breakdown.WJ++;
        zwcCount++;
        break;
      case "\u2061":
        breakdown.FUN++;
        zwcCount++;
        break;
    }
  }

  // Each byte = 4 ZWC chars, minus sentinel overhead (6 chars)
  const payloadZWC = Math.max(0, zwcCount - 6);
  const estimatedPayloadBytes = Math.floor(payloadZWC / 4);

  return {
    hasHiddenData: hasHidden,
    visibleLength: visible.length,
    zwcCount,
    estimatedPayloadBytes,
    breakdown,
  };
}

// Maximum recommended message sizes
export const MAX_SECRET_LENGTH = 50000; // 50KB uncompressed secret
export const MAX_COVER_LENGTH = 100000; // 100KB cover text
