import Cartesian3 from "../Core/Cartesian3.js";
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

export default IIIFImageSource;
