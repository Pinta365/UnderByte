import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Steganography from "../islands/Steganography.tsx";

export default define.page(function Home() {
  return (
    <div class="min-h-screen bg-slate-950 text-emerald-500 font-mono">
      <Head>
        <title>UnderByte - LSB Steganography</title>
      </Head>
      <div class="container mx-auto px-4 py-8">
        <Steganography />
      </div>
    </div>
  );
});
