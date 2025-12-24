# Agents quick checklist

This document provides guidelines for AI agents and contributors working on
UnderByte.

## Project Structure

- **`islands/Steganography.tsx`**: Main interactive component handling UI,
  state, and steganography operations
- **`utils/steganography.ts`**: Core LSB steganography logic (embedding,
  extraction, statistics)
- **`routes/index.tsx`**: Main page route
- **`routes/_app.tsx`**: App layout wrapper
- **`main.ts`**: Fresh app initialization
- **`references/cross-image-package/`**: Local copy of `@cross/image` library
  for possibly modifications and API

## Development

### Running Locally

```bash
deno task dev
```

Development server runs at `http://localhost:5173` (or network IP)

### Pre-commit Validation

Run: `deno task check`

This runs:

- `deno fmt --check` - Format check
- `deno lint` - Linter
- `deno check` - Type checking

**Note**: `deno check` may show type resolution errors for transitive npm
dependencies (e.g., `@babel/core` from `@fresh/plugin-vite`). This is a known
Deno limitation and doesn't affect runtime functionality. The application builds
and runs correctly despite these type checking warnings.

### Build & Production

```bash
deno task build
deno task start
```

## Guidelines

### Code Style

- **Use Preact Signals** for reactive state management (`useSignal`,
  `useComputed`)
- **Follow Fresh conventions**: Islands for interactivity, routes for pages
- **Tailwind CSS** for styling - use utility classes, maintain dark theme
  consistency
- **TypeScript strict mode** - ensure proper typing

### Key Conventions

- **State Management**: Use `@preact/signals` for all reactive state
- **Image Processing**: Use `@cross/image` library (local copy in
  `references/cross-image-package/`)
- **Format Handling**: Only lossless formats support LSB steganography currently
- **Error Handling**: Display errors via `error` signal, show user-friendly
  messages
- **File Operations**: Use browser File API for uploads, create download links
  for exports

### Important Notes

- **Lossy Formats**: JPEG and other lossy formats can be uploaded but cannot be
  written to (only decoded). This is intentional - lossy format support is
  planned for future release using DCT domain embedding.
- **Bit Depth**: Supports 1-4 bits per channel. Higher bit depth = more capacity
  but more visible changes.
- **Password Encryption**: Uses XOR encryption (simple but effective for
  steganography use case)
- **LSB Statistics**: Tracks LSB=1, LSB=0, and changed bits per channel for
  analysis

### UI/UX Guidelines

- **Operation Modes**: Use `operationMode` signal to control conditional
  rendering (`"initial" | "encode" | "decode"`)
- **Responsive Design**: Use Tailwind responsive classes (`md:`, `lg:`, etc.)
- **Color Scheme**: Dark theme with emerald green accents (`slate-950`
  background, `emerald-500` accents)
- **Accessibility**: Ensure buttons are disabled when appropriate, show clear
  error messages

### File Organization

- Keep temporary test files in `local_test/` (gitignored)
- Static assets go in `static/` directory
- Island components (interactive) go in `islands/`
- Route components (pages) go in `routes/`
- Utility functions go in `utils/`

### Dependencies

- **Fresh**: Deno web framework
- **@cross/image**: Image processing (local copy for potential modifications)
- **Preact & Signals**: UI framework and reactivity
- **Tailwind CSS**: Styling
- **Vite**: Build tool

### Future Work

- **Lossy Format Support**: DCT domain steganography for JPEG (planned)
- Keep this file updated as the project evolves
- Maintain backward compatibility for user-facing features
