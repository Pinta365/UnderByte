import { useSignal } from "@preact/signals";
import {
  analyzeZWC,
  decodeText,
  encodeText,
  MAX_COVER_LENGTH,
  MAX_SECRET_LENGTH,
  type VisualizedChar,
  visualizeZWC,
  type ZWCStats,
} from "@/utils/text_stega.ts";

interface Props {
  onBack: () => void;
}

export default function TextSteganography({ onBack }: Props) {
  const operationMode = useSignal<"initial" | "encode" | "decode">("initial");
  const coverText = useSignal("");
  const secretMessage = useSignal("");
  const password = useSignal("");
  const resultText = useSignal("");
  const decodedSecret = useSignal<string | null>(null);
  const error = useSignal<string | null>(null);
  const isLoading = useSignal(false);
  const loadingMessage = useSignal<string | null>(null);
  const showDebugView = useSignal(false);
  const visualizedChars = useSignal<VisualizedChar[]>([]);
  const zwcStats = useSignal<ZWCStats | null>(null);
  const copySuccess = useSignal(false);

  function resetSession() {
    operationMode.value = "initial";
    coverText.value = "";
    secretMessage.value = "";
    password.value = "";
    resultText.value = "";
    decodedSecret.value = null;
    error.value = null;
    showDebugView.value = false;
    visualizedChars.value = [];
    zwcStats.value = null;
    copySuccess.value = false;
  }

  async function handleEncode() {
    if (!coverText.value.trim()) {
      error.value = "Please enter cover text";
      return;
    }

    if (!secretMessage.value.trim()) {
      error.value = "Please enter a secret message to hide";
      return;
    }

    if (coverText.value.length > MAX_COVER_LENGTH) {
      error.value = `Cover text too long (max ${MAX_COVER_LENGTH} characters)`;
      return;
    }

    if (secretMessage.value.length > MAX_SECRET_LENGTH) {
      error.value =
        `Secret message too long (max ${MAX_SECRET_LENGTH} characters)`;
      return;
    }

    isLoading.value = true;
    loadingMessage.value = "Compressing and encoding...";
    error.value = null;

    try {
      const encoded = await encodeText(
        coverText.value,
        secretMessage.value,
        password.value || undefined,
      );

      resultText.value = encoded;
      zwcStats.value = analyzeZWC(encoded);

      if (showDebugView.value) {
        visualizedChars.value = visualizeZWC(encoded);
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

  async function handleDecode() {
    if (!coverText.value.trim()) {
      error.value = "Please paste text to decode";
      return;
    }

    isLoading.value = true;
    loadingMessage.value = "Decoding...";
    error.value = null;

    try {
      const result = await decodeText(
        coverText.value,
        password.value || undefined,
      );

      if (result.secretMessage === null) {
        error.value = "No hidden data found in this text";
        decodedSecret.value = null;
      } else {
        decodedSecret.value = result.secretMessage;
        zwcStats.value = analyzeZWC(coverText.value);
      }
    } catch (err) {
      error.value = `Decoding failed: ${
        err instanceof Error ? err.message : String(err)
      }. Check if the password is correct.`;
      decodedSecret.value = null;
    } finally {
      isLoading.value = false;
      loadingMessage.value = null;
    }
  }

  async function handleCopy() {
    if (resultText.value) {
      try {
        await navigator.clipboard.writeText(resultText.value);
        copySuccess.value = true;
        setTimeout(() => {
          copySuccess.value = false;
        }, 2000);
      } catch {
        const textArea = document.createElement("textarea");
        textArea.value = resultText.value;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand("copy");
          copySuccess.value = true;
          setTimeout(() => {
            copySuccess.value = false;
          }, 2000);
        } catch {
          error.value = "Failed to copy to clipboard";
        }
        document.body.removeChild(textArea);
      }
    }
  }

  function handleDownloadTxt() {
    if (resultText.value) {
      const blob = new Blob([resultText.value], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "underbyte_message.txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      coverText.value = text;
      if (operationMode.value === "decode") {
        zwcStats.value = analyzeZWC(text);
      }
    } catch {
      error.value =
        "Unable to read clipboard. Please paste manually using Ctrl+V (Cmd+V on Mac).";
    }
  }

  function toggleDebugView() {
    showDebugView.value = !showDebugView.value;
    if (showDebugView.value && resultText.value) {
      visualizedChars.value = visualizeZWC(resultText.value);
    }
  }

  function handleInputChange(text: string) {
    coverText.value = text;
    if (operationMode.value === "decode") {
      zwcStats.value = analyzeZWC(text);
    }
  }

  return (
    <div class="font-mono text-sm">
      {error.value && (
        <div class="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-400 rounded">
          {error.value}
        </div>
      )}

      {isLoading.value && loadingMessage.value && (
        <div class="mb-4 p-3 bg-blue-950/50 border border-blue-800 text-blue-400 rounded flex items-center gap-3">
          <div class="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
          <span>{loadingMessage.value}</span>
        </div>
      )}

      {/* Initial Mode Selection */}
      {operationMode.value === "initial" && (
        <div class="space-y-6">
          <div class="border border-slate-800 rounded-lg p-6 bg-black/50">
            <div class="mb-6 flex justify-center">
              <div class="h-32 md:h-48 w-auto flex items-center justify-center border-2 border-violet-800/50 rounded-xl shadow-2xl shadow-violet-900/50 bg-linear-to-br from-slate-900/80 to-slate-950/80 p-3 md:p-6 backdrop-blur-sm">
                <span class="text-4xl md:text-6xl">📝</span>
              </div>
            </div>
            <h2 class="text-xl text-violet-400 font-bold mb-3 text-center">
              Text Steganography
            </h2>
            <p class="text-slate-300 mb-4 leading-relaxed">
              Hide secret messages inside normal-looking text using invisible
              Zero-Width Characters. Your hidden data is compressed with DEFLATE
              and optionally encrypted with AES-256-CTR.
            </p>
            <div class="space-y-2 text-sm text-slate-400">
              <p>
                • <span class="text-violet-400">Invisible:</span>{" "}
                Uses zero-width Unicode characters that are invisible in most
                text editors
              </p>
              <p>
                • <span class="text-cyan-400">Compressed:</span>{" "}
                DEFLATE compression minimizes the invisible payload
              </p>
              <p>
                • <span class="text-amber-400">Encrypted:</span>{" "}
                Optional AES-256-CTR encryption for maximum security
              </p>
              <p>
                • <span class="text-emerald-400">Copy-Paste:</span>{" "}
                Works anywhere text is accepted - emails, messages, documents
              </p>
            </div>

            {/* Platform Limitations Warning */}
            <div class="mt-4 p-3 bg-amber-950/30 border border-amber-800/50 rounded">
              <div class="flex items-start gap-2">
                <span class="text-amber-400 text-lg">⚠️</span>
                <div class="flex-1 text-xs text-amber-300/90">
                  <p class="font-bold text-amber-400 mb-1">
                    Platform Compatibility Notice:
                  </p>
                  <p class="text-amber-300/80 leading-relaxed">
                    Many social platforms (Discord, Slack, Twitter/X) strip
                    invisible Unicode characters for security. If sharing fails,
                    <strong class="text-amber-200">
                      download as .txt file
                    </strong>{" "}
                    or use code blocks instead of direct paste. Email and plain
                    text files preserve the hidden data perfectly.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            class="w-full px-4 py-2 text-slate-500 hover:text-slate-400 text-sm"
          >
            ← Back to mode selection
          </button>

          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-4">
              Choose Operation
            </h3>
            <div class="flex gap-4">
              <button
                type="button"
                onClick={() => (operationMode.value = "encode")}
                class="flex-1 px-6 py-4 bg-violet-900/50 text-violet-400 border border-violet-800 rounded hover:bg-violet-900/70 transition-colors"
              >
                <div class="text-lg font-bold mb-1">Encode</div>
                <div class="text-xs text-violet-300">Hide text in text</div>
              </button>
              <button
                type="button"
                onClick={() => (operationMode.value = "decode")}
                class="flex-1 px-6 py-4 bg-cyan-900/50 text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/70 transition-colors"
              >
                <div class="text-lg font-bold mb-1">Decode</div>
                <div class="text-xs text-cyan-300">Extract hidden text</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encode Mode */}
      {operationMode.value === "encode" && (
        <div class="space-y-4">
          <div class="border border-slate-800 rounded-lg p-3 bg-slate-900/30">
            <div class="flex items-center justify-between">
              <span class="text-xs text-slate-500 uppercase tracking-widest">
                Mode: <span class="text-violet-400">Encode</span>
              </span>
              <button
                type="button"
                onClick={resetSession}
                class="text-xs text-slate-500 hover:text-slate-400"
              >
                ← Back to start
              </button>
            </div>
          </div>

          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
              Cover Text (Visible Message)
            </h3>
            <textarea
              value={coverText.value}
              onInput={(e) => (coverText.value = e.currentTarget.value)}
              placeholder="Enter the visible message that will carry the hidden data..."
              class="w-full h-32 p-3 bg-slate-950 border border-slate-800 rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-800"
            />
            <p class="text-xs text-slate-500 mt-2">
              {coverText.value.length} / {MAX_COVER_LENGTH} characters
            </p>
          </div>

          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
              Secret Message (Hidden)
            </h3>
            <textarea
              value={secretMessage.value}
              onInput={(e) => (secretMessage.value = e.currentTarget.value)}
              placeholder="Enter the secret message to hide..."
              class="w-full h-32 p-3 bg-slate-950 border border-slate-800 rounded text-violet-400 placeholder-slate-600 focus:outline-none focus:border-violet-800"
            />
            <p class="text-xs text-slate-500 mt-2">
              {secretMessage.value.length} / {MAX_SECRET_LENGTH} characters
            </p>
          </div>

          <form
            onSubmit={(e) => e.preventDefault()}
            class="border border-slate-800 rounded-lg p-4 bg-black/50"
          >
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
              AES-256 Password (Optional)
            </h3>
            <input
              type="password"
              value={password.value}
              onInput={(e) => (password.value = e.currentTarget.value)}
              placeholder="Enter encryption password..."
              autoComplete="off"
              class="w-full p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 placeholder-slate-600 focus:outline-none focus:border-violet-800"
            />
            <p class="text-xs text-slate-500 mt-2">
              {password.value
                ? "Using AES-256-CTR encryption"
                : "No encryption (compression only)"}
            </p>
          </form>

          <button
            type="button"
            onClick={handleEncode}
            disabled={isLoading.value}
            class="w-full px-4 py-3 bg-violet-900/50 text-violet-400 border border-violet-800 rounded hover:bg-violet-900/70 disabled:opacity-50 disabled:cursor-not-allowed font-bold flex items-center justify-center gap-2"
          >
            {isLoading.value && (
              <div class="animate-spin h-4 w-4 border-2 border-violet-400 border-t-transparent rounded-full" />
            )}
            {isLoading.value ? "Encoding..." : "Encode Message"}
          </button>

          {resultText.value && (
            <>
              <div class="border border-violet-800 rounded-lg p-4 bg-violet-950/20">
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-xs uppercase tracking-widest text-violet-500">
                    Encoded Result
                  </h3>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={toggleDebugView}
                      class={`text-xs px-2 py-1 rounded ${
                        showDebugView.value
                          ? "bg-amber-900/50 text-amber-400 border border-amber-800"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {showDebugView.value ? "Hide Debug" : "Debug View"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      class={`text-xs px-3 py-1.5 rounded border transition-colors font-bold ${
                        copySuccess.value
                          ? "bg-emerald-900/50 text-emerald-400 border-emerald-800"
                          : "bg-violet-600 text-white border-violet-500 hover:bg-violet-500 shadow-lg shadow-violet-900/50"
                      }`}
                    >
                      {copySuccess.value ? "✓ Copied!" : "📋 Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTxt}
                      class="text-xs px-3 py-1.5 rounded border transition-colors font-bold bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500 shadow-lg shadow-emerald-900/50"
                    >
                      📥 Download .txt
                    </button>
                  </div>
                </div>

                {/* Warning about copying and platforms */}
                <div class="mb-2 p-2.5 bg-amber-950/30 border border-amber-800/50 rounded text-xs text-amber-400/90 space-y-2">
                  <div class="flex items-start gap-2">
                    <span class="text-amber-500 mt-0.5">⚠</span>
                    <span>
                      <strong>Use the buttons above!</strong>{" "}
                      Manual text selection may not include invisible
                      characters.
                    </span>
                  </div>
                  <div class="flex items-start gap-2 text-slate-400">
                    <span class="text-slate-500 mt-0.5">ℹ</span>
                    <span>
                      <strong class="text-slate-300">Platform note:</strong>
                      {" "}
                      Discord, Slack, Twitter and most social platforms strip
                      invisible characters.{" "}
                      <strong class="text-amber-400">
                        For sharing, download as .txt file
                      </strong>{" "}
                      and send that instead. Or use code block that preserves
                      the invisible characters.
                    </span>
                  </div>
                </div>

                {!showDebugView.value
                  ? (
                    <div class="relative">
                      <textarea
                        readOnly
                        value={resultText.value}
                        class="w-full h-32 p-3 bg-slate-950 border border-slate-800 rounded text-slate-300 resize-none focus:outline-none cursor-text"
                        onClick={(e) => e.currentTarget.select()}
                      />
                      {/* Hidden data indicator badge */}
                      <div class="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 bg-violet-900/70 rounded text-[10px] text-violet-300 border border-violet-700/50">
                        <span class="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
                        Hidden data embedded
                      </div>
                    </div>
                  )
                  : (
                    <div class="p-3 bg-slate-950 border border-slate-800 rounded max-h-64 overflow-y-auto">
                      <div class="flex flex-wrap gap-0.5">
                        {visualizedChars.value.map((item, i) => (
                          <span
                            key={i}
                            class={`font-mono text-xs px-0.5 rounded ${
                              item.isZWC
                                ? item.type === "START"
                                  ? "bg-emerald-900/50 text-emerald-400"
                                  : item.type === "END"
                                  ? "bg-red-900/50 text-red-400"
                                  : item.type === "ZWSP"
                                  ? "bg-blue-900/50 text-blue-400"
                                  : item.type === "ZWNJ"
                                  ? "bg-purple-900/50 text-purple-400"
                                  : item.type === "ZWJ"
                                  ? "bg-pink-900/50 text-pink-400"
                                  : item.type === "BOM"
                                  ? "bg-amber-900/50 text-amber-400"
                                  : item.type === "WJ"
                                  ? "bg-cyan-900/50 text-cyan-400"
                                  : "bg-orange-900/50 text-orange-400"
                                : "text-slate-400"
                            }`}
                          >
                            {item.char === " "
                              ? "␣"
                              : item.char === "\n"
                              ? "↵\n"
                              : item.char}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>

              {zwcStats.value && (
                <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
                  <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-3">
                    Encoding Statistics
                  </h3>
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div class="bg-slate-900/50 rounded p-2">
                      <div class="text-slate-500">Visible</div>
                      <div class="text-emerald-400 font-mono font-bold">
                        {zwcStats.value.visibleLength}
                      </div>
                    </div>
                    <div class="bg-slate-900/50 rounded p-2">
                      <div class="text-slate-500">Hidden ZWCs</div>
                      <div class="text-violet-400 font-mono font-bold">
                        {zwcStats.value.zwcCount}
                      </div>
                    </div>
                    <div class="bg-slate-900/50 rounded p-2">
                      <div class="text-slate-500">Payload</div>
                      <div class="text-cyan-400 font-mono font-bold">
                        ~{zwcStats.value.estimatedPayloadBytes} bytes
                      </div>
                    </div>
                    <div class="bg-slate-900/50 rounded p-2">
                      <div class="text-slate-500">Ratio</div>
                      <div class="text-amber-400 font-mono font-bold">
                        {zwcStats.value.visibleLength > 0
                          ? (
                            (zwcStats.value.zwcCount /
                              zwcStats.value.visibleLength) *
                            100
                          ).toFixed(1)
                          : 0}%
                      </div>
                    </div>
                  </div>

                  {showDebugView.value && (
                    <div class="mt-3 pt-3 border-t border-slate-800/50">
                      <div class="text-xs text-slate-500 mb-2">
                        ZWC Breakdown:
                      </div>
                      <div class="flex flex-wrap gap-2 text-xs">
                        {Object.entries(zwcStats.value.breakdown).map(
                          ([name, count]) => (
                            <span
                              key={name}
                              class="px-2 py-1 bg-slate-800 rounded"
                            >
                              <span class="text-slate-500">{name}:</span>{" "}
                              <span class="text-slate-300 font-mono">
                                {count}
                              </span>
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Decode Mode */}
      {operationMode.value === "decode" && (
        <div class="space-y-4">
          <div class="border border-slate-800 rounded-lg p-3 bg-slate-900/30">
            <div class="flex items-center justify-between">
              <span class="text-xs text-slate-500 uppercase tracking-widest">
                Mode: <span class="text-cyan-400">Decode</span>
              </span>
              <button
                type="button"
                onClick={resetSession}
                class="text-xs text-slate-500 hover:text-slate-400"
              >
                ← Back to start
              </button>
            </div>
          </div>

          <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xs uppercase tracking-widest text-slate-500">
                Paste Text to Decode
              </h3>
              <button
                type="button"
                onClick={handlePaste}
                class="text-xs px-2 py-1 bg-cyan-900/50 text-cyan-400 rounded border border-cyan-800 hover:bg-cyan-900/70"
              >
                Paste from Clipboard
              </button>
            </div>
            <textarea
              value={coverText.value}
              onInput={(e) => handleInputChange(e.currentTarget.value)}
              placeholder="Paste text that may contain hidden data..."
              class="w-full h-32 p-3 bg-slate-950 border border-slate-800 rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-800"
            />

            {zwcStats.value && (
              <div class="mt-2 flex items-center gap-2 text-xs">
                {zwcStats.value.hasHiddenData
                  ? (
                    <span class="text-emerald-400">
                      ✓ Hidden data detected ({zwcStats.value.zwcCount} ZWCs)
                    </span>
                  )
                  : zwcStats.value.zwcCount > 0
                  ? (
                    <span class="text-amber-400">
                      ⚠ {zwcStats.value.zwcCount}{" "}
                      ZWCs found but no valid UnderByte signature
                    </span>
                  )
                  : (
                    <span class="text-slate-500">
                      No hidden data detected
                    </span>
                  )}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => e.preventDefault()}
            class="border border-slate-800 rounded-lg p-4 bg-black/50"
          >
            <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-2">
              Password (If encrypted)
            </h3>
            <input
              type="password"
              value={password.value}
              onInput={(e) => (password.value = e.currentTarget.value)}
              placeholder="Enter password if message was encrypted..."
              autoComplete="off"
              class="w-full p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 placeholder-slate-600 focus:outline-none focus:border-cyan-800"
            />
          </form>

          <button
            type="button"
            onClick={handleDecode}
            disabled={isLoading.value}
            class="w-full px-4 py-3 bg-cyan-900/50 text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/70 disabled:opacity-50 disabled:cursor-not-allowed font-bold flex items-center justify-center gap-2"
          >
            {isLoading.value && (
              <div class="animate-spin h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full" />
            )}
            {isLoading.value ? "Decoding..." : "Decode Message"}
          </button>

          {decodedSecret.value !== null && (
            <div class="border border-cyan-800 rounded-lg p-4 bg-cyan-950/20">
              <h3 class="text-xs uppercase tracking-widest text-cyan-500 mb-2">
                Decoded Secret Message
              </h3>
              <div class="p-3 bg-slate-950 border border-slate-800 rounded text-cyan-400 whitespace-pre-wrap wrap-break-word max-h-64 overflow-y-auto">
                {decodedSecret.value}
              </div>
              <p class="text-xs text-slate-500 mt-2">
                {decodedSecret.value.length} characters
              </p>
            </div>
          )}

          {zwcStats.value && decodedSecret.value !== null && (
            <div class="border border-slate-800 rounded-lg p-4 bg-black/50">
              <h3 class="text-xs uppercase tracking-widest text-slate-500 mb-3">
                Decoding Statistics
              </h3>
              <div class="grid grid-cols-3 gap-3 text-xs">
                <div class="bg-slate-900/50 rounded p-2">
                  <div class="text-slate-500">Visible Text</div>
                  <div class="text-emerald-400 font-mono font-bold">
                    {zwcStats.value.visibleLength} chars
                  </div>
                </div>
                <div class="bg-slate-900/50 rounded p-2">
                  <div class="text-slate-500">Hidden ZWCs</div>
                  <div class="text-violet-400 font-mono font-bold">
                    {zwcStats.value.zwcCount}
                  </div>
                </div>
                <div class="bg-slate-900/50 rounded p-2">
                  <div class="text-slate-500">Secret Size</div>
                  <div class="text-cyan-400 font-mono font-bold">
                    {decodedSecret.value.length} chars
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
