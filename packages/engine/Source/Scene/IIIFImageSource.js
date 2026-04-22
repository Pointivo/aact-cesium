import Cartesian2 from "../Core/Cartesian2.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Cartesian4 from "../Core/Cartesian4.js";
import Matrix4 from "../Core/Matrix4.js";
import Resource from "../Core/Resource.js";

/**
 * Manages IIIF image loading for a single projected image with progressive
 * LOD (level-of-detail) resolution management.
 *
 * Selects an appropriate IIIF whole-image resolution based on screen-space
 * pixel coverage, with hysteresis to prevent thrashing near level boundaries.
 *
 * @alias IIIFImageSource
 * @constructor
 *
 * @param {object} options
 * @param {string} options.iiifImageBase IIIF image base URL (e.g. "https://host/itwinId/imageId").
 * @param {number} options.imageWidth Full image width in pixels.
 * @param {number} options.imageHeight Full image height in pixels.
 * @param {string} options.authHeader Authorization header value (e.g. "Bearer ...").
 *
 * @private
 */
function IIIFImageSource(options) {
  this._iiifImageBase = options.iiifImageBase;
  this._imageWidth = options.imageWidth || 4032;
  this._imageHeight = options.imageHeight || 3024;
  this._authHeader = options.authHeader;

  // Cap LOD levels at source image's largest dimension
  this._maxSourceDimension = Math.max(this._imageWidth, this._imageHeight);
  if (
    !Number.isFinite(this._maxSourceDimension) ||
    this._maxSourceDimension <= 0
  ) {
    this._maxSourceDimension = 4096;
  }

  // LOD levels — extended up to min(maxTextureSize, source dimension) at runtime
  this._lodLevels = [256, 512, 1024, 2048].filter(
    (s) => s <= this._maxSourceDimension,
  );
  // Include full-res level if it exceeds the highest power-of-2 level
  if (
    this._maxSourceDimension > 2048 &&
    this._lodLevels[this._lodLevels.length - 1] !== this._maxSourceDimension
  ) {
    this._lodLevels.push(this._maxSourceDimension);
  }
  if (this._lodLevels.length === 0) {
    this._lodLevels = [this._maxSourceDimension];
  }
  this._maxTextureSize = 4096;
  this._maxTextureSizeSet = false;

  // Matches the initial 256px thumbnail URL set in ITwinData.js
  this._currentLodLevel = this._lodLevels[0];

  // Region mode state (for high-zoom cropping)
  this._regionMode = false;
  this._currentRegion = null; // { x, y, w, h } in image pixel coords
  this._loadedRegion = null; // the region we actually loaded (with padding)
  this._fullImageLoaded = false; // once true, never switch to region mode
}

/**
 * Hysteresis factor for LOD downgrade. Camera must drop below
 * currentLevel * HYSTERESIS_FACTOR before downgrading.
 * @type {number}
 * @private
 */
IIIFImageSource.HYSTERESIS_FACTOR = 0.7;

/**
 * Set the GPU max texture size from the GL context. Call once during first update.
 * Extends LOD levels up to the GPU maximum.
 * @param {number} maxTextureSize
 */
IIIFImageSource.prototype.setMaxTextureSize = function (maxTextureSize) {
  if (!Number.isFinite(maxTextureSize) || maxTextureSize <= 0) {
    return;
  }
  this._maxTextureSize = maxTextureSize;
  this._maxTextureSizeSet = true;

  // Rebuild LOD levels capped by both GPU max and source image size
  const maxSrc = Number.isFinite(this._maxSourceDimension)
    ? this._maxSourceDimension
    : 4096;
  const cap = Math.min(maxTextureSize, maxSrc);
  this._lodLevels = [];
  let size = 256;
  while (size <= cap) {
    this._lodLevels.push(size);
    size *= 2;
  }
  // Add the actual source dimension as the final level if it's not a power of 2
  const lastLevel = this._lodLevels[this._lodLevels.length - 1];
  if (maxSrc > lastLevel && maxSrc <= maxTextureSize) {
    this._lodLevels.push(maxSrc);
  }
  // Ensure at least one level
  if (this._lodLevels.length === 0) {
    this._lodLevels = [cap];
  }
};

/**
 * Compute the desired LOD level for a given screen-space pixel coverage,
 * applying hysteresis to prevent thrashing near level boundaries.
 *
 * Upgrade: as soon as screenPixels exceeds the level below, load the next
 *   higher level (so the image always has more detail than the screen needs).
 * Downgrade: delayed until screenPixels drops below the lower level × HYSTERESIS_FACTOR.
 *
 * Example with levels [256, 512, 1024, 2048]:
 *   screenPixels = 200 → level 256
 *   screenPixels = 257 → level 512 (exceeds 256, eagerly load next)
 *   At level 512, downgrade to 256 only when screenPixels < 256 * 0.7 = 179
 *
 * @param {number} screenPixels Approximate screen pixels covered by the projected image.
 * @returns {number} The desired LOD width in pixels (e.g. 256, 512, 1024...).
 */
IIIFImageSource.prototype.computeDesiredLodLevel = function (screenPixels) {
  const levels = this._lodLevels;

  // Pick the next level above screenPixels for eager upgrade
  let idealLevel = levels[levels.length - 1];
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] > screenPixels) {
      idealLevel = levels[i];
      break;
    }
  }

  // Hysteresis: resist downgrade until screen coverage drops well below
  // the lower level's threshold
  const current = this._currentLodLevel;
  if (current > 0 && idealLevel < current) {
    const currentIdx = levels.indexOf(current);
    const lowerLevel = currentIdx > 0 ? levels[currentIdx - 1] : 0;
    if (screenPixels >= lowerLevel * IIIFImageSource.HYSTERESIS_FACTOR) {
      return current;
    }
  }

  return idealLevel;
};

/**
 * Create a Resource for a whole-image LOD level.
 *
 * @param {number} width Desired image width in pixels.
 * @returns {Resource}
 */
IIIFImageSource.prototype.getLodResource = function (width) {
  if (width >= this._maxSourceDimension) {
    this._fullImageLoaded = true;
  }
  return new Resource({
    url: `${this._iiifImageBase}/full/${width},/0/default.jpg`,
    headers: { Authorization: this._authHeader },
  });
};

/**
 * Compute the approximate screen-space pixel coverage of a projected image
 * given the Cesium camera state.
 *
 * @param {FrameState} frameState The current frame state.
 * @param {BoundingSphere} boundingSphere The bounding sphere of the projected image geometry.
 * @returns {number} Approximate screen pixels across the image diameter.
 */
IIIFImageSource.computeScreenPixels = function (frameState, boundingSphere) {
  const viewerDistance = Cartesian3.distance(
    frameState.camera.positionWC,
    boundingSphere.center,
  );

  if (viewerDistance < 1e-6) {
    return Infinity;
  }

  const frustum = frameState.camera.frustum;
  const fov = frustum.fov ?? frustum.fovy ?? Math.PI / 3;
  const viewportHeight = frameState.context.drawingBufferHeight;

  // Meters per pixel at the projected image's distance
  const metersPerPixel =
    (2 * viewerDistance * Math.tan(fov / 2)) / viewportHeight;

  // Approximate world-space diameter of the projected image
  const imageWorldSize = boundingSphere.radius * 2;

  return imageWorldSize / metersPerPixel;
};

/**
 * Padding factor added around the visible region to reduce re-requests
 * during smooth camera movement.
 * @type {number}
 * @private
 */
IIIFImageSource.REGION_PADDING = 0.15;

/**
 * Compute the visible region of the image in UV and pixel coordinates
 * by projecting geometry vertices to screen space.
 *
 * @param {FrameState} frameState The current frame state.
 * @param {Float64Array} positions Vertex positions (x,y,z interleaved).
 * @param {Float32Array} uvs Vertex UVs (u,v interleaved).
 * @returns {object|undefined} { x, y, w, h, uvOffset, uvScale } or undefined if nothing visible.
 */
IIIFImageSource.prototype.computeVisibleRegion = function (
  frameState,
  positions,
  uvs,
) {
  const camera = frameState.camera;
  const viewMatrix = camera.viewMatrix;
  const projectionMatrix = camera.frustum.projectionMatrix;
  const viewProjection = Matrix4.multiply(
    projectionMatrix,
    viewMatrix,
    scratchViewProjection,
  );

  const vpWidth = frameState.context.drawingBufferWidth;
  const vpHeight = frameState.context.drawingBufferHeight;

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let anyVisible = false;

  const numVertices = positions.length / 3;
  for (let i = 0; i < numVertices; i++) {
    scratchPosition.x = positions[i * 3];
    scratchPosition.y = positions[i * 3 + 1];
    scratchPosition.z = positions[i * 3 + 2];
    scratchPosition.w = 1.0;

    Matrix4.multiplyByVector(viewProjection, scratchPosition, scratchClip);

    // Skip vertices behind the camera
    if (scratchClip.w <= 0) {
      continue;
    }

    // NDC coordinates [-1, 1]
    const ndcX = scratchClip.x / scratchClip.w;
    const ndcY = scratchClip.y / scratchClip.w;

    // Screen coordinates [0, width/height]
    const screenX = (ndcX + 1.0) * 0.5 * vpWidth;
    const screenY = (1.0 - ndcY) * 0.5 * vpHeight;

    // Check if on screen (with generous margin)
    if (
      screenX >= -vpWidth * 0.5 &&
      screenX <= vpWidth * 1.5 &&
      screenY >= -vpHeight * 0.5 &&
      screenY <= vpHeight * 1.5
    ) {
      const u = uvs[i * 2];
      const v = uvs[i * 2 + 1];
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
      anyVisible = true;
    }
  }

  if (!anyVisible) {
    return undefined;
  }

  // Add padding
  const pad = IIIFImageSource.REGION_PADDING;
  const uRange = uMax - uMin;
  const vRange = vMax - vMin;
  uMin = Math.max(0, uMin - uRange * pad);
  uMax = Math.min(1, uMax + uRange * pad);
  vMin = Math.max(0, vMin - vRange * pad);
  vMax = Math.min(1, vMax + vRange * pad);

  // Convert to pixel coordinates
  const imgW = this._imageWidth;
  const imgH = this._imageHeight;
  const px = Math.floor(uMin * imgW);
  const py = Math.floor(vMin * imgH);
  const pw = Math.ceil((uMax - uMin) * imgW);
  const ph = Math.ceil((vMax - vMin) * imgH);

  return {
    x: Math.max(0, px),
    y: Math.max(0, py),
    w: Math.min(pw, imgW - px),
    h: Math.min(ph, imgH - py),
    uvOffset: new Cartesian2(uMin, vMin),
    uvScale: new Cartesian2(uMax - uMin, vMax - vMin),
  };
};

/**
 * Check if the current viewport has moved enough beyond the loaded region
 * to warrant a new region request.
 *
 * @param {object} visibleRegion The visible region from computeVisibleRegion().
 * @returns {boolean} True if a new region request is needed.
 */
IIIFImageSource.prototype.needsRegionUpdate = function (visibleRegion) {
  if (!this._loadedRegion) {
    return true;
  }

  const loaded = this._loadedRegion;
  // Re-request if visible region extends beyond loaded region
  return (
    visibleRegion.x < loaded.x ||
    visibleRegion.y < loaded.y ||
    visibleRegion.x + visibleRegion.w > loaded.x + loaded.w ||
    visibleRegion.y + visibleRegion.h > loaded.y + loaded.h
  );
};

/**
 * Create a Resource for a region of the image at native resolution.
 *
 * @param {number} x Left pixel coordinate.
 * @param {number} y Top pixel coordinate.
 * @param {number} w Width in pixels.
 * @param {number} h Height in pixels.
 * @returns {Resource}
 */
IIIFImageSource.prototype.getRegionResource = function (x, y, w, h) {
  // Clamp to image bounds
  const cw = Math.min(w, this._imageWidth - x);
  const ch = Math.min(h, this._imageHeight - y);
  this._loadedRegion = { x: x, y: y, w: cw, h: ch };
  this._regionMode = true;

  return new Resource({
    url: `${this._iiifImageBase}/${x},${y},${cw},${ch}/max/0/default.jpg`,
    headers: { Authorization: this._authHeader },
  });
};

// Scratch variables for computeVisibleRegion
const scratchViewProjection = new Matrix4();
const scratchPosition = new Cartesian4();
const scratchClip = new Cartesian4();

export default IIIFImageSource;
