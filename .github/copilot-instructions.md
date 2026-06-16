# Copilot Instructions for aact-cesium

This is a **fork of CesiumJS** (v1.140.0) with extensions for projecting drone imagery onto 3D mesh reconstructions using iTwin reality data. The upstream CesiumJS library provides the 3D globe/map rendering engine; this fork adds projected image support.

## Build, Test, and Lint

Requires Node.js ≥ 20.19.0.

```sh
npm install           # Install dependencies
npm run build         # Build the project (gulp)
npm start             # Dev server at http://localhost:8080
npm run eslint        # Lint all JS/TS/HTML files
npm run test          # Run all tests (Karma + Jasmine, launches browser)
npm run test-non-webgl  # Fast subset (~15s) — no GPU needed
```

### Running a single test or suite

```sh
npm run test -- --grep "Cartesian3"          # Filter by describe/it name
npm run test -- --includeName "ProjectedImage"  # Same, alternate flag
```

Or in the spec file, change `it` → `fit` or `describe` → `fdescribe` to focus.

### E2E tests

```sh
npm run test-e2e      # Playwright (Chromium)
npm run test-e2e-all  # All browsers
```

## Architecture

### Monorepo structure

The repo is an npm workspaces monorepo with three packages:

- **`packages/engine`** (`@cesium/engine`) — Core rendering, math, scene, data APIs
- **`packages/widgets`** (`@cesium/widgets`) — UI widgets for CesiumJS
- **`packages/sandcastle`** — Live code editor/demo app

The top-level `Source/` directory re-exports from `packages/engine/Source/` and `packages/widgets/Source/`.

### Key directories

- `packages/engine/Source/Core/` — Math primitives (`Cartesian3`, `Matrix3`, `Matrix4`, `Transforms`, etc.)
- `packages/engine/Source/Scene/` — Rendering primitives, materials, camera, 3D Tiles, imagery providers
- `packages/engine/Source/Shaders/` — GLSL shader sources
- `Specs/` — Jasmine test specs mirroring `Source/` structure
- `packages/engine/Specs/` — Engine-specific specs
- `Apps/Sandcastle/gallery/` — Demo/example pages (HTML)

### Projected image extensions (this fork)

| File | Purpose |
|---|---|
| `packages/engine/Source/Scene/ProjectedImageCollection.js` | Orientation parsing, scoring, collection management |
| `packages/engine/Source/Scene/ProjectedImagePrimitive.js` | Image projection, ray-casting, custom GLSL material |
| `packages/engine/Source/Scene/ProjectedImageCollectionHandler.js` | Auto-selection handler (preRender event) |
| `packages/engine/Source/Scene/IIIFImageSource.js` | IIIF progressive LOD image loading |
| `packages/engine/Source/Scene/ITwinData.js` | iTwin API → collection pipeline |
| `Apps/Sandcastle/gallery/iTwin Projected Images.html` | Demo page with OAuth, iTwin picker |

Detailed domain knowledge for the projected image system (orientation formats, coordinate transforms, camera models) is in `.github/instructions/cesium-expert.instructions.md`.

## Conventions

### CesiumJS idioms

- **Null checks**: Use `defined(value)` instead of `value !== undefined && value !== null`.
- **Private members**: Prefix with `_` (e.g., `this._show`). Expose via `Object.defineProperties` getters/setters.
- **Parameter validation**: Use `Check` and `DeveloperError` for public API validation (stripped in release builds). Use `RuntimeError` for production errors.
- **Constants**: `UPPER_SNAKE_CASE`, frozen with `Object.freeze`.

### Memory management (critical for performance)

- **Scratch variables**: Allocate reusable objects (`Cartesian3`, `Matrix3`, `Matrix4`, etc.) at **module scope**, never inside per-frame code paths like `update()` or `preRender` listeners.
  ```javascript
  const scratchCartesian = new Cartesian3();
  function myUpdate(frameState) {
    const pos = Cartesian3.add(a, b, scratchCartesian); // reuse, don't allocate
  }
  ```
- **Destroy pattern**: Objects holding WebGL resources must implement `destroy()` using `destroyObject(this)`. Always call `destroy()` before discarding references.
- **`result` parameters**: Most math functions accept an optional `result` output parameter to avoid allocations. Use it.

### Coordinate system gotchas

- CesiumJS uses **(longitude, latitude, height)** order — not (lat, lon). `Cartographic` takes lon/lat in **radians**.
- `Matrix3` constructor takes arguments in **row-major visual order** but stores **column-major**.
- CesiumJS cameras use a **left-handed basis** — rotation matrices with `det = −1` are expected and correct.

### Code style

- Prettier auto-formats on commit (via husky). Single quotes for JS strings.
- ESLint config is from `@cesium/eslint-config`. Run `npm run eslint` before PRs.
- Files are named after their single exported class/function (`PascalCase.js`).
- JSDoc uses `@alias`, `@constructor`, `@param`, `@returns`, `@example`.

### Testing conventions

- Test files mirror `Source/` structure under `Specs/`.
- Use `createScene()` / `destroyScene()` helpers for WebGL context management.
- Jasmine with `async/await` for async tests.
- Target 100% code coverage for new code.
