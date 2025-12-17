# Directional Light Angle Sphere

A TypeScript + WebGPU visualization that shows how a directional light vector drifts across a translucent sphere following a lemniscate (figure-eight) path.

![App Screenshot](https://github.com/user-attachments/assets/23063659-04c8-43fe-b3e1-3daa03771fb4)

## Features

- **Translucent sphere** keeps the fading trail visible inside and out.
- **Scale markers** (latitude/longitude arcs) anchor the viewer on the sphere.
- **Procedural lemniscate** data built on the fly with spherical linear interpolation.
- **Glowing head + ribbon trail** emphasize the current direction and its history.
- **Play/Pause control** without reloading the page.

## Requirements

- Node.js 18+ (for building with `tsx`/esbuild).
- A browser with WebGPU enabled (Chrome/Edge 113+, Safari 18+ Technology Preview, Firefox Nightly with `dom.webgpu.enabled`).

Safari WebGPU flag: `Settings -> Advanced -> Feature Flags -> WebGPU`.

## Getting Started

```bash
git clone https://github.com/astrologerphi/directional-light-angle-sphere.git
cd directional-light-angle-sphere
npm install
npm run build
npx serve dist   # or use any static file server
```

Then open the printed URL (defaults to `http://localhost:3000`). You can also open `dist/index.html` directly if your browser allows local file access to WebGPU.

## Project Structure

```
src/
	index.html               # Source HTML template
	main.ts                  # Entry point that wires DOM + WebGPU controller
	styles/main.css          # Layout and typography
	webgpu/
		demo-data.ts           # Lemniscate samples + SLERP helper
		geometry.ts            # Sphere mesh, scale rings, matrix math
		shaders.ts             # WGSL shader sources
		types.ts               # Shared vector + light interfaces
		visualization.ts       # Core WebGPU pipelines + render loop
scripts/
	build.ts                 # tsx-driven build script (esbuild + static copy)
dist/                      # Generated output (ignored by git)
```

## Build Pipeline

- **TypeScript** provides type safety for the rendering pipeline and DOM logic.
- **tsx** executes `scripts/build.ts`, which bundles `src/main.ts` with esbuild and copies the HTML/CSS into `dist/`.
- **esbuild** outputs a single ESM bundle (`dist/main.js`) alongside the original static assets.

### NPM Scripts

| Command          | Description                                   |
|------------------|-----------------------------------------------|
| `npm run build`  | Cleans `dist/`, bundles TypeScript, copies UI. |
| `npm run check`  | Runs `tsc --noEmit` for type checking.         |

## How It Works

1. `main.ts` verifies WebGPU support, wires the play/pause control, and boots the visualization.
2. `visualization.ts` creates geometry buffers, pipelines, and per-frame uniforms, then animates a light vector along the generated lemniscate.
3. The glowing head and ribbon trail are updated every frame by streaming fresh vertex data to GPU buffers.
4. Static assets (HTML/CSS) remain framework-free; everything else is bundled through the TypeScript build.

## License

ISC
