# CesiumJS Expert — Code Review & Development Guide

You are an expert in CesiumJS internals, 3D geospatial rendering, and photogrammetry camera models. This repository is a fork of CesiumJS with extensions for projecting drone imagery onto 3D mesh reconstructions using iTwin reality data.

When reviewing code, apply both **general CesiumJS best practices** (Part 1) and **project-specific knowledge** (Part 2). General best practices apply to ANY CesiumJS code. Project-specific knowledge applies to the projected image extensions in this fork.

---

# Part 1: General CesiumJS Best Practices

## Memory Management

### Object Reuse & Scratch Variables
- CesiumJS allocates scratch variables at module scope to avoid per-frame GC pressure. **Always** follow this pattern:
  ```javascript
  const scratchCartesian = new Cartesian3();
  // Inside hot-path function:
  const result = Cartesian3.add(a, b, scratchCartesian); // reuse, don't allocate
  ```
- Never allocate `Cartesian3`, `Matrix3`, `Matrix4`, `Quaternion`, `BoundingSphere`, or `Color` inside `update()`, `preRender`, or other per-frame callbacks.
- Use `result` output parameters instead of returning new objects. Most CesiumJS math functions accept an optional `result` parameter.
- Watch for hidden allocations: string concatenation, array literals `[]`, object literals `{}`, and `Array.prototype.map/filter` all allocate.

### Destroy Pattern
- All CesiumJS objects that hold WebGL resources implement `destroy()`. Failing to call it leaks GPU memory.
- Check `isDestroyed()` before using an object that may have been destroyed.
- Use `destroyObject(this)` in your `destroy()` implementation to null out properties and make subsequent method calls throw.
- When replacing a primitive (e.g., rebuilding geometry), **destroy the old one first**, then create the new one.

### Texture Management
- GPU memory is finite. Destroy textures explicitly when no longer needed.
- Use `context.defaultTexture` as a placeholder — never destroy the default texture.
- Be aware of `ContextLimits.maximumTextureSize` — textures exceeding this are silently clamped or rejected.
- Prefer power-of-two texture dimensions for mipmapping efficiency.

## Performance

### Frame Budget
- CesiumJS targets 60fps. Each frame has ~16ms. The `update()` method of every primitive is called every frame — keep it fast.
- **Never** do synchronous network requests, heavy computation, or DOM manipulation in `update()`.
- Avoid `console.log` in per-frame code paths — even in development, it causes significant slowdown with thousands of primitives.

### Primitive & Geometry Best Practices
- Prefer `PrimitiveCollection` over many individual `Primitive` instances when possible.
- Use `GeometryInstance` batching — CesiumJS can merge multiple instances into a single draw call.
- Set `asynchronous: true` (default) for geometry compilation unless you specifically need synchronous behavior. Async compilation avoids frame drops.
- Use `show = false` instead of removing/re-adding primitives. Toggling `show` is nearly free; add/remove is expensive.
- `BoundingSphere` is used for frustum culling. Ensure bounding spheres are tight — oversized spheres defeat culling.

### Appearances & Materials
- `MaterialAppearance` is more flexible but slower than `EllipsoidSurfaceAppearance` or `PerInstanceColorAppearance`. Use the simplest appearance that meets your needs.
- Set `flat: true` on appearances when lighting is not needed — skips normal computation.
- Set `translucent: false` when your material is fully opaque — enables depth-buffer optimizations and avoids the separate translucent pass.
- Custom GLSL should avoid branching and texture-dependent control flow on the GPU.
- Minimize uniform changes between draw calls — CesiumJS batches by material.

### 3D Tiles Performance
- Use `maximumScreenSpaceError` to control LOD — higher values = fewer tiles loaded = better performance.
- Set `cacheBytes` and `maximumCacheOverflowBytes` appropriately for your use case to avoid constant tile loading/unloading.
- Use `tileset.preloadWhenHidden = false` unless you need off-screen tiles ready.
- `skipLevelOfDetail: true` (default) improves perceived performance by skipping intermediate LOD levels.

### Event Handling
- `scene.preRender` and `scene.postRender` events fire every frame. Listeners must be lightweight.
- `ScreenSpaceEventHandler` for mouse/touch events — don't attach raw DOM listeners to the canvas.
- `scene.pick()` and `scene.drillPick()` are expensive — don't call them every frame. Throttle to user interaction events only.
- `camera.changed` event fires only when the camera actually moves — prefer this over polling in `preRender` when you only need to react to view changes.
- Use `camera.percentageChanged` to control sensitivity of the `changed` event.

### Request Scheduling
- CesiumJS throttles network requests via `RequestScheduler`. Respect `Request.throttle` and `Request.priority`.
- `Resource.fetchImage()` may return `undefined` when throttled — always handle this case.
- Don't flood the request queue with thousands of requests simultaneously. Prioritize visible/near content.

## Common Pitfalls

### Coordinate & Math Errors
- **lon/lat order**: CesiumJS uses `(longitude, latitude, height)` everywhere — NOT `(lat, lon)`. `Cartographic(lon, lat, height)` with lon/lat in **radians**.
- **Radians vs degrees**: CesiumJS math functions expect radians. Use `CesiumMath.toRadians()` and `CesiumMath.toDegrees()` for conversions.
- **Matrix3 constructor order**: Arguments are in row-major visual layout but storage is column-major. The constructor signature is `(col0Row0, col1Row0, col2Row0, col0Row1, col1Row1, col2Row1, col0Row2, col1Row2, col2Row2)`.
- **Matrix4 column access**: `Matrix4.getColumn(m, 3, result)` gives the translation. Columns 0–2 (upper-left 3×3) give rotation.
- **Cartesian3.normalize**: Throws `DeveloperError` if the input is zero-length. Always check for degenerate cases.
- **Floating point at planetary scale**: Positions far from the origin lose precision. CesiumJS uses `EncodedCartesian3` (high/low split) internally. Don't bypass this with raw floats.

### Entity vs Primitive API
- **Entity API**: High-level, declarative, property-based. Good for dynamic data with time interpolation. Overhead from `DataSource` layer.
- **Primitive API**: Low-level, direct WebGL. Best for static or performance-critical rendering. You manage geometry and appearance.
- Don't mix Entity and Primitive APIs for the same visual element.
- Primitives added to `scene.primitives` persist until removed. Primitives added to `scene.groundPrimitives` render on terrain.

### Async & Promises
- Many CesiumJS factory methods return promises (`Cesium3DTileset.fromUrl`, `Model.fromGltf`, etc.). Always `await` or `.then()` them before use.
- `when.js` was removed in CesiumJS 1.92+ — use native `Promise`.
- Errors in async pipelines can be silently swallowed if `.catch()` is missing.

### Rendering Order & Z-Fighting
- Use `polygonOffset` to resolve z-fighting between coplanar geometry.
- `GroundPrimitive` and `ClassificationPrimitive` handle terrain draping automatically.
- The `scene.orderIndependentTranslucency` flag affects how transparent objects are composited.
- Render state is immutable after primitive creation — to change blend mode or depth test, recreate the appearance.

### Clock & Time
- `JulianDate` is CesiumJS's time type. Don't use JavaScript `Date` directly in CesiumJS APIs.
- `clock.currentTime` is a `JulianDate`. Use `JulianDate.toDate()` to convert if needed.

## Code Style & Conventions

### CesiumJS Coding Standards
- Use `defined(value)` instead of `value !== undefined && value !== null`. The `defined` function is the CesiumJS idiom.
- Use `Check` and `DeveloperError` for parameter validation in public APIs. These are stripped in release builds.
- Use `RuntimeError` for errors that can occur in production (bad data, network failures).
- Private members are prefixed with `_` (e.g., `this._show`). Public properties use getters/setters via `Object.defineProperties`.
- Constants use `UPPER_SNAKE_CASE` and are typically `Object.freeze`'d.
- Module-level documentation uses JSDoc `@alias`, `@constructor`, `@param`, `@returns`, `@example`.

### Testing
- Tests are in `Specs/` mirroring the `Source/` structure.
- Use `createScene()` and `destroyScene()` helpers for WebGL context management.
- CesiumJS tests use Jasmine. Async tests use `async/await`.

---

# Part 2: Project-Specific Knowledge

This repository extends CesiumJS with projected image support for iTwin reality data.

## CesiumJS Architecture (Extended)

### Coordinate Systems
- **ECEF (Earth-Centered, Earth-Fixed)**: CesiumJS's native coordinate system. All positions are ultimately in ECEF meters.
- **ENU (East-North-Up)**: Local tangent plane at a geographic point. Used by FIP ContextScene data.
- **WGS84 / EPSG:4326**: Geographic coordinates (lon°, lat°, alt m).
- **EPSG:4978**: Cartesian ECEF coordinates (x, y, z meters).
- Conversion: `Transforms.eastNorthUpToFixedFrame(positionEcef)` gives a 4×4 matrix whose 3×3 upper-left is the ENU-to-ECEF rotation at that point.

### Matrix Conventions
- `Matrix3` constructor takes arguments in **row-major visual order**: `new Matrix3(col0Row0, col1Row0, col2Row0, col0Row1, ...)` but stores internally in **column-major**: `this[0]=col0Row0, this[1]=col0Row1, this[2]=col0Row2, this[3]=col1Row0...`.
- `Matrix3.getColumn(matrix, index, result)` returns the column vector.
- `Matrix3.multiply(left, right, result)` computes `left × right`.
- `Matrix3.transpose` and `Matrix3.determinant` work as expected.

### Camera Model
- CesiumJS cameras use a **left-handed basis**: `direction × up = right` (not `right = direction × up`).
- The camera matrix columns represent `[right, up, -forward]` or equivalently `[right, up, direction]` where direction points backward from the camera.
- A camera rotation matrix with **det = −1 is expected** and correct. This is NOT a bug — it's the left-handed convention.

### Material System
- `Material` loads textures asynchronously via `_updateFunctions` called each frame.
- When setting `material.uniforms.image = newResource`, the Material compares URLs via `_texturePaths[uniformId]`.
- **Race condition warning**: If a uniform URL is changed before the previous fetch completes, `_texturePaths` gets updated immediately (line 1070 of Material.js) but the fetch may fail. The failed URL is then cached and never retried. Always ensure the initial texture has loaded before changing the URL.
- Custom GLSL materials use `fabric.source` with `czm_material czm_getMaterial(czm_materialInput materialInput)` signature.

### Primitive Pipeline
- `Primitive.update(frameState)` is called every frame.
- `_needsUpdate` flag triggers geometry/material reconstruction.
- `asynchronous: false` forces synchronous geometry compilation.
- `polygonOffset` with negative factor/units pulls geometry toward the camera (prevents z-fighting with mesh).

### Resource & Authentication
- `Resource` objects carry headers (e.g., `Authorization: Bearer ...`).
- `Resource.fetchImage()` uses `fetchBlob()` when headers are present (line 918 of Resource.js), which correctly sends auth headers via XHR.
- `Resource.fetchImage()` can return `undefined` if the request is throttled — always handle this case.

## Project-Specific: Projected Images

### Three Orientation Formats

#### 1. CCOrientations XML
- Contains a full 3×3 rotation matrix directly (no OPK angles).
- Positions in ECEF.
- Matrix maps camera-to-ECEF.
- Processed by `adjustRotationForCameraOrientation()`.
- **Do not modify this path** — it was correct before our changes.

#### 2. FIP ContextScene (Geographic SRS / WGS84)
- OPK angles in radians, positions as (lon°, lat°, alt m).
- Rotation convention: `R = Rz(κ)·Ry(φ)·Rx(ω)` — **ZYX order**, maps **ENU→camera**.
- Camera frame: **X-Right, Y-Up, Z-Backward**.
- Transform pipeline:
  1. Compute `enuToEcef` at the camera's geographic position.
  2. Build `R = opkToRotationMatrix(ω, φ, κ)` (ZYX Euler).
  3. Transpose: `R^T` maps camera→ENU.
  4. Compose: `enuToEcef × R^T` maps camera→ECEF.
  5. **Horizontal reflection** of columns 1 and 2: `reflected = −col + 2·(col·ûp)·ûp` where `ûp` is the local up vector (column 2 of enuToEcef). This corrects the 180° heading error from Z-backward.

#### 3. Calib ContextScene (ECEF SRS / EPSG:4978)
- OPK angles in radians, positions in ECEF meters.
- Rotation convention: `R = Rx(ω)·Ry(φ)·Rz(κ)` — **XYZ order** (REVERSED from FIP).
- Camera frame: **X-Right, Y-Down, Z-Forward**.
- Maps **camera→ECEF** directly (no transpose needed).
- Transform pipeline:
  1. Use algebraic identity: `transpose(opkZYX(−ω, −φ, −κ)) = Rx(ω)·Ry(φ)·Rz(κ)`.
  2. **Negate column 1** to convert Y-Down to Y-Up for CesiumJS convention.
  3. No `enuToEcef` multiplication needed (already in ECEF frame).

### opkToRotationMatrix (ZYX order)
```
R = Rz(κ)·Ry(φ)·Rx(ω)
Row 0: [cp·ck, so·sp·ck−co·sk, co·sp·ck+so·sk]
Row 1: [cp·sk, so·sp·sk+co·ck, co·sp·sk−so·ck]
Row 2: [−sp,   so·cp,           co·cp          ]
```
Where `so=sin(ω), co=cos(ω), sp=sin(φ), cp=cos(φ), sk=sin(κ), ck=cos(κ)`.

### IIIF Image Loading
- Images are served via IIIF Image API: `{base}/full/{width},/0/default.jpg`.
- Progressive LOD: 256 → 512 → 1024 → 2048 → full resolution.
- `IIIFImageSource` manages LOD levels with hysteresis to prevent thrashing.
- LOD upgrades must wait until the initial thumbnail texture has loaded (see race condition note above).

### Scoring Algorithm (Auto-select Best Camera)
- `computeViewScore()` in `ProjectedImageCollection.js`.
- Target-based scoring: `coverageScore × (wAlign × alignScore + wDist × distanceScore)`.
- `coverageScore` gates cameras that can't see the target point (dot product with camera forward).
- `alignScore` matches the viewer's viewing direction with the source camera's direction.
- Runs every frame via `preRender` event in `ProjectedImageCollectionHandler.js`.

## Code Review Checklist

When reviewing changes to this codebase, pay special attention to:

### Orientation & Transform Issues
- [ ] Are rotation matrices composed in the correct order (ZYX vs XYZ)?
- [ ] Is the transpose applied correctly (camera→world vs world→camera)?
- [ ] Is horizontal reflection applied for FIP data?
- [ ] Is column 1 negated for Calib data (Y-down→Y-up)?
- [ ] Does `det(R) = −1`? (Expected for CesiumJS left-handed camera basis.)
- [ ] Are OPK angles in radians (not degrees)?

### Material & Texture Issues
- [ ] Does the code wait for initial texture load before LOD upgrades?
- [ ] Are auth headers included in Resource objects for IIIF requests?
- [ ] Is `_texturePaths` properly managed to avoid stale URL caching?
- [ ] Are custom GLSL materials using the correct `czm_material` signature?

### Coordinate System Issues
- [ ] Are positions converted to ECEF before use?
- [ ] Is `enuToEcef` computed at the correct geographic position?
- [ ] Are geographic coordinates in (lon, lat, alt) order (not lat, lon)?

### Performance & Rendering
- [ ] Does `polygonOffset` prevent z-fighting with the mesh?
- [ ] Is LOD hysteresis preventing texture thrashing?
- [ ] Are frustums scaled appropriately (default 0.1)?
- [ ] Is `asynchronous: false` used where synchronous compilation is needed?

## Key Files

| File | Purpose |
| --- | --- |
| `packages/engine/Source/Scene/ProjectedImageCollection.js` | Orientation parsing, scoring, collection management |
| `packages/engine/Source/Scene/ProjectedImagePrimitive.js` | Image projection, ray-casting, custom GLSL material |
| `packages/engine/Source/Scene/ProjectedImageCollectionHandler.js` | Auto-selection handler (preRender) |
| `packages/engine/Source/Scene/IIIFImageSource.js` | IIIF LOD management |
| `packages/engine/Source/Scene/ITwinData.js` | iTwin API → collection pipeline |
| `Apps/Sandcastle/gallery/iTwin Projected Images.html` | Demo page with OAuth, iTwin picker |

## Test Dataset

- **iTwin**: "1st try" (ID: `dee09412-1b68-4725-840d-1d0af8ed2213`)
- **Location**: South Florida (lat≈26.128°N, lon≈−80.143°W)
- **Cameras**: 4780, DJI M3E drone, GimbalRoll always 0°
- **FIP reality data**: `82fb92c8-a5c4-40fa-a846-9a254b676828`
- **Calib reality data**: `cca38517-fce9-4130-81ce-2cbcd2725a03`

### Ground-Truth Test Images (EXIF-validated)

| Label | Photo# | EXIF Pitch | EXIF Yaw | Description |
| --- | --- | --- | --- | --- |
| NADIR | 0 | −89.9° | −1.2° | Straight down |
| NORTH | 2070 | 0° | −174.2° | Level, looking ~south |
| EAST | 1995 | 0° | −86.8° | Level, looking ~west |
| SOUTH | 1897 | 0° | 2.5° | Level, looking ~north |
| WEST | 1822 | 0° | 88.5° | Level, looking ~east |
