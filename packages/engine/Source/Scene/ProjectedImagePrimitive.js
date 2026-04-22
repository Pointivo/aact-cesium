import BoundingSphere from "../Core/BoundingSphere.js";
import Cartesian2 from "../Core/Cartesian2.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Check from "../Core/Check.js";
import Color from "../Core/Color.js";
import ComponentDatatype from "../Core/ComponentDatatype.js";
import defined from "../Core/defined.js";
import Frozen from "../Core/Frozen.js";
import destroyObject from "../Core/destroyObject.js";
import Geometry from "../Core/Geometry.js";
import GeometryAttribute from "../Core/GeometryAttribute.js";
import GeometryAttributes from "../Core/GeometryAttributes.js";
import GeometryInstance from "../Core/GeometryInstance.js";
import Matrix3 from "../Core/Matrix3.js";
import PrimitiveType from "../Core/PrimitiveType.js";
import ContextLimits from "../Renderer/ContextLimits.js";
import IIIFImageSource from "./IIIFImageSource.js";
import Material from "./Material.js";
import MaterialAppearance from "./MaterialAppearance.js";
import Primitive from "./Primitive.js";

/**
 * Supported camera projection types for distortion models.
 * @enum {number}
 */
const ProjectionType = Object.freeze({
  /** Pinhole camera, no distortion. */
  PINHOLE: 0,
  /** Radial distortion with k1, k2 coefficients. */
  PERSPECTIVE_2: 1,
  /** Brown-Conrady model with k1, k2, k3, p1, p2. */
  BROWN_CONRADY: 2,
  /** Fisheye model with k1–k4. */
  FISHEYE: 3,
  /** Equirectangular (360°) projection. */
  EQUIRECTANGULAR: 4,
});

// Scratch variables for geometry construction
const scratchRayOrigin = new Cartesian3();
const scratchRayDir = new Cartesian3();
const scratchIntersection = new Cartesian3();
const scratchNormalized = new Cartesian2();

/**
 * A primitive that projects a camera image onto a plane in 3D space.
 *
 * Given a source camera's position, orientation, intrinsics, and an image,
 * this primitive constructs a subdivided mesh on the projection plane whose
 * UV coordinates map the image texture, accounting for lens distortion.
 *
 * Ported from scene-core's CameraProjector / CameraViewProjector system.
 *
 * @alias ProjectedImagePrimitive
 * @constructor
 *
 * @param {object} options Object with the following properties:
 * @param {Cartesian3} options.cameraPosition The world-space position of the source camera.
 * @param {Matrix3} options.cameraRotation The 3x3 rotation matrix from camera-local to world coordinates (columns = camera right, up, forward).
 * @param {string|HTMLImageElement|HTMLCanvasElement} options.image The image to project.
 * @param {number} options.imageWidth The width of the source image in pixels.
 * @param {number} options.imageHeight The height of the source image in pixels.
 * @param {number} options.fx Focal length in pixels along x-axis.
 * @param {number} options.fy Focal length in pixels along y-axis.
 * @param {number} options.cx Principal point x-coordinate in pixels.
 * @param {number} options.cy Principal point y-coordinate in pixels.
 * @param {number} [options.skew=0] Camera skew coefficient.
 * @param {number[]} [options.distortion] Distortion coefficients array. Length depends on projectionType.
 * @param {ProjectionType} [options.projectionType=ProjectionType.PINHOLE] Camera projection/distortion model.
 * @param {number} options.planeDistance Distance from the camera along its forward axis to the projection plane. The plane is always perpendicular to the camera's forward direction.
 * @param {number} [options.subdivisions] Number of horizontal subdivisions. Defaults based on distortion model.
 * @param {boolean} [options.show=true] Whether the primitive is visible.
 * @param {Color} [options.color=Color.WHITE] Tint color for the projected image.
 * @param {number} [options.alpha=1.0] Opacity of the projected image.
 * @param {object} [options.id] User-defined object returned on pick.
 *
 * @example
 * const projectedImage = new Cesium.ProjectedImagePrimitive({
 *   cameraPosition: cameraWorldPos,
 *   cameraRotation: cameraWorldRotation,
 *   image: 'photo.jpg',
 *   imageWidth: 4000,
 *   imageHeight: 3000,
 *   fx: 3500, fy: 3500,
 *   cx: 2000, cy: 1500,
 *   projectionType: Cesium.ProjectedImagePrimitive.ProjectionType.PINHOLE,
 *   planeDistance: 50.0,
 * });
 * scene.primitives.add(projectedImage);
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 */
function ProjectedImagePrimitive(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("options.cameraPosition", options.cameraPosition);
  Check.typeOf.object("options.cameraRotation", options.cameraRotation);
  Check.defined("options.image", options.image);
  Check.typeOf.number("options.imageWidth", options.imageWidth);
  Check.typeOf.number("options.imageHeight", options.imageHeight);
  Check.typeOf.number("options.fx", options.fx);
  Check.typeOf.number("options.fy", options.fy);
  Check.typeOf.number("options.cx", options.cx);
  Check.typeOf.number("options.cy", options.cy);
  Check.typeOf.number("options.planeDistance", options.planeDistance);
  //>>includeEnd('debug');

  // Camera extrinsics
  this._cameraPosition = Cartesian3.clone(options.cameraPosition);
  this._cameraRotation = Matrix3.clone(options.cameraRotation);

  // Camera intrinsics
  this._fx = options.fx;
  this._fy = options.fy;
  this._cx = options.cx;
  this._cy = options.cy;
  this._skew = options.skew ?? 0.0;
  this._imageWidth = options.imageWidth;
  this._imageHeight = options.imageHeight;
  this._distortion = options.distortion ?? [];
  this._projectionType = options.projectionType ?? ProjectionType.PINHOLE;

  // Projection plane: perpendicular to camera forward at the given distance
  this._planeDistance = options.planeDistance;

  // Subdivision
  this._subdivisions = options.subdivisions;

  // Display
  this._image = options.image;
  this._show = options.show ?? true;
  this._color = Color.clone(options.color ?? Color.WHITE);
  this._alpha = options.alpha ?? 1.0;
  this._id = options.id;

  // Internal state
  this._primitive = undefined;
  this._needsUpdate = true;
  this._boundingSphere = undefined;
  this._vertexPositions = undefined;
  this._vertexUVs = undefined;

  // IIIF LOD management (optional — only set when using IIIF tile server)
  this._iiifImageSource = options.iiifImageSource;
}

Object.defineProperties(ProjectedImagePrimitive.prototype, {
  /**
   * Whether this primitive is displayed.
   * @memberof ProjectedImagePrimitive.prototype
   * @type {boolean}
   */
  show: {
    get: function () {
      return this._show;
    },
    set: function (value) {
      this._show = value;
      if (defined(this._primitive)) {
        this._primitive.show = value;
      }
    },
  },
  /**
   * The user-defined object returned when the primitive is picked.
   * @memberof ProjectedImagePrimitive.prototype
   * @type {object}
   */
  id: {
    get: function () {
      return this._id;
    },
  },
});

/**
 * Enum for supported projection/distortion models.
 * @type {object}
 */
ProjectedImagePrimitive.ProjectionType = ProjectionType;

/**
 * Determines the number of subdivisions based on the distortion model.
 * More complex distortion requires more subdivisions to correctly warp the mesh.
 * @param {ProjectionType} projectionType
 * @param {number[]} distortion
 * @returns {number} Number of horizontal subdivisions.
 * @private
 */
function getDefaultSubdivisions(projectionType, distortion) {
  if (projectionType === ProjectionType.EQUIRECTANGULAR) {
    return 200;
  }
  const hasDistortion =
    Array.isArray(distortion) && distortion.some((c) => c !== 0);
  if (hasDistortion) {
    return 30;
  }
  return 1;
}

/**
 * Normalize a pixel coordinate to camera coordinates using the inverse of the intrinsic matrix K.
 * Computes K^{-1} * [u, v, 1]^T.
 *
 * @param {number} u Pixel x-coordinate.
 * @param {number} v Pixel y-coordinate.
 * @param {number} fx Focal length x.
 * @param {number} fy Focal length y.
 * @param {number} cx Principal point x.
 * @param {number} cy Principal point y.
 * @param {number} skew Skew coefficient.
 * @param {Cartesian2} result
 * @returns {Cartesian2} Normalized point (xn, yn).
 * @private
 */
function normalizePixel(u, v, fx, fy, cx, cy, skew, result) {
  const yn = (v - cy) / fy;
  const xn = (u - skew * yn - cx) / fx;
  result.x = xn;
  result.y = yn;
  return result;
}

/**
 * Iteratively undistort a normalized 2D point using the specified distortion model.
 * Uses fixed-point iteration (10 iterations) following the scene-core approach.
 *
 * @param {Cartesian2} point The distorted normalized point. Modified in-place.
 * @param {number[]} distortion Distortion coefficients.
 * @param {ProjectionType} projectionType The distortion model.
 * @returns {Cartesian2} The undistorted normalized point.
 * @private
 */
function undistortNormalizedPoint(point, distortion, projectionType) {
  if (
    !Array.isArray(distortion) ||
    distortion.length === 0 ||
    projectionType === ProjectionType.PINHOLE
  ) {
    return point;
  }

  const x0 = point.x;
  const y0 = point.y;
  let x = x0;
  let y = y0;
  const iterations = 10;

  if (projectionType === ProjectionType.PERSPECTIVE_2) {
    // Radial: k1, k2
    const k1 = distortion[0];
    const k2 = distortion[1];
    for (let i = 0; i < iterations; i++) {
      const r2 = x * x + y * y;
      const radial = 1.0 + k1 * r2 + k2 * r2 * r2;
      x = x0 / radial;
      y = y0 / radial;
    }
  } else if (projectionType === ProjectionType.BROWN_CONRADY) {
    // Brown-Conrady: k1, k2, k3, p1, p2
    const k1 = distortion[0];
    const k2 = distortion[1];
    const k3 = distortion[2];
    const p1 = distortion[3];
    const p2 = distortion[4];
    for (let i = 0; i < iterations; i++) {
      const r2 = x * x + y * y;
      const r4 = r2 * r2;
      const r6 = r4 * r2;
      const dx = 2.0 * p1 * x * y + p2 * (r2 + 2.0 * x * x);
      const dy = p1 * (r2 + 2.0 * y * y) + 2.0 * p2 * x * y;
      const radial = 1.0 + k1 * r2 + k2 * r4 + k3 * r6;
      x = (x0 - dx) / radial;
      y = (y0 - dy) / radial;
    }
  } else if (projectionType === ProjectionType.FISHEYE) {
    // Fisheye: k1, k2, k3, k4
    const k1 = distortion[0];
    const k2 = distortion[1];
    const k3 = distortion[2];
    const k4 = distortion[3];
    const thetaD = Math.sqrt(x0 * x0 + y0 * y0);
    if (thetaD > 1e-10) {
      let theta = thetaD;
      for (let i = 0; i < iterations; i++) {
        const t2 = theta * theta;
        const t4 = t2 * t2;
        const t6 = t4 * t2;
        const t8 = t4 * t4;
        theta = thetaD / (1.0 + k1 * t2 + k2 * t4 + k3 * t6 + k4 * t8);
      }
      const scale = Math.tan(theta) / thetaD;
      x = x0 * scale;
      y = y0 * scale;
    }
  }

  point.x = x;
  point.y = y;
  return point;
}

/**
 * Compute the ray direction for a given NDC coordinate, accounting for distortion.
 *
 * @param {number} ndcX NDC x-coordinate in [-1, 1].
 * @param {number} ndcY NDC y-coordinate in [-1, 1].
 * @param {object} intrinsics Camera intrinsic parameters.
 * @param {Cartesian3} result The resulting ray direction in camera-local space.
 * @returns {Cartesian3} The ray direction (normalized).
 * @private
 */
function getRayDirectionForNdc(ndcX, ndcY, intrinsics, result) {
  const {
    fx,
    fy,
    cx,
    cy,
    skew,
    imageWidth,
    imageHeight,
    distortion,
    projectionType,
  } = intrinsics;

  if (projectionType === ProjectionType.EQUIRECTANGULAR) {
    // NDC [-1,1] → spherical coordinates
    const theta = ndcX * -Math.PI; // longitude
    const phi = (ndcY / 2.0 + 0.5) * Math.PI; // latitude [0, PI]
    const sinPhi = Math.sin(phi);
    result.x = sinPhi * Math.sin(theta);
    result.y = -Math.cos(phi);
    result.z = sinPhi * Math.cos(theta);
    return Cartesian3.normalize(result, result);
  }

  // Convert NDC to image coordinates [0, 1]
  const imgX = (ndcX + 1.0) * 0.5;
  const imgY = (1.0 - ndcY) * 0.5;

  // Convert to pixel coordinates
  const pixelU = imgX * imageWidth;
  const pixelV = imgY * imageHeight;

  // Normalize: K^{-1} * [u, v, 1]^T
  normalizePixel(pixelU, pixelV, fx, fy, cx, cy, skew, scratchNormalized);

  // Undistort
  undistortNormalizedPoint(scratchNormalized, distortion, projectionType);

  // Ray direction in camera space: [xn, yn, 1] (camera looks along +Z)
  result.x = scratchNormalized.x;
  result.y = scratchNormalized.y;
  result.z = 1.0;
  return Cartesian3.normalize(result, result);
}

/**
 * Intersect a ray with a plane defined by a point and normal.
 * Returns the intersection point, or undefined if the ray is parallel to the plane.
 *
 * @param {Cartesian3} rayOrigin
 * @param {Cartesian3} rayDirection
 * @param {Cartesian3} planePoint
 * @param {Cartesian3} planeNormal
 * @param {Cartesian3} result
 * @returns {Cartesian3|undefined}
 * @private
 */
function rayPlaneIntersection(
  rayOrigin,
  rayDirection,
  planePoint,
  planeNormal,
  result,
) {
  const denom = Cartesian3.dot(rayDirection, planeNormal);
  if (Math.abs(denom) < 1e-12) {
    return undefined;
  }
  const diff = Cartesian3.subtract(planePoint, rayOrigin, result);
  const t = Cartesian3.dot(diff, planeNormal) / denom;
  if (t < 0) {
    // Intersection is behind the camera
    return undefined;
  }
  result.x = rayOrigin.x + rayDirection.x * t;
  result.y = rayOrigin.y + rayDirection.y * t;
  result.z = rayOrigin.z + rayDirection.z * t;
  return result;
}

/**
 * Build the subdivided mesh geometry for the projected image.
 *
 * The geometry is constructed in world coordinates. For each vertex on a
 * subdivided NDC grid, a ray is cast from the camera through the undistorted
 * direction, transformed to world space, and intersected with the projection
 * plane. The UV coordinates correspond to image coordinates [0,1].
 *
 * @param {ProjectedImagePrimitive} projectedImage
 * @returns {object} Object with geometry, modelMatrix, and boundingSphere.
 * @private
 */
function buildProjectionGeometry(projectedImage) {
  const subdivisions = defined(projectedImage._subdivisions)
    ? projectedImage._subdivisions
    : getDefaultSubdivisions(
        projectedImage._projectionType,
        projectedImage._distortion,
      );

  const aspect = projectedImage._imageWidth / projectedImage._imageHeight;
  const subdivX = subdivisions;
  const subdivY = Math.max(1, Math.round(subdivisions / aspect));

  const numVertsX = subdivX + 1;
  const numVertsY = subdivY + 1;
  const numVertices = numVertsX * numVertsY;
  const numTriangles = subdivX * subdivY * 2;

  const positions = new Float64Array(numVertices * 3);
  const normals = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);
  const indices =
    numVertices > 65535
      ? new Uint32Array(numTriangles * 3)
      : new Uint16Array(numTriangles * 3);

  const cameraPos = projectedImage._cameraPosition;
  const cameraRot = projectedImage._cameraRotation; // columns = right, up, forward (camera-to-world)
  const planeDistance = projectedImage._planeDistance;

  // Derive plane from camera: forward direction is column 2 of the rotation matrix
  const planeNormal = new Cartesian3(cameraRot[6], cameraRot[7], cameraRot[8]);
  Cartesian3.normalize(planeNormal, planeNormal);

  // Plane origin = camera position + planeDistance * forward
  const planeOrigin = new Cartesian3(
    cameraPos.x + planeNormal.x * planeDistance,
    cameraPos.y + planeNormal.y * planeDistance,
    cameraPos.z + planeNormal.z * planeDistance,
  );

  // Plane faces back toward the camera (normal = -forward)
  Cartesian3.negate(planeNormal, planeNormal);

  const intrinsics = {
    fx: projectedImage._fx,
    fy: projectedImage._fy,
    cx: projectedImage._cx,
    cy: projectedImage._cy,
    skew: projectedImage._skew,
    imageWidth: projectedImage._imageWidth,
    imageHeight: projectedImage._imageHeight,
    distortion: projectedImage._distortion,
    projectionType: projectedImage._projectionType,
  };

  // Generate vertices
  for (let iy = 0; iy < numVertsY; iy++) {
    for (let ix = 0; ix < numVertsX; ix++) {
      const vertIdx = iy * numVertsX + ix;

      // Image coordinate [0, 1]
      const imgU = ix / subdivX;
      const imgV = iy / subdivY;

      // NDC coordinate [-1, 1]
      const ndcX = imgU * 2.0 - 1.0;
      const ndcY = (1.0 - imgV) * 2.0 - 1.0;

      // Get ray direction in camera-local space
      getRayDirectionForNdc(ndcX, ndcY, intrinsics, scratchRayDir);

      // Transform ray direction from camera space to world space using rotation matrix
      // World direction = R * localDir
      const worldDirX =
        cameraRot[0] * scratchRayDir.x +
        cameraRot[3] * scratchRayDir.y +
        cameraRot[6] * scratchRayDir.z;
      const worldDirY =
        cameraRot[1] * scratchRayDir.x +
        cameraRot[4] * scratchRayDir.y +
        cameraRot[7] * scratchRayDir.z;
      const worldDirZ =
        cameraRot[2] * scratchRayDir.x +
        cameraRot[5] * scratchRayDir.y +
        cameraRot[8] * scratchRayDir.z;

      scratchRayOrigin.x = cameraPos.x;
      scratchRayOrigin.y = cameraPos.y;
      scratchRayOrigin.z = cameraPos.z;

      const worldDir = scratchRayDir;
      worldDir.x = worldDirX;
      worldDir.y = worldDirY;
      worldDir.z = worldDirZ;
      Cartesian3.normalize(worldDir, worldDir);

      let hitPoint;
      if (intrinsics.projectionType === ProjectionType.EQUIRECTANGULAR) {
        // For equirectangular, project outward a fixed distance (no plane intersection)
        hitPoint = scratchIntersection;
        hitPoint.x = cameraPos.x + worldDir.x * 10.0;
        hitPoint.y = cameraPos.y + worldDir.y * 10.0;
        hitPoint.z = cameraPos.z + worldDir.z * 10.0;
      } else {
        hitPoint = rayPlaneIntersection(
          scratchRayOrigin,
          worldDir,
          planeOrigin,
          planeNormal,
          scratchIntersection,
        );
      }

      if (defined(hitPoint)) {
        positions[vertIdx * 3] = hitPoint.x;
        positions[vertIdx * 3 + 1] = hitPoint.y;
        positions[vertIdx * 3 + 2] = hitPoint.z;
      } else {
        // Ray doesn't hit plane — place at camera position (degenerate)
        positions[vertIdx * 3] = cameraPos.x;
        positions[vertIdx * 3 + 1] = cameraPos.y;
        positions[vertIdx * 3 + 2] = cameraPos.z;
      }

      // Normal = plane normal for all vertices
      normals[vertIdx * 3] = planeNormal.x;
      normals[vertIdx * 3 + 1] = planeNormal.y;
      normals[vertIdx * 3 + 2] = planeNormal.z;

      // UV = image coordinate
      uvs[vertIdx * 2] = imgU;
      uvs[vertIdx * 2 + 1] = imgV;
    }
  }

  // Generate triangle indices
  let triIdx = 0;
  for (let iy = 0; iy < subdivY; iy++) {
    for (let ix = 0; ix < subdivX; ix++) {
      const bl = iy * numVertsX + ix;
      const br = bl + 1;
      const tl = bl + numVertsX;
      const tr = tl + 1;

      // Two triangles per quad (CCW winding)
      indices[triIdx++] = bl;
      indices[triIdx++] = br;
      indices[triIdx++] = tr;

      indices[triIdx++] = bl;
      indices[triIdx++] = tr;
      indices[triIdx++] = tl;
    }
  }

  const geometry = new Geometry({
    attributes: new GeometryAttributes({
      position: new GeometryAttribute({
        componentDatatype: ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      normal: new GeometryAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: normals,
      }),
      st: new GeometryAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: uvs,
      }),
    }),
    indices: indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(positions),
  });

  return geometry;
}

/**
 * Called each frame by the scene to update the primitive.
 *
 * @param {FrameState} frameState
 */
ProjectedImagePrimitive.prototype.update = function (frameState) {
  if (!this._show) {
    return;
  }

  if (this._needsUpdate) {
    // Destroy existing primitive if re-building
    if (defined(this._primitive)) {
      this._primitive.destroy();
      this._primitive = undefined;
    }

    const geometry = buildProjectionGeometry(this);
    this._boundingSphere = geometry.boundingSphere;
    this._vertexPositions = geometry.attributes.position.values;
    this._vertexUVs = geometry.attributes.st.values;

    const instance = new GeometryInstance({
      geometry: geometry,
      id: this._id,
    });

    const tintColor = new Color(
      this._color.red,
      this._color.green,
      this._color.blue,
      this._alpha,
    );

    const appearance = new MaterialAppearance({
      material: Material.fromType("ProjectedImage", {
        image: this._image,
        color: tintColor,
        uvOffset: new Cartesian2(0.0, 0.0),
        uvScale: new Cartesian2(1.0, 1.0),
      }),
      faceForward: true,
      flat: true, // no lighting — show original image colors
      translucent: this._alpha < 1.0,
      renderState: {
        polygonOffset: {
          enabled: true,
          factor: -1.0,
          units: -1.0,
        },
      },
    });

    this._primitive = new Primitive({
      geometryInstances: instance,
      appearance: appearance,
      asynchronous: false,
      allowPicking: defined(this._id),
    });

    this._needsUpdate = false;
  }

  // LOD management for IIIF images
  if (defined(this._iiifImageSource) && defined(this._boundingSphere)) {
    const iiif = this._iiifImageSource;
    const uniforms = this._primitive.appearance.material.uniforms;

    if (!iiif._maxTextureSizeSet) {
      iiif.setMaxTextureSize(ContextLimits.maximumTextureSize);
    }

    const screenPixels = IIIFImageSource.computeScreenPixels(
      frameState,
      this._boundingSphere,
    );

    const maxSrc = iiif._maxSourceDimension;
    const desiredLevel = iiif.computeDesiredLodLevel(screenPixels);

    if (iiif._fullImageLoaded || screenPixels <= maxSrc) {
      // Whole-image mode: use standard LOD levels
      if (iiif._regionMode) {
        // Switching back from region mode — reset UV transform
        iiif._regionMode = false;
        uniforms.uvOffset.x = 0.0;
        uniforms.uvOffset.y = 0.0;
        uniforms.uvScale.x = 1.0;
        uniforms.uvScale.y = 1.0;
      }

      if (desiredLevel !== iiif._currentLodLevel && isFinite(desiredLevel)) {
        iiif._currentLodLevel = desiredLevel;
        uniforms.image = iiif.getLodResource(desiredLevel);
      }
    } else if (defined(this._vertexPositions) && defined(this._vertexUVs)) {
      // Region mode: zoomed past full-res, full image not loaded
      const visibleRegion = iiif.computeVisibleRegion(
        frameState,
        this._vertexPositions,
        this._vertexUVs,
      );

      if (defined(visibleRegion) && iiif.needsRegionUpdate(visibleRegion)) {
        uniforms.image = iiif.getRegionResource(
          visibleRegion.x,
          visibleRegion.y,
          visibleRegion.w,
          visibleRegion.h,
        );
        uniforms.uvOffset.x = visibleRegion.uvOffset.x;
        uniforms.uvOffset.y = visibleRegion.uvOffset.y;
        uniforms.uvScale.x = visibleRegion.uvScale.x;
        uniforms.uvScale.y = visibleRegion.uvScale.y;
      }
    }
  }

  this._primitive.update(frameState);
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 * @returns {boolean}
 */
ProjectedImagePrimitive.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the WebGL resources held by this object.
 */
ProjectedImagePrimitive.prototype.destroy = function () {
  if (defined(this._primitive)) {
    this._primitive.destroy();
  }
  return destroyObject(this);
};

export default ProjectedImagePrimitive;
