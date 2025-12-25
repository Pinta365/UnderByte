import { useSignal } from "@preact/signals";
import Steganography from "./Steganography.tsx";
import TextSteganography from "./TextSteganography.tsx";

type Mode = "landing" | "image" | "text";

export default function ModePicker() {
  const currentMode = useSignal<Mode>("landing");

  const handleBack = () => {
    currentMode.value = "landing";
  };

  if (currentMode.value === "image") {
    return <Steganography onBack={handleBack} />;
  }

  if (currentMode.value === "text") {
    return <TextSteganography onBack={handleBack} />;
  }

  return (
    <div class="font-mono text-sm">
      <div class="border border-slate-800 rounded-lg p-6 md:p-8 bg-black/50 mb-6">
        <div class="flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="UnderByte"
            class="h-24 md:h-36 w-auto mb-6 border-2 border-emerald-800/50 rounded-xl shadow-2xl shadow-emerald-900/50 bg-linear-to-br from-slate-900/80 to-slate-950/80 p-3 backdrop-blur-sm"
          />
          <h1 class="text-2xl md:text-3xl font-bold text-emerald-400 mb-2">
            UnderByte
          </h1>
          <p class="text-slate-400 max-w-lg leading-relaxed">
            Advanced steganography toolkit. Hide secrets in plain sight using
            invisible techniques that survive compression and re-sharing.
          </p>
        </div>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => (currentMode.value = "image")}
          class="group border border-slate-800 rounded-lg p-6 bg-black/50 hover:border-emerald-800/70 hover:bg-emerald-950/10 transition-all duration-300 text-left cursor-pointer"
        >
          <div class="flex items-start gap-4">
            <div class="w-16 h-16 flex items-center justify-center border-2 border-emerald-800/50 rounded-xl bg-emerald-950/30 group-hover:border-emerald-700/70 group-hover:bg-emerald-950/50 transition-colors">
              <span class="text-3xl">🖼️</span>
            </div>
            <div class="flex-1">
              <h2 class="text-lg font-bold text-emerald-400 mb-1 group-hover:text-emerald-300 transition-colors">
                Image Steganography
              </h2>
              <p class="text-sm text-slate-400 leading-relaxed mb-3">
                Hide messages and files inside images using pixel-domain LSB or
                JPEG coefficient-domain embedding.
              </p>
              <div class="flex flex-wrap gap-2">
                <span class="text-xs px-2 py-0.5 bg-emerald-950/50 text-emerald-400/80 rounded-full border border-emerald-800/30">
                  PNG
                </span>
                <span class="text-xs px-2 py-0.5 bg-amber-950/50 text-amber-400/80 rounded-full border border-amber-800/30">
                  JPEG
                </span>
                <span class="text-xs px-2 py-0.5 bg-slate-800/50 text-slate-400/80 rounded-full border border-slate-700/30">
                  WebP
                </span>
                <span class="text-xs px-2 py-0.5 bg-slate-800/50 text-slate-400/80 rounded-full border border-slate-700/30">
                  +6 more
                </span>
              </div>
            </div>
          </div>
          <div class="mt-4 pt-4 border-t border-slate-800/50 flex items-center justify-between">
            <div class="flex gap-4 text-xs text-slate-500">
              <span>
                <span class="text-emerald-500">✓</span> Lossless formats
              </span>
              <span>
                <span class="text-amber-500">✓</span> JPEG compression
              </span>
            </div>
            <span class="text-emerald-500 text-sm group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => (currentMode.value = "text")}
          class="group border border-slate-800 rounded-lg p-6 bg-black/50 hover:border-violet-800/70 hover:bg-violet-950/10 transition-all duration-300 text-left cursor-pointer"
        >
          <div class="flex items-start gap-4">
            <div class="w-16 h-16 flex items-center justify-center border-2 border-violet-800/50 rounded-xl bg-violet-950/30 group-hover:border-violet-700/70 group-hover:bg-violet-950/50 transition-colors">
              <span class="text-3xl">📝</span>
            </div>
            <div class="flex-1">
              <h2 class="text-lg font-bold text-violet-400 mb-1 group-hover:text-violet-300 transition-colors">
                Text Steganography
              </h2>
              <p class="text-sm text-slate-400 leading-relaxed mb-3">
                Hide secrets in plain text using invisible Zero-Width Unicode
                characters. Compressed and encrypted.
              </p>
              <div class="flex flex-wrap gap-2">
                <span class="text-xs px-2 py-0.5 bg-violet-950/50 text-violet-400/80 rounded-full border border-violet-800/30">
                  Zero-Width
                </span>
                <span class="text-xs px-2 py-0.5 bg-cyan-950/50 text-cyan-400/80 rounded-full border border-cyan-800/30">
                  AES-256
                </span>
                <span class="text-xs px-2 py-0.5 bg-slate-800/50 text-slate-400/80 rounded-full border border-slate-700/30">
                  DEFLATE
                </span>
              </div>
            </div>
          </div>
          <div class="mt-4 pt-4 border-t border-slate-800/50 flex items-center justify-between">
            <div class="flex gap-4 text-xs text-slate-500">
              <span>
                <span class="text-violet-500">✓</span> Copy-paste anywhere
              </span>
              <span>
                <span class="text-cyan-500">✓</span> AES-256-CTR encryption
              </span>
            </div>
            <span class="text-violet-500 text-sm group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
        </button>
      </div>

      <div class="mt-6 grid md:grid-cols-3 gap-4 text-xs">
        <div class="border border-slate-800/30 rounded-lg p-4 bg-slate-900/20">
          <div class="text-emerald-500 mb-2 font-bold">🔒 Secure</div>
          <p class="text-slate-500 leading-relaxed">
            All processing happens in your browser. No data is ever sent to
            servers.
          </p>
        </div>
        <div class="border border-slate-800/30 rounded-lg p-4 bg-slate-900/20">
          <div class="text-cyan-500 mb-2 font-bold">⚡ Fast</div>
          <p class="text-slate-500 leading-relaxed">
            Native Web APIs for compression and encryption. No external
            dependencies.
          </p>
        </div>
        <div class="border border-slate-800/30 rounded-lg p-4 bg-slate-900/20">
          <div class="text-amber-500 mb-2 font-bold">🔓 Open Source</div>
          <p class="text-slate-500 leading-relaxed">
            Fully auditable code. Verify the security yourself on GitHub.
          </p>
        </div>
      </div>
    </div>
  );
}
