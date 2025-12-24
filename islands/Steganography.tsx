import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Image } from "@cross/image";
import {
  bitsToBytes,
  bytesToBits,
  calculateBitCapacity,
  detectImageFormat,
  embedLSB,
  extractLSB,
  generateLSBStats,
  getRecommendedOutputFormat,
  isLossyFormat,
  parseFileHeader,
  prepareFileHeader,
  xorDecrypt,
  xorEncrypt,
} from "@/utils/steganography.ts";

interface ImageState {
  width: number;
  height: number;
  data: Uint8Array;
  originalFormat?: string | null;
  originalFileName?: string;
  originalImage?: Image; // Store original Image instance to preserve metadata
}

export default function Steganography() {
  // State signals
  const originalImage = useSignal<ImageState | null>(null);
  const encodedImage = useSignal<ImageState | null>(null);
  const lsbStats = useSignal<
    {
      red: { ones: number; zeros: number; changed?: number };
      green: { ones: number; zeros: number; changed?: number };
      blue: { ones: number; zeros: number; changed?: number };
      total: { ones: number; zeros: number; changed?: number };
    } | null
  >(null);
  const message = useSignal("");
  const password = useSignal("");
  const mode = useSignal<"text" | "file">("text");
  const fileInput = useSignal<File | null>(null);
  const error = useSignal<string | null>(null);
  const formatWarning = useSignal<string | null>(null);
  const outputFormat = useSignal<
    | "png"
    | "webp"
    | "gif"
    | "bmp"
    | "tiff"
    | "apng"
    | "ppm"
    | "pam"
    | "ico"
  >("png");
  const bitDepth = useSignal<number>(1); // 1-4 bits per byte
  const _jpegQuality = useSignal<number>(98); // JPEG quality (85-100) - Reserved for future JPEG support
  const operationMode = useSignal<"initial" | "encode" | "decode">("initial");

  // Canvas refs
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const encodedCanvasRef = useRef<HTMLCanvasElement>(null);

  // Computed values
  const bitCapacity = useComputed(() => {
    if (!originalImage.value) return 0;

    // For JPEG, show warning (lossy format)
    // Actual capacity will be calculated during encoding
    if (originalImage.value.originalFormat === "jpeg") {
      const estimatedCapacity = Math.floor(
        (originalImage.value.width * originalImage.value.height * 0.12 *
          bitDepth.value) / 8,
      );
      return estimatedCapacity;
    }

    // For lossless formats, use pixel capacity
    return calculateBitCapacity(
      originalImage.value.width,
      originalImage.value.height,
      bitDepth.value,
    );
  });

  const messageSize = useComputed(() => {
    if (mode.value === "text") {
      return new TextEncoder().encode(message.value).length;
    } else {
      return fileInput.value?.size || 0;
    }
  });

  const capacityPercent = useComputed(() => {
    if (bitCapacity.value === 0) return 0;
    return Math.min(100, (messageSize.value / bitCapacity.value) * 100);
  });

  const isOverCapacity = useComputed(() =>
    messageSize.value > bitCapacity.value
  );

  // Render image data to canvas
  function renderToCanvas(
    canvas: HTMLCanvasElement | null,
    imageData: ImageState | Uint8Array | null,
  ) {
    if (!canvas || !imageData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let data: Uint8Array;
    let width: number;
    let height: number;

    if (imageData instanceof Uint8Array) {
      // Bit-Sieve visualization
      if (!originalImage.value) return;
      width = originalImage.value.width;
      height = originalImage.value.height;
      data = imageData;
    } else {
      width = imageData.width;
      height = imageData.height;
      data = imageData.data;
    }

    canvas.width = width;
    canvas.height = height;

    const imageDataObj = new ImageData(
      new Uint8ClampedArray(data),
      width,
      height,
    );

    ctx.putImageData(imageDataObj, 0, 0);
  }

  // Update canvases when data changes
  useEffect(() => {
    renderToCanvas(originalCanvasRef.current, originalImage.value);
  }, [originalImage.value]);

  useEffect(() => {
    renderToCanvas(encodedCanvasRef.current, encodedImage.value);
  }, [encodedImage.value]);

  // Handle image upload
  async function handleImageUpload(file: File) {
    try {
      error.value = null;
      formatWarning.value = null;
      const arrayBuffer = await file.arrayBuffer();
      const imageData = new Uint8Array(arrayBuffer);

      // Detect original format using @cross/image's format detection
      const detectedFormat = detectImageFormat(imageData);
      const isLossy = isLossyFormat(detectedFormat);

      if (isLossy && detectedFormat !== "jpeg") {
        const recommendation = getRecommendedOutputFormat(detectedFormat);
        formatWarning.value = `⚠️ ${recommendation.reason}`;
      } else if (detectedFormat === "jpeg") {
        formatWarning.value =
          "⚠️ JPEG is a lossy format. LSB steganography will not work reliably. Please use a lossless format like PNG.";
      }

      const image = await Image.decode(imageData);

      // Extract filename without extension
      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");

      const state: ImageState = {
        width: image.width,
        height: image.height,
        data: new Uint8Array(image.data),
        originalFormat: detectedFormat,
        originalFileName: fileNameWithoutExt,
      };

      originalImage.value = state;
      encodedImage.value = null;

      // Set output format to match input format if it's lossless
      if (detectedFormat && !isLossyFormat(detectedFormat)) {
        const losslessFormats = [
          "png",
          "webp",
          "gif",
          "bmp",
          "tiff",
          "apng",
          "ppm",
          "pam",
          "ico",
        ];
        if (losslessFormats.includes(detectedFormat)) {
          outputFormat.value = detectedFormat as typeof outputFormat.value;
        }
      }
    } catch (err) {
      error.value = `Failed to load image: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  // Handle encode
  async function handleEncode() {
    if (!originalImage.value) {
      error.value = "Please upload an image first";
      return;
    }

    try {
      error.value = null;

      let dataToEncode: Uint8Array;

      if (mode.value === "text") {
        if (!message.value.trim()) {
          error.value = "Please enter a message";
          return;
        }
        const textBytes = new TextEncoder().encode(message.value);
        // Add length prefix (4 bytes, little-endian) so we know exactly how many bytes to extract
        const lengthPrefix = new Uint8Array(4);
        const view = new DataView(lengthPrefix.buffer);
        view.setUint32(0, textBytes.length, true); // little-endian
        // Combine length prefix + text
        dataToEncode = new Uint8Array(4 + textBytes.length);
        dataToEncode.set(lengthPrefix);
        dataToEncode.set(textBytes, 4);
      } else {
        if (!fileInput.value) {
          error.value = "Please select a file";
          return;
        }
        const fileData = new Uint8Array(await fileInput.value.arrayBuffer());
        const header = prepareFileHeader(fileInput.value.name, fileData.length);
        // Combine header + file data
        dataToEncode = new Uint8Array(header.length + fileData.length);
        dataToEncode.set(header);
        dataToEncode.set(fileData, header.length);
      }

      // XOR encrypt
      const encrypted = password.value
        ? xorEncrypt(dataToEncode, password.value)
        : dataToEncode;

      // Convert to bits
      const bits = bytesToBits(encrypted);

      // Check if this is a lossy format - show error
      const originalFormat = originalImage.value.originalFormat ?? null;
      if (isLossyFormat(originalFormat)) {
        error.value = `Cannot encode into lossy format (${
          originalFormat?.toUpperCase() || "unknown"
        }). Please use a lossless format like PNG, WebP lossless, or BMP.`;
        return;
      }

      // Use pixel-domain LSB steganography for lossless formats
      // Check capacity
      const requiredBytes = dataToEncode.length;
      if (requiredBytes > bitCapacity.value) {
        error.value =
          `Message too large. Capacity: ${bitCapacity.value} bytes, Required: ${requiredBytes} bytes`;
        return;
      }

      // Embed into image with selected bit depth
      const embeddedData = embedLSB(
        originalImage.value.data,
        bits,
        bitDepth.value,
      );

      // Create new image state
      encodedImage.value = {
        width: originalImage.value.width,
        height: originalImage.value.height,
        data: embeddedData,
        originalFormat: originalImage.value.originalFormat,
        originalFileName: originalImage.value.originalFileName,
      };

      // Generate statistics (replaced bit-sieve visualization with histogram)
      // Compare with original to show how many bits were actually changed
      lsbStats.value = generateLSBStats(
        embeddedData,
        originalImage.value.data,
      );
    } catch (err) {
      error.value = `Encoding failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  // Handle decode
  function handleDecode() {
    // Set operation mode to decode
    if (operationMode.value !== "decode") {
      operationMode.value = "decode";
    }
    // Allow decoding from either encoded image or original (in case user uploads an already-encoded image)
    const imageToDecode = encodedImage.value || originalImage.value;
    if (!imageToDecode) {
      error.value = "Please upload an image to decode";
      return;
    }

    try {
      error.value = null;

      // Check if this is a lossy format - show error
      const decodeFormat = imageToDecode.originalFormat ?? null;
      if (isLossyFormat(decodeFormat)) {
        error.value = `Cannot decode from lossy format (${
          decodeFormat?.toUpperCase() || "unknown"
        }). Lossy compression destroys LSB data. Please use a lossless format.`;
        return;
      }

      // Use pixel-domain LSB extraction for lossless formats
      const maxBits = Math.floor((imageToDecode.data.length / 4) * 3) *
        bitDepth.value;
      const extractedBits = extractLSB(
        imageToDecode.data,
        maxBits,
        bitDepth.value,
      );

      // Convert to bytes
      const encryptedBytes = bitsToBytes(extractedBits);

      // Try to decrypt
      const decryptedBytes = password.value
        ? xorDecrypt(encryptedBytes, password.value)
        : encryptedBytes;

      // Try to parse as file header first (magic byte 0x55)
      const header = parseFileHeader(decryptedBytes);
      if (header) {
        // It's a file! Extract exactly the file size
        if (decryptedBytes.length < header.payloadOffset + header.fileSize) {
          error.value = "File appears to be truncated or corrupted";
          return;
        }
        const payload = decryptedBytes.slice(
          header.payloadOffset,
          header.payloadOffset + header.fileSize,
        );
        const fileBlob = new Blob([
          payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.length,
          ),
        ], { type: "application/octet-stream" });
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = header.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      // Otherwise, parse as text with length prefix
      if (decryptedBytes.length < 4) {
        error.value =
          "Data too short to decode. Make sure the bit depth and password match the encoding settings.";
        return;
      }

      // Read length prefix (first 4 bytes, little-endian)
      const view = new DataView(
        decryptedBytes.buffer,
        decryptedBytes.byteOffset,
      );
      const textLength = view.getUint32(0, true); // little-endian

      // Validate length
      if (textLength > decryptedBytes.length - 4 || textLength > 1000000) {
        error.value =
          "Invalid message length. Make sure the bit depth and password match the encoding settings.";
        return;
      }

      // Extract exactly the specified length
      const textBytes = decryptedBytes.slice(4, 4 + textLength);
      try {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(
          textBytes,
        );
        message.value = text;
        mode.value = "text";
      } catch {
        error.value =
          "Failed to decode text. The data may be corrupted or the password/bit depth may be incorrect.";
      }
    } catch (err) {
      error.value = `Decoding failed: ${
        err instanceof Error ? err.message : String(err)
      }. Make sure the bit depth and password match the encoding settings.`;
    }
  }

  // Handle download
  async function handleDownload() {
    if (!encodedImage.value) {
      error.value = "No encoded image to download";
      return;
    }

    try {
      error.value = null;

      // Encode from pixel data (lossless formats only)
      // Create Image instance from encoded data
      const image = Image.fromRGBA(
        encodedImage.value.width,
        encodedImage.value.height,
        encodedImage.value.data,
      );

      // Use user-selected output format
      const selectedFormat = outputFormat.value;

      // Try to preserve original format if it's lossless and user selected PNG
      const originalFormat = originalImage.value?.originalFormat;
      let finalFormat: string = selectedFormat;

      // If original format is lossless and user selected PNG, use original format
      if (
        originalFormat && !isLossyFormat(originalFormat) &&
        selectedFormat === "png"
      ) {
        const losslessFormats = [
          "png",
          "gif",
          "apng",
          "bmp",
          "tiff",
          "ppm",
          "pam",
          "ico",
        ];
        if (losslessFormats.includes(originalFormat)) {
          finalFormat = originalFormat;
        }
      }

      // Encode with appropriate settings
      let encodedData: Uint8Array;

      if (finalFormat === "png") {
        // PNG: Use balanced compression (level 6, default) to match typical PNG files
        encodedData = await image.encode("png", { compressionLevel: 6 });
      } else if (finalFormat === "webp") {
        // WebP: lossless mode
        try {
          encodedData = await image.encode("webp", {
            lossless: true,
            quality: 100,
          });
        } catch (err) {
          // Fallback to PNG if WebP encoding fails
          console.warn("WebP encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "WebP encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "gif") {
        // GIF: Encode as GIF (lossless)
        try {
          encodedData = await image.encode("gif");
        } catch (err) {
          console.warn("GIF encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "GIF encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "bmp") {
        // BMP: Encode as BMP (lossless, uncompressed)
        try {
          encodedData = await image.encode("bmp");
        } catch (err) {
          console.warn("BMP encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "BMP encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "apng") {
        // APNG: Animated PNG (lossless)
        try {
          encodedData = await image.encode("apng", { compressionLevel: 6 });
        } catch (err) {
          console.warn("APNG encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "APNG encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "tiff") {
        // TIFF: Encode with LZW compression (lossless, matches typical TIFF compression)
        try {
          encodedData = await image.encode("tiff", { compression: "lzw" });
        } catch (err) {
          console.warn("TIFF encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "TIFF encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "ppm") {
        // PPM: Netpbm format (lossless, uncompressed)
        try {
          encodedData = await image.encode("ppm");
        } catch (err) {
          console.warn("PPM encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "PPM encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "pam") {
        // PAM: Netpbm format with better transparency (lossless)
        try {
          encodedData = await image.encode("pam");
        } catch (err) {
          console.warn("PAM encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "PAM encoding failed, saved as PNG instead";
        }
      } else if (finalFormat === "ico") {
        // ICO: Windows icon format (lossless, limited capacity)
        try {
          encodedData = await image.encode("ico");
        } catch (err) {
          console.warn("ICO encoding failed, falling back to PNG:", err);
          encodedData = await image.encode("png", { compressionLevel: 6 });
          finalFormat = "png";
          error.value = "ICO encoding failed, saved as PNG instead";
        }
      } else {
        // Fallback to PNG for unknown formats
        encodedData = await image.encode("png", { compressionLevel: 6 });
        finalFormat = "png";
      }

      // Generate filename: original_name_ub.ext
      const originalFileName = originalImage.value?.originalFileName || "image";
      const extension = finalFormat;
      const downloadFileName = `${originalFileName}_ub.${extension}`;

      // Map format to MIME type
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        apng: "image/apng",
        bmp: "image/bmp",
        tiff: "image/tiff",
        ppm: "image/x-portable-pixmap",
        pam: "image/x-portable-arbitrarymap",
        ico: "image/x-icon",
      };
      const mimeType = mimeTypes[finalFormat] || "image/png";
      const blob = new Blob([new Uint8Array(encodedData)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      error.value = `Download failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  return (
    <div class="font-mono text-sm">
      {error.value && (
        <div class="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-400 rounded">
          {error.value}
        </div>
      )}

      {formatWarning.value && (
        <div class="mb-4 p-3 bg-yellow-950/30 border border-yellow-800/50 text-yellow-400 rounded">
          {formatWarning.value}
        </div>
      )}

      {operationMode.value === "initial" && (
        <div class="space-y-6">
          <div class="border border-slate-800 rounded-lg p-6 bg-black/50">
            <div class="mb-6 flex justify-center">
              <img
                src="/logo.png"
                alt="UnderByte"
                class="h-32 md:h-48 w-auto border-2 border-emerald-800/50 rounded-xl shadow-2xl shadow-emerald-900/50 bg-linear-to-br from-slate-900/80 to-slate-950/80 p-3 md:p-4 backdrop-blur-sm"
              />
            </div>
            <p class="text-slate-300 mb-4 leading-relaxed">
              Hide secret messages and files inside images using LSB (Least
              Significant Bit) steganography. Your data is embedded invisibly in
              the pixel data of lossless image formats.
            </p>
            <div class="space-y-2 text-sm text-slate-400">
              <p>
                • <span class="text-emerald-400">Encode:</span>{" "}
                Hide text or files inside an image
              </p>
              <p>
                • <span class="text-cyan-400">Decode:</span>{" "}
                Extract hidden data from an encoded image
              </p>
              <p>
                • Supports lossless formats: PNG, WebP lossless, GIF, BMP, TIFF,
                APNG, PPM, PAM, ICO
              </p>
              <p>
                • You can upload lossy formats (JPEG, lossy WebP) but they won't
                be written to (encoding requires lossless formats)
              </p>
              <p>• Optional XOR encryption for additional security</p>
            </div>
          </div>

          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
              Step 1: Upload Image
            </h3>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) handleImageUpload(file);
              }}
              class="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-emerald-950/50 file:text-emerald-400 file:cursor-pointer hover:file:bg-emerald-900/50"
            />
          </div>

          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-4">
              Step 2: Choose Operation
            </h3>
            <div class="flex gap-4">
              <button
                type="button"
                onClick={() => operationMode.value = "encode"}
                disabled={!originalImage.value}
                class="flex-1 px-6 py-4 bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded hover:bg-emerald-900/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-900/50"
              >
                <div class="text-lg font-bold mb-1">Encode</div>
                <div class="text-xs text-emerald-300">Hide data in image</div>
              </button>
              <button
                type="button"
                onClick={() => operationMode.value = "decode"}
                disabled={!originalImage.value}
                class="flex-1 px-6 py-4 bg-cyan-900/50 text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-cyan-900/50"
              >
                <div class="text-lg font-bold mb-1">Decode</div>
                <div class="text-xs text-cyan-300">Extract hidden data</div>
              </button>
            </div>
            {!originalImage.value && (
              <p class="mt-3 text-xs text-slate-500 text-center">
                Upload an image first to enable operations
              </p>
            )}
          </div>
        </div>
      )}

      {operationMode.value === "encode" && (
        <div class="space-y-4">
          {originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-3 bg-slate-900/30">
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-xs text-slate-500 uppercase tracking-widest">
                    Current Image:
                  </span>
                  <span class="ml-2 text-sm text-slate-300">
                    {originalImage.value.originalFileName || "image"}
                    {originalImage.value.originalFormat &&
                      `.${originalImage.value.originalFormat}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    operationMode.value = "initial";
                    encodedImage.value = null;
                  }}
                  class="text-xs text-slate-500 hover:text-slate-400"
                >
                  ← Back to start
                </button>
              </div>
            </div>
          )}

          {!originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Image Upload
              </h3>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) handleImageUpload(file);
                }}
                class="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-emerald-950/50 file:text-emerald-400 file:cursor-pointer hover:file:bg-emerald-900/50"
              />
            </div>
          )}

          {originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Data Type
              </h3>
              <div class="flex gap-2">
                <button
                  type="button"
                  onClick={() => mode.value = "text"}
                  class={`px-4 py-2 rounded ${
                    mode.value === "text"
                      ? "bg-emerald-900/50 text-emerald-400 border border-emerald-800"
                      : "bg-slate-900/50 text-slate-400 border border-slate-800"
                  }`}
                >
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => mode.value = "file"}
                  class={`px-4 py-2 rounded ${
                    mode.value === "file"
                      ? "bg-emerald-900/50 text-emerald-400 border border-emerald-800"
                      : "bg-slate-900/50 text-slate-400 border border-slate-800"
                  }`}
                >
                  File
                </button>
              </div>
            </div>
          )}

          {originalImage.value && (
            mode.value === "text"
              ? (
                <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
                  <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                    Secret Message
                  </h3>
                  <textarea
                    value={message.value}
                    onInput={(e) => message.value = e.currentTarget.value}
                    placeholder="Enter your secret message..."
                    class="w-full h-32 p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 placeholder-slate-600 focus:outline-none focus:border-emerald-800"
                  />
                </div>
              )
              : (
                <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
                  <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                    File to Hide
                  </h3>
                  <input
                    type="file"
                    onChange={(e) => {
                      fileInput.value = e.currentTarget.files?.[0] || null;
                    }}
                    class="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-emerald-950/50 file:text-emerald-400 file:cursor-pointer hover:file:bg-emerald-900/50"
                  />
                  {fileInput.value && (
                    <p class="mt-2 text-xs text-slate-500">
                      {fileInput.value.name}{" "}
                      ({(fileInput.value.size / 1024).toFixed(2)} KB)
                    </p>
                  )}
                </div>
              )
          )}

          {originalImage.value && (
            <form
              onSubmit={(e) => e.preventDefault()}
              class="border border-slate-800 rounded-lg p-4 bg-black/50"
            >
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                XOR Key (Optional)
              </h3>
              <input
                type="password"
                value={password.value}
                onInput={(e) => password.value = e.currentTarget.value}
                placeholder="Enter encryption password..."
                autoComplete="off"
                class="w-full p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 placeholder-slate-600 focus:outline-none focus:border-emerald-800"
              />
            </form>
          )}

          {originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Bit Depth: {bitDepth.value} bit{bitDepth.value !== 1 ? "s" : ""}
                {" "}
                per byte
              </h3>
              <div class="space-y-2">
                <input
                  type="range"
                  min="1"
                  max="4"
                  value={bitDepth.value}
                  onInput={(e) =>
                    bitDepth.value = parseInt(e.currentTarget.value)}
                  class="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
                <div class="flex justify-between text-xs text-slate-500">
                  <span>1 bit (Stealth)</span>
                  <span>2 bits</span>
                  <span>3 bits</span>
                  <span>4 bits (Max)</span>
                </div>
                <p class="text-xs text-slate-400 mt-2">
                  {bitDepth.value === 1 && "Nearly invisible, lowest capacity"}
                  {bitDepth.value === 2 && "Slightly visible, 2x capacity"}
                  {bitDepth.value === 3 && "More visible, 3x capacity"}
                  {bitDepth.value === 4 &&
                    "Very visible (deep-fried look), 4x capacity"}
                </p>
              </div>
            </div>
          )}

          {originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Bit Capacity
              </h3>
              <div class="space-y-2">
                <div class="flex justify-between text-xs">
                  <span class="text-slate-400">
                    {messageSize.value} / {bitCapacity.value} bytes
                  </span>
                  <span
                    class={isOverCapacity.value
                      ? "text-red-400"
                      : "text-emerald-400"}
                  >
                    {capacityPercent.value.toFixed(1)}%
                  </span>
                </div>
                <div class="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    class={`h-full transition-all ${
                      isOverCapacity.value
                        ? "bg-red-500"
                        : capacityPercent.value > 80
                        ? "bg-yellow-500"
                        : "bg-emerald-500"
                    }`}
                    style={`width: ${Math.min(100, capacityPercent.value)}%`}
                  />
                </div>
                {isOverCapacity.value && (
                  <p class="text-xs text-red-400 animate-pulse">
                    Storage Full! Reduce message size.
                  </p>
                )}
              </div>
            </div>
          )}

          {originalImage.value && (
            <button
              type="button"
              onClick={handleEncode}
              disabled={!originalImage.value}
              class="w-full px-4 py-3 bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded hover:bg-emerald-900/70 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
            >
              {mode.value === "file" ? "Encode File" : "Encode Message"}
            </button>
          )}

          {encodedImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Output Format
              </h3>
              <select
                value={outputFormat.value}
                onChange={(e) => {
                  outputFormat.value = e.currentTarget.value as
                    | "png"
                    | "webp"
                    | "gif"
                    | "bmp"
                    | "tiff"
                    | "apng"
                    | "ppm"
                    | "pam"
                    | "ico";
                }}
                class="w-full p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 focus:outline-none focus:border-emerald-800"
              >
                <option value="png">
                  {originalImage.value?.originalFormat &&
                      !isLossyFormat(originalImage.value.originalFormat) &&
                      originalImage.value.originalFormat === "png"
                    ? "PNG (Original Format)"
                    : "PNG (Lossless, Best Compatibility)"}
                </option>
                <option value="webp">WebP Lossless (Smaller File Size)</option>
                <option value="gif">GIF (Lossless, Animation Support)</option>
                <option value="apng">APNG (Animated PNG, Lossless)</option>
                <option value="bmp">BMP (Lossless, Uncompressed)</option>
                <option value="tiff">TIFF (Lossless, LZW Compression)</option>
                <option value="ppm">PPM (Netpbm, Simple Format)</option>
                <option value="pam">PAM (Netpbm, Better Transparency)</option>
                <option value="ico">
                  ICO (Windows Icon, Limited Capacity)
                </option>
              </select>
              <p class="mt-2 text-xs text-slate-500">
                {outputFormat.value === "png" &&
                    originalImage.value?.originalFormat &&
                    !isLossyFormat(originalImage.value.originalFormat) &&
                    originalImage.value.originalFormat === "png"
                  ? "Preserving original PNG format"
                  : outputFormat.value === "png"
                  ? "Universal support, larger files"
                  : outputFormat.value === "webp"
                  ? "Better compression, requires modern browser"
                  : outputFormat.value === "gif"
                  ? "Good for simple graphics, supports animation"
                  : outputFormat.value === "apng"
                  ? "Animated PNG, better quality than GIF"
                  : outputFormat.value === "bmp"
                  ? "Uncompressed, largest files but maximum compatibility"
                  : outputFormat.value === "tiff"
                  ? "Professional format, good compression with LZW"
                  : outputFormat.value === "ppm"
                  ? "Simple uncompressed format, good for compatibility"
                  : outputFormat.value === "pam"
                  ? "Netpbm format with better transparency support"
                  : "Windows icon format, small capacity (~24KB max for 256×256)"}
              </p>
              <p class="mt-2 text-xs text-slate-600 italic">
                Note: Only lossless formats preserve pixel-domain LSB data
                perfectly.
              </p>
            </div>
          )}

          {encodedImage.value && (
            <button
              type="button"
              onClick={handleDownload}
              class="w-full px-4 py-3 bg-emerald-600 text-white border border-emerald-500 rounded hover:bg-emerald-500 font-bold shadow-lg shadow-emerald-900/50"
            >
              Download Encoded Image
            </button>
          )}
        </div>
      )}

      {operationMode.value === "decode" && (
        <div class="space-y-4">
          {originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-3 bg-slate-900/30">
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-xs text-slate-500 uppercase tracking-widest">
                    Current Image:
                  </span>
                  <span class="ml-2 text-sm text-slate-300">
                    {originalImage.value.originalFileName || "image"}
                    {originalImage.value.originalFormat &&
                      `.${originalImage.value.originalFormat}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    operationMode.value = "initial";
                    encodedImage.value = null;
                    message.value = "";
                  }}
                  class="text-xs text-slate-500 hover:text-slate-400"
                >
                  ← Back to start
                </button>
              </div>
            </div>
          )}

          {!originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Image Upload
              </h3>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) handleImageUpload(file);
                }}
                class="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-cyan-950/50 file:text-cyan-400 file:cursor-pointer hover:file:bg-cyan-900/50"
              />
            </div>
          )}

          {originalImage.value && (
            <form
              onSubmit={(e) => e.preventDefault()}
              class="border border-slate-800 rounded-lg p-4 bg-black/50"
            >
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                XOR Key (If used during encoding)
              </h3>
              <input
                type="password"
                value={password.value}
                onInput={(e) => password.value = e.currentTarget.value}
                placeholder="Enter password if message was encrypted..."
                autoComplete="off"
                class="w-full p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 placeholder-slate-600 focus:outline-none focus:border-cyan-800"
              />
            </form>
          )}

          {originalImage.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
                Bit Depth: {bitDepth.value} bit{bitDepth.value !== 1 ? "s" : ""}
                {" "}
                per byte
              </h3>
              <div class="space-y-2">
                <input
                  type="range"
                  min="1"
                  max="4"
                  value={bitDepth.value}
                  onInput={(e) =>
                    bitDepth.value = parseInt(e.currentTarget.value)}
                  class="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-cyan-600"
                />
                <div class="flex justify-between text-xs text-slate-500">
                  <span>1 bit</span>
                  <span>2 bits</span>
                  <span>3 bits</span>
                  <span>4 bits</span>
                </div>
                <p class="text-xs text-slate-400 mt-2">
                  Must match the bit depth used during encoding
                </p>
              </div>
            </div>
          )}

          {originalImage.value && (
            <button
              type="button"
              onClick={handleDecode}
              disabled={!originalImage.value && !encodedImage.value}
              class="w-full px-4 py-3 bg-cyan-900/50 text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/70 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
            >
              Decode Message
            </button>
          )}

          {message.value && mode.value === "text" && (
            <div class="border border-cyan-800 rounded-lg p-4 bg-cyan-950/20">
              <h3 class="text-xs uppercase tracking-widest text-cyan-500 mb-2">
                Decoded Message
              </h3>
              <div class="p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 whitespace-pre-wrap wrap-break-word">
                {message.value}
              </div>
            </div>
          )}
        </div>
      )}

      {operationMode.value === "encode" && encodedImage.value && (
        <div class="mt-4 space-y-4">
          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xs uppercase tracking-widest text-slate-500">
                Encoded Image Preview
              </h3>
            </div>
            <div class="relative">
              <canvas
                ref={encodedCanvasRef}
                class="max-w-md mx-auto w-full h-auto rounded shadow-2xl"
              />
            </div>
          </div>

          {lsbStats.value && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-4">
                LSB Statistics & Histogram
              </h3>

              <div class="space-y-4">
                <div class="grid grid-cols-3 gap-4 text-xs">
                  <div class="border border-slate-800 rounded p-3 bg-slate-950/50">
                    <div class="text-red-400 mb-1">Red Channel</div>
                    <div class="text-slate-400 text-xs">
                      LSB=1:{" "}
                      <span class="text-red-300 font-mono">
                        {lsbStats.value.red.ones.toLocaleString()}
                      </span>
                    </div>
                    <div class="text-slate-400 text-xs">
                      LSB=0:{" "}
                      <span class="text-slate-300 font-mono">
                        {lsbStats.value.red.zeros.toLocaleString()}
                      </span>
                    </div>
                    {lsbStats.value.red.changed !== undefined && (
                      <div class="text-cyan-400 text-xs mt-1">
                        Changed:{" "}
                        <span class="text-cyan-300 font-mono">
                          {lsbStats.value.red.changed.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div class="mt-2 space-y-1">
                      <div class="text-xs text-slate-500">
                        Active LSB (LSB=1)
                      </div>
                      <div class="h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          class="h-full bg-red-500"
                          style={`width: ${
                            (lsbStats.value.red.ones /
                              (lsbStats.value.red.ones +
                                lsbStats.value.red.zeros)) * 100
                          }%`}
                        />
                      </div>
                      {lsbStats.value.red.changed !== undefined &&
                        lsbStats.value.red.changed > 0 && (
                        <>
                          <div class="text-xs text-slate-500 mt-1">
                            Changed Bits
                          </div>
                          <div class="h-2 bg-slate-900 rounded-full overflow-hidden relative">
                            <div
                              class="h-full bg-cyan-500"
                              style={`width: ${
                                Math.max(
                                  1,
                                  (lsbStats.value.red.changed /
                                    (lsbStats.value.red.ones +
                                      lsbStats.value.red.zeros)) * 100,
                                )
                              }%`}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div class="border border-slate-800 rounded p-3 bg-slate-950/50">
                    <div class="text-green-400 mb-1">Green Channel</div>
                    <div class="text-slate-400 text-xs">
                      LSB=1:{" "}
                      <span class="text-green-300 font-mono">
                        {lsbStats.value.green.ones.toLocaleString()}
                      </span>
                    </div>
                    <div class="text-slate-400 text-xs">
                      LSB=0:{" "}
                      <span class="text-slate-300 font-mono">
                        {lsbStats.value.green.zeros.toLocaleString()}
                      </span>
                    </div>
                    {lsbStats.value.green.changed !== undefined && (
                      <div class="text-cyan-400 text-xs mt-1">
                        Changed:{" "}
                        <span class="text-cyan-300 font-mono">
                          {lsbStats.value.green.changed.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div class="mt-2 space-y-1">
                      <div class="text-xs text-slate-500">
                        Active LSB (LSB=1)
                      </div>
                      <div class="h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          class="h-full bg-green-500"
                          style={`width: ${
                            (lsbStats.value.green.ones /
                              (lsbStats.value.green.ones +
                                lsbStats.value.green.zeros)) * 100
                          }%`}
                        />
                      </div>
                      {lsbStats.value.green.changed !== undefined &&
                        lsbStats.value.green.changed > 0 && (
                        <>
                          <div class="text-xs text-slate-500 mt-1">
                            Changed Bits
                          </div>
                          <div class="h-2 bg-slate-900 rounded-full overflow-hidden relative">
                            <div
                              class="h-full bg-cyan-500"
                              style={`width: ${
                                Math.max(
                                  1,
                                  (lsbStats.value.green.changed /
                                    (lsbStats.value.green.ones +
                                      lsbStats.value.green.zeros)) * 100,
                                )
                              }%`}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div class="border border-slate-800 rounded p-3 bg-slate-950/50">
                    <div class="text-blue-400 mb-1">Blue Channel</div>
                    <div class="text-slate-400 text-xs">
                      LSB=1:{" "}
                      <span class="text-blue-300 font-mono">
                        {lsbStats.value.blue.ones.toLocaleString()}
                      </span>
                    </div>
                    <div class="text-slate-400 text-xs">
                      LSB=0:{" "}
                      <span class="text-slate-300 font-mono">
                        {lsbStats.value.blue.zeros.toLocaleString()}
                      </span>
                    </div>
                    {lsbStats.value.blue.changed !== undefined && (
                      <div class="text-cyan-400 text-xs mt-1">
                        Changed:{" "}
                        <span class="text-cyan-300 font-mono">
                          {lsbStats.value.blue.changed.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div class="mt-2 space-y-1">
                      <div class="text-xs text-slate-500">
                        Active LSB (LSB=1)
                      </div>
                      <div class="h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          class="h-full bg-blue-500"
                          style={`width: ${
                            (lsbStats.value.blue.ones /
                              (lsbStats.value.blue.ones +
                                lsbStats.value.blue.zeros)) * 100
                          }%`}
                        />
                      </div>
                      {lsbStats.value.blue.changed !== undefined &&
                        lsbStats.value.blue.changed > 0 && (
                        <>
                          <div class="text-xs text-slate-500 mt-1">
                            Changed Bits
                          </div>
                          <div class="h-2 bg-slate-900 rounded-full overflow-hidden relative">
                            <div
                              class="h-full bg-cyan-500"
                              style={`width: ${
                                Math.max(
                                  1,
                                  (lsbStats.value.blue.changed /
                                    (lsbStats.value.blue.ones +
                                      lsbStats.value.blue.zeros)) * 100,
                                )
                              }%`}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div class="border border-emerald-800 rounded p-3 bg-emerald-950/20">
                  <div class="text-emerald-400 mb-1 font-semibold">
                    Total Across All Channels
                  </div>
                  <div class="text-slate-300 text-sm">
                    LSB=1:{" "}
                    <span class="text-emerald-300 font-mono">
                      {lsbStats.value.total.ones.toLocaleString()}
                    </span>{" "}
                    | LSB=0:{" "}
                    <span class="text-slate-300 font-mono">
                      {lsbStats.value.total.zeros.toLocaleString()}
                    </span>
                  </div>
                  {lsbStats.value.total.changed !== undefined && (
                    <div class="text-cyan-400 text-sm mt-1">
                      Bits Changed:{" "}
                      <span class="text-cyan-300 font-mono font-semibold">
                        {lsbStats.value.total.changed.toLocaleString()}
                      </span>{" "}
                      (
                      {((lsbStats.value.total.changed /
                        (lsbStats.value.total.ones +
                          lsbStats.value.total.zeros)) * 100).toFixed(2)}% of
                      all LSBs)
                    </div>
                  )}
                  <div class="mt-2 space-y-2">
                    <div>
                      <div class="text-xs text-slate-400 mb-1">
                        Active LSB (LSB=1)
                      </div>
                      <div class="h-3 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          class="h-full bg-emerald-500"
                          style={`width: ${
                            (lsbStats.value.total.ones /
                              (lsbStats.value.total.ones +
                                lsbStats.value.total.zeros)) * 100
                          }%`}
                        />
                      </div>
                    </div>
                    {lsbStats.value.total.changed !== undefined &&
                      lsbStats.value.total.changed > 0 && (
                      <div>
                        <div class="text-xs text-slate-400 mb-1">
                          Changed Bits
                        </div>
                        <div class="h-3 bg-slate-900 rounded-full overflow-hidden relative">
                          <div
                            class="h-full bg-cyan-500"
                            style={`width: ${
                              Math.max(
                                1,
                                (lsbStats.value.total.changed /
                                  (lsbStats.value.total.ones +
                                    lsbStats.value.total.zeros)) * 100,
                              )
                            }%`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div class="mt-2 text-xs text-slate-500">
                    {((lsbStats.value.total.ones /
                      (lsbStats.value.total.ones +
                        lsbStats.value.total.zeros)) * 100).toFixed(2)}% of bits
                    are set to 1
                    {lsbStats.value.total.changed !== undefined && (
                      <span class="text-slate-400">(after encoding)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
