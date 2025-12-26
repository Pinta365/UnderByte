# Agents quick checklist

This document provides guidelines for AI agents and contributors working on
UnderByte.

## Project Structure

- **`islands/Steganography.tsx`**: Main interactive component handling UI,
  state, and steganography operations
- **`utils/steganography.ts`**: Core steganography logic (pixel-domain LSB
  embedding/extraction for lossless formats, coefficient-domain embedding for
  JPEG, statistics)
- **`routes/index.tsx`**: Main page route
- **`routes/_app.tsx`**: App layout wrapper
- **`main.ts`**: Fresh app initialization
- **`@cross/image`**: Image processing library (via JSR)

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
- **Image Processing**: Use `@cross/image` library (via JSR)
- **Format Handling**: Supports both lossless formats (pixel-domain LSB) and
  JPEG (coefficient-domain DCT embedding)
- **Error Handling**: Display errors via `error` signal, show user-friendly
  messages
- **File Operations**: Use browser File API for uploads, create download links
  for exports

### Important Notes

- **Lossy Formats**: JPEG is fully supported using DCT coefficient-domain
  embedding, which allows data to survive JPEG re-compression. Other lossy
  formats (WebP lossy, etc.) may be added in the future.
- **Bit Depth**: Supports 1-4 bits per channel. Higher bit depth = more capacity
  but more visible changes.
- **Password Encryption**: Uses XOR encryption (simple but effective for
  steganography use case)
- **Statistics**: Tracks embedding distribution (LSB=1, LSB=0, changed bits) for
  pixel-domain methods, and coefficient statistics for JPEG coefficient-domain
  methods

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

- **Additional Lossy Formats**: DCT domain steganography for other lossy formats
  (WebP lossy, etc.)
- Keep this file updated as the project evolves
- Maintain backward compatibility for user-facing features
