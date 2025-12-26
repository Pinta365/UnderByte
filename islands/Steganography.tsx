import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  calculateBitCapacity,
  calculateJpegCoefficientCapacity,
  cloneJpegCoefficients,
  createImage,
  decodeImage,
  detectImageFormat,
  embedDataInImage,
  embedDataInJpegCoefficients,
  encodeImage,
  encodeJpegFromCoefficients,
  extractDataFromImage,
  extractDataFromJpegCoefficients,
  extractJpegCoefficients,
  generateJpegCoefficientStats,
  generateLSBStats,
  type Image,
  isLossyFormat,
  MAX_EMBED_FILE_SIZE,
  MAX_IMAGE_SIZE,
  MAX_MESSAGE_LENGTH,
  parseFileHeader,
  prepareFileHeader,
  sanitizeFilename,
  validateFileSize,
  validateImageDimensions,
  xorDecrypt,
  xorEncrypt,
} from "@pinta365/steganography";

type JPEGCoeffs = NonNullable<
  Awaited<ReturnType<typeof extractJpegCoefficients>>
>;

interface ImageState {
  width: number;
  height: number;
  data: Uint8Array;
  originalFormat?: string | null;
  originalFileName?: string;
  originalImage?: Image;
  jpegCoefficients?: JPEGCoeffs;
  rawJpegData?: Uint8Array;
}

interface Props {
  onBack?: () => void;
}

export default function Steganography({ onBack }: Props) {
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
    | "jpeg"
  >("png");
  const bitDepth = useSignal<number>(1);
  const useChroma = useSignal<boolean>(true);
  const jpegCoefficientStats = useSignal<
    {
      luminance: { ones: number; zeros: number; total: number };
      chroma: { ones: number; zeros: number; total: number };
      total: { ones: number; zeros: number; usable: number };
    } | null
  >(null);
  const operationMode = useSignal<"initial" | "encode" | "decode">("initial");
  const isLoading = useSignal<boolean>(false);
  const loadingMessage = useSignal<string | null>(null);

  function resetSession() {
    originalImage.value = null;
    encodedImage.value = null;
    lsbStats.value = null;
    message.value = "";
    password.value = "";
    mode.value = "text";
    fileInput.value = null;
    error.value = null;
    formatWarning.value = null;
    outputFormat.value = "png";
    bitDepth.value = 1;
    useChroma.value = true;
    jpegCoefficientStats.value = null;
    operationMode.value = "initial";
    isLoading.value = false;
    loadingMessage.value = null;
  }

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const encodedCanvasRef = useRef<HTMLCanvasElement>(null);

  const bitCapacity = useComputed(() => {
    if (!originalImage.value) return 0;

    if (
      originalImage.value.originalFormat === "jpeg" &&
      originalImage.value.jpegCoefficients
    ) {
      return calculateJpegCoefficientCapacity(
        originalImage.value.jpegCoefficients,
        useChroma.value,
      );
    }

    if (originalImage.value.originalFormat === "jpeg") {
      const estimatedCapacity = Math.floor(
        (originalImage.value.width * originalImage.value.height * 0.12) / 8,
      );
      return estimatedCapacity;
    }

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

  useEffect(() => {
    renderToCanvas(originalCanvasRef.current, originalImage.value);
  }, [originalImage.value]);

  useEffect(() => {
    renderToCanvas(encodedCanvasRef.current, encodedImage.value);
  }, [encodedImage.value]);

  async function handleImageUpload(file: File) {
    isLoading.value = true;
    loadingMessage.value = "Loading image...";

    try {
      error.value = null;
      formatWarning.value = null;
      jpegCoefficientStats.value = null;

      validateFileSize(file.size, MAX_IMAGE_SIZE);

      const arrayBuffer = await file.arrayBuffer();
      const imageData = new Uint8Array(arrayBuffer);

      const detectedFormat = detectImageFormat(imageData);
      const isLossy = isLossyFormat(detectedFormat);

      let jpegCoefficients: JPEGCoeffs | undefined;

      if (detectedFormat === "jpeg") {
        loadingMessage.value = "Extracting JPEG coefficients...";
        const coeffs = await extractJpegCoefficients(imageData);
        if (coeffs) {
          jpegCoefficients = coeffs;
          jpegCoefficientStats.value = generateJpegCoefficientStats(coeffs);
          outputFormat.value = "jpeg";
        } else {
          formatWarning.value =
            "⚠️ JPEG detected but coefficient extraction failed. Cannot use JPEG steganography.";
        }
      } else if (isLossy) {
        formatWarning.value = `⚠️ ${
          detectedFormat?.toUpperCase() || "Unknown"
        } is a lossy format. Saving as PNG to preserve hidden data.`;
      }

      const image = await decodeImage(imageData);

      validateImageDimensions(image.width, image.height);

      const fileNameWithoutExt = sanitizeFilename(
        file.name.replace(/\.[^/.]+$/, ""),
      );

      const state: ImageState = {
        width: image.width,
        height: image.height,
        data: new Uint8Array(image.data),
        originalFormat: detectedFormat,
        originalFileName: fileNameWithoutExt,
        jpegCoefficients,
        rawJpegData: detectedFormat === "jpeg" ? imageData : undefined,
      };

      originalImage.value = state;
      encodedImage.value = null;

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
    } finally {
      isLoading.value = false;
      loadingMessage.value = null;
    }
  }

  async function handleEncode() {
    if (!originalImage.value) {
      error.value = "Please upload an image first";
      return;
    }

    isLoading.value = true;
    loadingMessage.value = originalImage.value.originalFormat === "jpeg"
      ? "Processing JPEG coefficients..."
      : "Encoding message...";

    try {
      error.value = null;

      let dataToEncode: Uint8Array;

      if (mode.value === "text") {
        if (!message.value.trim()) {
          error.value = "Please enter a message";
          return;
        }
        const textBytes = new TextEncoder().encode(message.value);
        if (textBytes.length > MAX_MESSAGE_LENGTH) {
          error.value =
            `Message too long: ${textBytes.length} bytes (maximum ${MAX_MESSAGE_LENGTH} bytes)`;
          return;
        }
        const lengthPrefix = new Uint8Array(4);
        const view = new DataView(lengthPrefix.buffer);
        view.setUint32(0, textBytes.length, true);
        dataToEncode = new Uint8Array(4 + textBytes.length);
        dataToEncode.set(lengthPrefix);
        dataToEncode.set(textBytes, 4);
      } else {
        if (!fileInput.value) {
          error.value = "Please select a file";
          return;
        }
        validateFileSize(fileInput.value.size, MAX_EMBED_FILE_SIZE);
        const fileData = new Uint8Array(await fileInput.value.arrayBuffer());
        const sanitizedName = sanitizeFilename(fileInput.value.name);
        const header = prepareFileHeader(sanitizedName, fileData.length);
        dataToEncode = new Uint8Array(header.length + fileData.length);
        dataToEncode.set(header);
        dataToEncode.set(fileData, header.length);
      }

      const encrypted = password.value
        ? xorEncrypt(dataToEncode, password.value)
        : dataToEncode;

      const requiredBytes = dataToEncode.length;
      if (requiredBytes > bitCapacity.value) {
        error.value =
          `Message too large. Capacity: ${bitCapacity.value} bytes, Required: ${requiredBytes} bytes`;
        return;
      }

      const originalFormat = originalImage.value.originalFormat ?? null;

      if (originalFormat === "jpeg" && originalImage.value.jpegCoefficients) {
        const coeffs = cloneJpegCoefficients(
          originalImage.value.jpegCoefficients,
        );

        embedDataInJpegCoefficients(coeffs, encrypted, useChroma.value);

        const encodedJpegData = await encodeJpegFromCoefficients(coeffs);

        const encodedImage_ = await decodeImage(encodedJpegData);

        encodedImage.value = {
          width: encodedImage_.width,
          height: encodedImage_.height,
          data: new Uint8Array(encodedImage_.data),
          originalFormat: "jpeg",
          originalFileName: originalImage.value.originalFileName,
          jpegCoefficients: coeffs,
          rawJpegData: encodedJpegData,
        };

        jpegCoefficientStats.value = generateJpegCoefficientStats(coeffs);
        lsbStats.value = null;
      } else if (isLossyFormat(originalFormat)) {
        error.value = `Cannot encode into lossy format (${
          originalFormat?.toUpperCase() || "unknown"
        }). Please use a lossless format like PNG, WebP lossless, or BMP.`;
        return;
      } else {
        const embeddedData = embedDataInImage(
          originalImage.value.data,
          encrypted,
          bitDepth.value,
        );

        encodedImage.value = {
          width: originalImage.value.width,
          height: originalImage.value.height,
          data: embeddedData,
          originalFormat: originalImage.value.originalFormat,
          originalFileName: originalImage.value.originalFileName,
        };

        lsbStats.value = generateLSBStats(
          embeddedData,
          originalImage.value.data,
        );
        jpegCoefficientStats.value = null;
      }
    } catch (err) {
      error.value = `Encoding failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    } finally {
      isLoading.value = false;
      loadingMessage.value = null;
    }
  }

  function handleDecode() {
    if (operationMode.value !== "decode") {
      operationMode.value = "decode";
    }
    const imageToDecode = encodedImage.value || originalImage.value;
    if (!imageToDecode) {
      error.value = "Please upload an image to decode";
      return;
    }

    isLoading.value = true;
    loadingMessage.value = imageToDecode.originalFormat === "jpeg"
      ? "Extracting from JPEG coefficients..."
      : "Decoding message...";

    try {
      error.value = null;

      const decodeFormat = imageToDecode.originalFormat ?? null;
      let encryptedBytes: Uint8Array;

      if (decodeFormat === "jpeg" && imageToDecode.jpegCoefficients) {
        const capacity = calculateJpegCoefficientCapacity(
          imageToDecode.jpegCoefficients,
          useChroma.value,
        );

        encryptedBytes = extractDataFromJpegCoefficients(
          imageToDecode.jpegCoefficients,
          capacity,
          useChroma.value,
        );
      } else if (
        isLossyFormat(decodeFormat) && !imageToDecode.jpegCoefficients
      ) {
        error.value = `Cannot decode from lossy format (${
          decodeFormat?.toUpperCase() || "unknown"
        }). Lossy compression destroys pixel-domain embedding data. Please use a lossless format or a JPEG with coefficient extraction.`;
        return;
      } else {
        const maxDataBytes = Math.floor(
          (imageToDecode.data.length / 4) * 3 * bitDepth.value / 8,
        );

        encryptedBytes = extractDataFromImage(
          imageToDecode.data,
          maxDataBytes,
          bitDepth.value,
        );
      }

      const decryptedBytes = password.value
        ? xorDecrypt(encryptedBytes, password.value)
        : encryptedBytes;

      const header = parseFileHeader(decryptedBytes);
      if (header) {
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

      if (decryptedBytes.length < 4) {
        error.value =
          "Data too short to decode. Make sure the settings match the encoding settings.";
        return;
      }

      const view = new DataView(
        decryptedBytes.buffer,
        decryptedBytes.byteOffset,
      );
      const textLength = view.getUint32(0, true);

      if (
        textLength > decryptedBytes.length - 4 ||
        textLength > MAX_MESSAGE_LENGTH ||
        textLength <= 0
      ) {
        error.value =
          "Invalid message length. Make sure the settings match the encoding settings.";
        return;
      }

      const textBytes = decryptedBytes.slice(4, 4 + textLength);
      try {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(
          textBytes,
        );
        message.value = text;
        mode.value = "text";
      } catch {
        error.value =
          "Failed to decode text. The data may be corrupted or the password may be incorrect.";
      }
    } catch (err) {
      error.value = `Decoding failed: ${
        err instanceof Error ? err.message : String(err)
      }. Make sure the settings match the encoding settings.`;
    } finally {
      isLoading.value = false;
      loadingMessage.value = null;
    }
  }

  async function handleDownload() {
    if (!encodedImage.value) {
      error.value = "No encoded image to download";
      return;
    }

    isLoading.value = true;
    loadingMessage.value = "Preparing download...";

    try {
      error.value = null;

      const selectedFormat = outputFormat.value;
      let finalFormat: string = selectedFormat;
      let encodedData: Uint8Array;

      if (selectedFormat === "jpeg" && encodedImage.value.rawJpegData) {
        encodedData = encodedImage.value.rawJpegData;
        finalFormat = "jpeg";
      } else if (selectedFormat === "jpeg" && !encodedImage.value.rawJpegData) {
        error.value =
          "JPEG output requires coefficient-domain encoding. Please re-encode from a JPEG source.";
        return;
      } else {
        const image = createImage(
          encodedImage.value.width,
          encodedImage.value.height,
          encodedImage.value.data,
        );

        const originalFormat = originalImage.value?.originalFormat;

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

        if (finalFormat === "png") {
          encodedData = await encodeImage(image, "png", {
            compressionLevel: 6,
          });
        } else if (finalFormat === "webp") {
          try {
            encodedData = await encodeImage(image, "webp", {
              lossless: true,
              quality: 100,
            });
          } catch (err) {
            console.warn("WebP encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "WebP encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "gif") {
          try {
            encodedData = await encodeImage(image, "gif");
          } catch (err) {
            console.warn("GIF encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "GIF encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "bmp") {
          try {
            encodedData = await encodeImage(image, "bmp");
          } catch (err) {
            console.warn("BMP encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "BMP encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "apng") {
          try {
            encodedData = await encodeImage(image, "apng", {
              compressionLevel: 6,
            });
          } catch (err) {
            console.warn("APNG encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "APNG encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "tiff") {
          try {
            encodedData = await encodeImage(image, "tiff", {
              compression: "lzw",
            });
          } catch (err) {
            console.warn("TIFF encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "TIFF encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "ppm") {
          try {
            encodedData = await encodeImage(image, "ppm");
          } catch (err) {
            console.warn("PPM encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "PPM encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "pam") {
          try {
            encodedData = await encodeImage(image, "pam");
          } catch (err) {
            console.warn("PAM encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "PAM encoding failed, saved as PNG instead";
          }
        } else if (finalFormat === "ico") {
          try {
            encodedData = await encodeImage(image, "ico");
          } catch (err) {
            console.warn("ICO encoding failed, falling back to PNG:", err);
            encodedData = await encodeImage(image, "png", {
              compressionLevel: 6,
            });
            finalFormat = "png";
            error.value = "ICO encoding failed, saved as PNG instead";
          }
        } else {
          encodedData = await encodeImage(image, "png", {
            compressionLevel: 6,
          });
          finalFormat = "png";
        }
      }

      const originalFileName = originalImage.value?.originalFileName || "image";
      const extension = finalFormat === "jpeg" ? "jpg" : finalFormat;
      const downloadFileName = sanitizeFilename(
        `${originalFileName}_ub.${extension}`,
      );

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
        jpeg: "image/jpeg",
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
    } finally {
      isLoading.value = false;
      loadingMessage.value = null;
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

      {isLoading.value && loadingMessage.value && (
        <div class="mb-4 p-3 bg-blue-950/50 border border-blue-800 text-blue-400 rounded flex items-center gap-3">
          <div class="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
          <span>{loadingMessage.value}</span>
        </div>
      )}

      {operationMode.value === "initial" && (
        <div class="space-y-6">
          <div class="border border-slate-800 rounded-lg p-6 bg-black/50">
            <div class="mb-6 flex justify-center">
              <div class="h-32 md:h-48 w-auto flex items-center justify-center border-2 border-emerald-800/50 rounded-xl shadow-2xl shadow-emerald-900/50 bg-linear-to-br from-slate-900/80 to-slate-950/80 p-3 md:p-6 backdrop-blur-sm">
                <span class="text-4xl md:text-6xl">🖼️</span>
              </div>
            </div>
            <h2 class="text-xl text-emerald-400 font-bold mb-3 text-center">
              Image Steganography
            </h2>
            <p class="text-slate-300 mb-4 leading-relaxed">
              Hide secret messages and files inside images using advanced
              steganography techniques. Your data is embedded invisibly using
              pixel-domain methods for lossless formats or coefficient-domain
              methods for JPEG.
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
                • <span class="text-amber-400">JPEG Support:</span>{" "}
                Uses DCT coefficient-domain steganography (survives JPEG
                compression)
              </p>
              <p>
                • Lossless formats: PNG, WebP lossless, GIF, BMP, TIFF, APNG,
                PPM, PAM, ICO (pixel-domain embedding)
              </p>
              <p>• Optional XOR encryption for additional security</p>
            </div>
          </div>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              class="w-full px-4 py-2 text-slate-500 hover:text-slate-400 text-sm"
            >
              ← Back to mode selection
            </button>
          )}

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
                  onClick={resetSession}
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

          {originalImage.value &&
            originalImage.value.originalFormat !== "jpeg" && (
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

          {originalImage.value &&
            originalImage.value.originalFormat === "jpeg" &&
            originalImage.value.jpegCoefficients && (
            <div class="border border-amber-800/50 rounded-lg p-4 bg-amber-950/20">
              <h3 class="text-xs uppercase tracking-widest text-amber-500 mb-2">
                JPEG Coefficient Settings
              </h3>
              <div class="space-y-3">
                <label class="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useChroma.value}
                    onChange={(e) => useChroma.value = e.currentTarget.checked}
                    class="w-4 h-4 accent-amber-500"
                  />
                  <span class="text-slate-300">
                    Use chroma channels (Cb, Cr)
                  </span>
                </label>
                <p class="text-xs text-slate-400">
                  {useChroma.value
                    ? "Using all channels (Y, Cb, Cr) - higher capacity, slightly more visible"
                    : "Using luminance only (Y) - lower capacity, more stealthy"}
                </p>
                {jpegCoefficientStats.value && (
                  <div class="mt-2 p-2 bg-slate-950/50 rounded text-xs">
                    <div class="text-amber-400 mb-1">Coefficient Stats:</div>
                    <div class="text-slate-400">
                      Luminance (Y):{" "}
                      <span class="text-slate-300 font-mono">
                        {jpegCoefficientStats.value.luminance.total
                          .toLocaleString()}
                      </span>{" "}
                      usable coefficients
                    </div>
                    <div class="text-slate-400">
                      Chroma (Cb/Cr):{" "}
                      <span class="text-slate-300 font-mono">
                        {jpegCoefficientStats.value.chroma.total
                          .toLocaleString()}
                      </span>{" "}
                      usable coefficients
                    </div>
                  </div>
                )}
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
              disabled={!originalImage.value || isLoading.value}
              class="w-full px-4 py-3 bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded hover:bg-emerald-900/70 disabled:opacity-50 disabled:cursor-not-allowed font-bold flex items-center justify-center gap-2"
            >
              {isLoading.value && (
                <div class="animate-spin h-4 w-4 border-2 border-emerald-400 border-t-transparent rounded-full" />
              )}
              {isLoading.value
                ? "Processing..."
                : mode.value === "file"
                ? "Encode File"
                : "Encode Message"}
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
                    | "ico"
                    | "jpeg";
                }}
                class="w-full p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 focus:outline-none focus:border-emerald-800"
              >
                {encodedImage.value.rawJpegData && (
                  <option value="jpeg">
                    JPEG (DCT Coefficient Steganography)
                  </option>
                )}
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
                {outputFormat.value === "jpeg"
                  ? "JPEG with hidden data in DCT coefficients - survives re-sharing"
                  : outputFormat.value === "png" &&
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
                {outputFormat.value === "jpeg"
                  ? "Note: JPEG uses coefficient-domain steganography which survives JPEG re-compression."
                  : "Note: Lossless formats preserve pixel-domain embedding data perfectly."}
              </p>
            </div>
          )}

          {encodedImage.value && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={isLoading.value}
              class="w-full px-4 py-3 bg-emerald-600 text-white border border-emerald-500 rounded hover:bg-emerald-500 font-bold shadow-lg shadow-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading.value && (
                <div class="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              )}
              {isLoading.value ? "Preparing..." : "Download Encoded Image"}
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
                  onClick={resetSession}
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

          {originalImage.value &&
            originalImage.value.originalFormat !== "jpeg" && (
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

          {originalImage.value &&
            originalImage.value.originalFormat === "jpeg" &&
            originalImage.value.jpegCoefficients && (
            <div class="border border-amber-800/50 rounded-lg p-4 bg-amber-950/20">
              <h3 class="text-xs uppercase tracking-widest text-amber-500 mb-2">
                JPEG Coefficient Settings
              </h3>
              <div class="space-y-3">
                <label class="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useChroma.value}
                    onChange={(e) => useChroma.value = e.currentTarget.checked}
                    class="w-4 h-4 accent-amber-500"
                  />
                  <span class="text-slate-300">
                    Use chroma channels (Cb, Cr)
                  </span>
                </label>
                <p class="text-xs text-slate-400">
                  Must match the setting used during encoding
                </p>
              </div>
            </div>
          )}

          {originalImage.value && (
            <button
              type="button"
              onClick={handleDecode}
              disabled={(!originalImage.value && !encodedImage.value) ||
                isLoading.value}
              class="w-full px-4 py-3 bg-cyan-900/50 text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/70 disabled:opacity-50 disabled:cursor-not-allowed font-bold flex items-center justify-center gap-2"
            >
              {isLoading.value && (
                <div class="animate-spin h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full" />
              )}
              {isLoading.value ? "Decoding..." : "Decode Message"}
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

          {/* Unified Embedding Analysis Panel */}
          {(lsbStats.value || jpegCoefficientStats.value) && (
            <div class="border border-slate-800 rounded-lg overflow-hidden bg-linear-to-b from-slate-900/80 to-black/60">
              {/* Header with method badge */}
              <div class="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between bg-slate-900/50">
                <h3 class="text-xs uppercase tracking-widest text-slate-400 font-medium">
                  Embedding Analysis
                </h3>
                <span
                  class={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full font-medium ${
                    encodedImage.value?.originalFormat === "jpeg"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  }`}
                >
                  {encodedImage.value?.originalFormat === "jpeg"
                    ? "DCT Coefficients"
                    : "Pixel Domain LSB"}
                </span>
              </div>

              <div class="p-4 space-y-4">
                {/* Channel histogram visualization */}
                {lsbStats.value &&
                  encodedImage.value?.originalFormat !== "jpeg" && (
                  <div class="grid grid-cols-3 gap-3">
                    {/* Red Channel */}
                    <div class="relative group">
                      <div class="bg-slate-950/70 rounded-lg p-3 border border-slate-800/50 hover:border-red-500/30 transition-colors">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-red-400 text-xs font-medium">
                            R
                          </span>
                          <span class="text-slate-500 text-[10px] font-mono">
                            {(
                              (lsbStats.value.red.ones /
                                (lsbStats.value.red.ones +
                                  lsbStats.value.red.zeros)) * 100
                            ).toFixed(1)}%
                          </span>
                        </div>
                        {/* Vertical histogram bars */}
                        <div class="flex items-end justify-center gap-1 h-16">
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-red-500/80 rounded-t transition-all"
                              style={`height: ${
                                Math.max(
                                  4,
                                  (lsbStats.value.red.ones /
                                    (lsbStats.value.red.ones +
                                      lsbStats.value.red.zeros)) * 64,
                                )
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">1</span>
                          </div>
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-slate-600 rounded-t transition-all"
                              style={`height: ${
                                Math.max(
                                  4,
                                  (lsbStats.value.red.zeros /
                                    (lsbStats.value.red.ones +
                                      lsbStats.value.red.zeros)) * 64,
                                )
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">0</span>
                          </div>
                          {lsbStats.value.red.changed !== undefined &&
                            lsbStats.value.red.changed > 0 && (
                            <div class="flex flex-col items-center gap-1 flex-1">
                              <div
                                class="w-full bg-cyan-500 rounded-t transition-all"
                                style={`height: ${
                                  Math.max(
                                    4,
                                    Math.min(
                                      64,
                                      (lsbStats.value.red.changed /
                                        (lsbStats.value.red.ones +
                                          lsbStats.value.red.zeros)) * 640,
                                    ),
                                  )
                                }px`}
                              />
                              <span class="text-[9px] text-cyan-400">Δ</span>
                            </div>
                          )}
                        </div>
                        {lsbStats.value.red.changed !== undefined && (
                          <div class="mt-2 text-center text-[10px] text-cyan-400/80 font-mono">
                            Δ {lsbStats.value.red.changed.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Green Channel */}
                    <div class="relative group">
                      <div class="bg-slate-950/70 rounded-lg p-3 border border-slate-800/50 hover:border-green-500/30 transition-colors">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-green-400 text-xs font-medium">
                            G
                          </span>
                          <span class="text-slate-500 text-[10px] font-mono">
                            {(
                              (lsbStats.value.green.ones /
                                (lsbStats.value.green.ones +
                                  lsbStats.value.green.zeros)) * 100
                            ).toFixed(1)}%
                          </span>
                        </div>
                        <div class="flex items-end justify-center gap-1 h-16">
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-green-500/80 rounded-t transition-all"
                              style={`height: ${
                                Math.max(
                                  4,
                                  (lsbStats.value.green.ones /
                                    (lsbStats.value.green.ones +
                                      lsbStats.value.green.zeros)) * 64,
                                )
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">1</span>
                          </div>
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-slate-600 rounded-t transition-all"
                              style={`height: ${
                                Math.max(
                                  4,
                                  (lsbStats.value.green.zeros /
                                    (lsbStats.value.green.ones +
                                      lsbStats.value.green.zeros)) * 64,
                                )
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">0</span>
                          </div>
                          {lsbStats.value.green.changed !== undefined &&
                            lsbStats.value.green.changed > 0 && (
                            <div class="flex flex-col items-center gap-1 flex-1">
                              <div
                                class="w-full bg-cyan-500 rounded-t transition-all"
                                style={`height: ${
                                  Math.max(
                                    4,
                                    Math.min(
                                      64,
                                      (lsbStats.value.green.changed /
                                        (lsbStats.value.green.ones +
                                          lsbStats.value.green.zeros)) * 640,
                                    ),
                                  )
                                }px`}
                              />
                              <span class="text-[9px] text-cyan-400">Δ</span>
                            </div>
                          )}
                        </div>
                        {lsbStats.value.green.changed !== undefined && (
                          <div class="mt-2 text-center text-[10px] text-cyan-400/80 font-mono">
                            Δ {lsbStats.value.green.changed.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Blue Channel */}
                    <div class="relative group">
                      <div class="bg-slate-950/70 rounded-lg p-3 border border-slate-800/50 hover:border-blue-500/30 transition-colors">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-blue-400 text-xs font-medium">
                            B
                          </span>
                          <span class="text-slate-500 text-[10px] font-mono">
                            {(
                              (lsbStats.value.blue.ones /
                                (lsbStats.value.blue.ones +
                                  lsbStats.value.blue.zeros)) * 100
                            ).toFixed(1)}%
                          </span>
                        </div>
                        <div class="flex items-end justify-center gap-1 h-16">
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-blue-500/80 rounded-t transition-all"
                              style={`height: ${
                                Math.max(
                                  4,
                                  (lsbStats.value.blue.ones /
                                    (lsbStats.value.blue.ones +
                                      lsbStats.value.blue.zeros)) * 64,
                                )
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">1</span>
                          </div>
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-slate-600 rounded-t transition-all"
                              style={`height: ${
                                Math.max(
                                  4,
                                  (lsbStats.value.blue.zeros /
                                    (lsbStats.value.blue.ones +
                                      lsbStats.value.blue.zeros)) * 64,
                                )
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">0</span>
                          </div>
                          {lsbStats.value.blue.changed !== undefined &&
                            lsbStats.value.blue.changed > 0 && (
                            <div class="flex flex-col items-center gap-1 flex-1">
                              <div
                                class="w-full bg-cyan-500 rounded-t transition-all"
                                style={`height: ${
                                  Math.max(
                                    4,
                                    Math.min(
                                      64,
                                      (lsbStats.value.blue.changed /
                                        (lsbStats.value.blue.ones +
                                          lsbStats.value.blue.zeros)) * 640,
                                    ),
                                  )
                                }px`}
                              />
                              <span class="text-[9px] text-cyan-400">Δ</span>
                            </div>
                          )}
                        </div>
                        {lsbStats.value.blue.changed !== undefined && (
                          <div class="mt-2 text-center text-[10px] text-cyan-400/80 font-mono">
                            Δ {lsbStats.value.blue.changed.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* JPEG coefficient channels */}
                {jpegCoefficientStats.value &&
                  encodedImage.value?.originalFormat === "jpeg" && (
                  <div
                    class={`grid gap-3 ${
                      useChroma.value ? "grid-cols-2" : "grid-cols-1"
                    }`}
                  >
                    {/* Luminance (Y) */}
                    <div class="relative group">
                      <div class="bg-slate-950/70 rounded-lg p-3 border border-slate-800/50 hover:border-amber-500/30 transition-colors">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-amber-400 text-xs font-medium">
                            Y (Luminance)
                          </span>
                          <span class="text-slate-500 text-[10px] font-mono">
                            {jpegCoefficientStats.value.luminance.total > 0
                              ? (
                                (jpegCoefficientStats.value.luminance.ones /
                                  jpegCoefficientStats.value.luminance.total) *
                                100
                              ).toFixed(1)
                              : 0}%
                          </span>
                        </div>
                        <div class="flex items-end justify-center gap-1 h-16">
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-amber-500/80 rounded-t transition-all"
                              style={`height: ${
                                jpegCoefficientStats.value.luminance.total > 0
                                  ? Math.max(
                                    4,
                                    (jpegCoefficientStats.value.luminance.ones /
                                      jpegCoefficientStats.value.luminance
                                        .total) * 64,
                                  )
                                  : 4
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">1</span>
                          </div>
                          <div class="flex flex-col items-center gap-1 flex-1">
                            <div
                              class="w-full bg-slate-600 rounded-t transition-all"
                              style={`height: ${
                                jpegCoefficientStats.value.luminance.total > 0
                                  ? Math.max(
                                    4,
                                    (jpegCoefficientStats.value.luminance
                                      .zeros /
                                      jpegCoefficientStats.value.luminance
                                        .total) * 64,
                                  )
                                  : 4
                              }px`}
                            />
                            <span class="text-[9px] text-slate-500">0</span>
                          </div>
                        </div>
                        <div class="mt-2 text-center text-[10px] text-amber-400/80 font-mono">
                          {jpegCoefficientStats.value.luminance.total
                            .toLocaleString()} coeffs
                        </div>
                      </div>
                    </div>

                    {/* Chroma (Cb/Cr) - only if enabled */}
                    {useChroma.value && (
                      <div class="relative group">
                        <div class="bg-slate-950/70 rounded-lg p-3 border border-slate-800/50 hover:border-purple-500/30 transition-colors">
                          <div class="flex items-center justify-between mb-2">
                            <span class="text-purple-400 text-xs font-medium">
                              Cb/Cr (Chroma)
                            </span>
                            <span class="text-slate-500 text-[10px] font-mono">
                              {jpegCoefficientStats.value.chroma.total > 0
                                ? (
                                  (jpegCoefficientStats.value.chroma.ones /
                                    jpegCoefficientStats.value.chroma.total) *
                                  100
                                ).toFixed(1)
                                : 0}%
                            </span>
                          </div>
                          <div class="flex items-end justify-center gap-1 h-16">
                            <div class="flex flex-col items-center gap-1 flex-1">
                              <div
                                class="w-full bg-purple-500/80 rounded-t transition-all"
                                style={`height: ${
                                  jpegCoefficientStats.value.chroma.total > 0
                                    ? Math.max(
                                      4,
                                      (jpegCoefficientStats.value.chroma.ones /
                                        jpegCoefficientStats.value.chroma
                                          .total) * 64,
                                    )
                                    : 4
                                }px`}
                              />
                              <span class="text-[9px] text-slate-500">1</span>
                            </div>
                            <div class="flex flex-col items-center gap-1 flex-1">
                              <div
                                class="w-full bg-slate-600 rounded-t transition-all"
                                style={`height: ${
                                  jpegCoefficientStats.value.chroma.total > 0
                                    ? Math.max(
                                      4,
                                      (jpegCoefficientStats.value.chroma.zeros /
                                        jpegCoefficientStats.value.chroma
                                          .total) * 64,
                                    )
                                    : 4
                                }px`}
                              />
                              <span class="text-[9px] text-slate-500">0</span>
                            </div>
                          </div>
                          <div class="mt-2 text-center text-[10px] text-purple-400/80 font-mono">
                            {jpegCoefficientStats.value.chroma.total
                              .toLocaleString()} coeffs
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Summary footer */}
                <div class="bg-slate-950/50 rounded-lg p-3 border border-slate-800/30">
                  <div class="flex items-center justify-between text-xs">
                    <div class="text-slate-400">
                      <span class="text-slate-500">Capacity:</span>{" "}
                      <span class="text-emerald-400 font-mono font-medium">
                        {encodedImage.value?.originalFormat === "jpeg" &&
                            jpegCoefficientStats.value
                          ? `${
                            Math.floor(
                              jpegCoefficientStats.value.total.usable / 8,
                            ).toLocaleString()
                          } bytes`
                          : lsbStats.value
                          ? `${
                            Math.floor(
                              (lsbStats.value.total.ones +
                                lsbStats.value.total.zeros) / 8,
                            ).toLocaleString()
                          } bytes`
                          : "—"}
                      </span>
                    </div>
                    {lsbStats.value?.total.changed !== undefined &&
                      encodedImage.value?.originalFormat !== "jpeg" && (
                      <div class="text-slate-400">
                        <span class="text-slate-500">Modified:</span>{" "}
                        <span class="text-cyan-400 font-mono font-medium">
                          {lsbStats.value.total.changed.toLocaleString()} bits
                        </span>
                        <span class="text-slate-500 ml-1">
                          ({(
                            (lsbStats.value.total.changed /
                              (lsbStats.value.total.ones +
                                lsbStats.value.total.zeros)) *
                            100
                          ).toFixed(2)}%)
                        </span>
                      </div>
                    )}
                    {encodedImage.value?.originalFormat === "jpeg" &&
                      jpegCoefficientStats.value && (
                      <div class="text-slate-400">
                        <span class="text-slate-500">Channels:</span>{" "}
                        <span class="text-amber-400 font-medium">
                          {useChroma.value ? "Y + Cb/Cr" : "Y only"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Capacity usage bar */}
                  {bitCapacity.value > 0 && (
                    <div class="mt-3">
                      <div class="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                        <span>Usage</span>
                        <span>
                          {mode.value === "text"
                            ? `${
                              new TextEncoder().encode(message.value).length
                            } / ${bitCapacity.value} bytes`
                            : fileInput.value
                            ? `${fileInput.value.size} / ${bitCapacity.value} bytes`
                            : `0 / ${bitCapacity.value} bytes`}
                        </span>
                      </div>
                      <div class="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          class={`h-full transition-all rounded-full ${
                            (() => {
                              const used = mode.value === "text"
                                ? new TextEncoder().encode(message.value).length
                                : (fileInput.value?.size ?? 0);
                              const pct = (used / bitCapacity.value) * 100;
                              return pct > 90
                                ? "bg-red-500"
                                : pct > 70
                                ? "bg-amber-500"
                                : "bg-emerald-500";
                            })()
                          }`}
                          style={`width: ${
                            Math.min(
                              100,
                              (() => {
                                const used = mode.value === "text"
                                  ? new TextEncoder().encode(message.value)
                                    .length
                                  : (fileInput.value?.size ?? 0);
                                return (used / bitCapacity.value) * 100;
                              })(),
                            )
                          }%`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
