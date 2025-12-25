import { Image } from "@cross/image";

// Extract coefficients from JPEG
const jpegData = await Deno.readFile("input.jpg");
const coeffs = await Image.extractCoefficients(jpegData, "jpeg");

if (coeffs) {
  // Modify coefficients for steganography (embed hidden data)
  // e.g., modify LSB of AC coefficients

  // Re-encode to JPEG
  const encoded = await Image.encodeFromCoefficients(coeffs, "jpeg");
  await Deno.writeFile("output.jpg", encoded);
}
