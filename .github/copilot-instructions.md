# directional-light-angle-sphere

## Build and validation commands

- `npm run build` bundles `src/main.ts` with esbuild via `build.ts` and copies `src/index.html`, `src/styles/`, and `src/sphere.ico` into `dist/` (`sphere.ico` is renamed to `favicon.ico`).
- `npm run check` runs `tsc --noEmit`.
- There is no test runner or lint script configured in `package.json`, so there is no repo-supported full-test, single-test, or lint command.

## High-level architecture

- `src/main.ts` is the application orchestrator. It validates required DOM elements, exposes `lightAnglePaths` and helper functions on `window`, builds the grouped sidebar, manages search, carousel, and top-level tab state, and reinitializes all four WebGPU light-path views when the selected group or overlay set changes.
- `src/data.ts` is the runtime dataset: a large in-repo `lightAnglePaths` object plus `lightPathGroups = getPathDataGroups(lightAnglePaths)`. The browser app reads this TypeScript module at runtime.
- `src/utils.ts` contains the grouping and formatting logic that turns raw path data into UI-facing groups and formats angle values as `pi * fraction` strings for the right-hand details panel.
- `src\webgpu\direction-data.ts` converts stored `{ x, y }` radian samples into normalized 3D directions, interpolates between timestamps with spherical interpolation, adds a wraparound sample at hour 24, and emits colored `SegmentData[]` for the renderers.
- `src\webgpu\visualization-sphere.ts`, `visualization-plane.ts`, `visualization-ring.ts`, and `visualization-cylinder.ts` are four separate WebGPU renderers over the same path data:
  - sphere: 3D globe with axes and latitude/longitude guide lines
  - plane: stereographic projection onto a circular disk
  - ring: torus projection where time wraps around the major circle
  - cylinder: time on the Y axis with the same projected cross-sections stacked vertically
- `src\webgpu\visualization-hexagon.ts` is independent from the light-path pipeline. It renders the Divine Hexagon tab from six persisted vertex inputs.
- `extract.ts` reads `gparams\*.json` and writes `light-angles.json`, but the runtime app does not load `light-angles.json`; it imports `src/data.ts`.

## Key conventions

- The UI is group-driven, not raw-path-driven. `lightPathGroups` collapses many path keys into one group by comparing each path's `'0'` segment payload, and most selection logic works on group indexes rather than original path names.
- When the selected group or overlays change, `src/main.ts` creates synthetic entries on `window.lightAnglePaths` such as `__temp_group_*` and `__temp_combined__`. The visualizers only receive a `pathKey` and read segment data from that temporary runtime entry.
- The four main visualizers share the same controller contract: `{ pause(), resume(), stop(), running }`. `src/main.ts` handles data changes by stopping and recreating every renderer instead of mutating existing controllers in place.
- Path data uses the nested shape `lightAnglePaths[pathKey][segmentId][time] = { x, y }` plus `title`. Segment IDs and times are stored as object keys and then parsed/sorted numerically where needed.
- Direction conversion is intentionally signed: `direction-data.ts` maps stored radians to 3D with `x = cos(vertical) * -sin(horizontal)`, `z = cos(vertical) * cos(horizontal)`, and `y = -sin(vertical)`. Keep that convention aligned across any new projections.
- Plane, ring, and cylinder projections all reuse the same stereographic-style scale factor `1 / (1 + direction.y + 0.01)`; the `+ 0.01` epsilon is intentional.
- `.wgsl` files are imported as text through the esbuild loader in `build.ts`. New shaders should live under `src\shaders\` and be re-exported from `src\shaders\_index.ts`.
- Formatting is controlled by Prettier: 4 spaces, semicolons, single quotes, trailing commas where allowed, 120-column width, and CRLF line endings.
