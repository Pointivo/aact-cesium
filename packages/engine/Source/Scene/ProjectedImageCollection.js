import BillboardCollection from "./BillboardCollection.js";
import buildModuleUrl from "../Core/buildModuleUrl.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Check from "../Core/Check.js";
import Color from "../Core/Color.js";
import DebugCameraPrimitive from "./DebugCameraPrimitive.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Frozen from "../Core/Frozen.js";
import HorizontalOrigin from "./HorizontalOrigin.js";
import LabelCollection from "./LabelCollection.js";
import LabelStyle from "./LabelStyle.js";
import Matrix3 from "../Core/Matrix3.js";
import PerspectiveFrustum from "../Core/PerspectiveFrustum.js";
import PrimitiveCollection from "./PrimitiveCollection.js";
import ProjectedImagePrimitive from "./ProjectedImagePrimitive.js";
import Resource from "../Core/Resource.js";
import VerticalOrigin from "./VerticalOrigin.js";

const ProjectionType = ProjectedImagePrimitive.ProjectionType;

/**
 * A collection that manages multiple {@link ProjectedImagePrimitive} instances along
 * with camera icon billboards and optional frustum wireframes.
 *
 * Can be populated manually via {@link ProjectedImageCollection#add}, or from
 * a ccOrientations XML file via the static {@link ProjectedImageCollection.fromCCOrientationsXml}
 * method.
 *
 * Added to the scene as a primitive:
 * ```
 * scene.primitives.add(projectedImageCollection);
 * ```
 *
 * @alias ProjectedImageCollection
 * @constructor
 *
 * @param {object} [options] Object with the following properties:
 * @param {boolean} [options.show=true] Whether the collection is visible.
 * @param {boolean} [options.showFrustums=true] Whether to display camera frustum wireframes.
 * @param {boolean} [options.showCameraIcons=true] Whether to display camera icon billboards.
 * @param {boolean} [options.showLabels=false] Whether to display labels at camera positions.
 * @param {Color} [options.frustumColor=Color.YELLOW] Color for frustum wireframes.
 * @param {number} [options.defaultPlaneDistance=50.0] Default planeDistance when not specified per image.
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 */
function ProjectedImageCollection(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  this._primitiveCollection = new PrimitiveCollection();
  this._billboards = new BillboardCollection();
  this._labels = new LabelCollection();
  this._frustumCollection = new PrimitiveCollection();
  this._items = []; // array of { primitive, billboard, label, frustumPrimitive, options }

  this._primitiveCollection.add(this._billboards);
  this._primitiveCollection.add(this._labels);
  this._primitiveCollection.add(this._frustumCollection);

  this._show = options.show ?? true;
  this._showFrustums = options.showFrustums ?? true;
  this._showCameraIcons = options.showCameraIcons ?? true;
  this._showLabels = options.showLabels ?? false;
  this._frustumColor = Color.clone(options.frustumColor ?? Color.YELLOW);
  this._defaultPlaneDistance = options.defaultPlaneDistance ?? 50.0;

  this._cameraIconUrl = buildModuleUrl("Assets/Textures/maki/camera.png");
}

Object.defineProperties(ProjectedImageCollection.prototype, {
  /**
   * Gets the number of projected images in the collection.
   * @memberof ProjectedImageCollection.prototype
   * @type {number}
   * @readonly
   */
  length: {
    get: function () {
      return this._items.length;
    },
  },

  /**
   * Gets or sets visibility of the entire collection.
   * @memberof ProjectedImageCollection.prototype
   * @type {boolean}
   */
  show: {
    get: function () {
      return this._show;
    },
    set: function (value) {
      this._show = value;
      this._primitiveCollection.show = value;
    },
  },

  /**
   * Gets or sets whether frustum wireframes are shown.
   * @memberof ProjectedImageCollection.prototype
   * @type {boolean}
   */
  showFrustums: {
    get: function () {
      return this._showFrustums;
    },
    set: function (value) {
      this._showFrustums = value;
      this._frustumCollection.show = value;
    },
  },

  /**
   * Gets or sets whether camera icon billboards are shown.
   * @memberof ProjectedImageCollection.prototype
   * @type {boolean}
   */
  showCameraIcons: {
    get: function () {
      return this._showCameraIcons;
    },
    set: function (value) {
      this._showCameraIcons = value;
      this._billboards.show = value;
    },
  },

  /**
   * Gets or sets whether camera labels are shown.
   * @memberof ProjectedImageCollection.prototype
   * @type {boolean}
   */
  showLabels: {
    get: function () {
      return this._showLabels;
    },
    set: function (value) {
      this._showLabels = value;
      this._labels.show = value;
    },
  },
});

/**
 * Add a projected image to the collection.
 *
 * @param {object} options Object with the following properties:
 * @param {Cartesian3} options.cameraPosition Camera world-space position.
 * @param {Matrix3} options.cameraRotation Camera-to-world rotation matrix (columns = right, up, forward).
 * @param {string|HTMLImageElement|HTMLCanvasElement} options.image The image to project.
 * @param {number} options.imageWidth Image width in pixels.
 * @param {number} options.imageHeight Image height in pixels.
 * @param {number} options.fx Focal length x in pixels.
 * @param {number} options.fy Focal length y in pixels.
 * @param {number} options.cx Principal point x in pixels.
 * @param {number} options.cy Principal point y in pixels.
 * @param {number} [options.skew=0] Skew coefficient.
 * @param {number[]} [options.distortion] Distortion coefficients.
 * @param {ProjectionType} [options.projectionType=ProjectionType.PINHOLE] Distortion model.
 * @param {number} [options.planeDistance] Distance to the projection plane. Defaults to collection default.
 * @param {number} [options.alpha=1.0] Image opacity.
 * @param {string} [options.name] Display name for the camera label.
 * @param {object} [options.id] User-defined pick id.
 * @returns {object} An item handle with {primitive, billboard, label, frustumPrimitive}.
 */
ProjectedImageCollection.prototype.add = function (options) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("options", options);
  Check.typeOf.object("options.cameraPosition", options.cameraPosition);
  Check.typeOf.object("options.cameraRotation", options.cameraRotation);
  Check.defined("options.image", options.image);
  Check.typeOf.number("options.imageWidth", options.imageWidth);
  Check.typeOf.number("options.imageHeight", options.imageHeight);
  Check.typeOf.number("options.fx", options.fx);
  Check.typeOf.number("options.fy", options.fy);
  Check.typeOf.number("options.cx", options.cx);
  Check.typeOf.number("options.cy", options.cy);
  //>>includeEnd('debug');

  const planeDistance = options.planeDistance ?? this._defaultPlaneDistance;
  const projectionType = options.projectionType ?? ProjectionType.PINHOLE;

  // Create the projected image primitive
  const primitive = new ProjectedImagePrimitive({
    cameraPosition: options.cameraPosition,
    cameraRotation: options.cameraRotation,
    image: options.image,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
    fx: options.fx,
    fy: options.fy,
    cx: options.cx,
    cy: options.cy,
    skew: options.skew,
    distortion: options.distortion,
    projectionType: projectionType,
    planeDistance: planeDistance,
    alpha: options.alpha,
    id: options.id,
  });
  this._primitiveCollection.add(primitive);

  // Camera icon billboard — id is set to the item below after creation
  const billboard = this._billboards.add({
    position: options.cameraPosition,
    image: this._cameraIconUrl,
    width: 32,
    height: 32,
    verticalOrigin: VerticalOrigin.CENTER,
    horizontalOrigin: HorizontalOrigin.CENTER,
  });

  // Camera label
  const label = this._labels.add({
    position: options.cameraPosition,
    text: options.name ?? "",
    font: "12px sans-serif",
    style: LabelStyle.FILL_AND_OUTLINE,
    outlineWidth: 2,
    verticalOrigin: VerticalOrigin.BOTTOM,
    pixelOffset: { x: 0, y: -24 },
    show: this._showLabels && defined(options.name),
  });

  // Frustum wireframe
  const forward = new Cartesian3();
  Matrix3.getColumn(options.cameraRotation, 2, forward);
  const camUp = new Cartesian3();
  Matrix3.getColumn(options.cameraRotation, 1, camUp);
  const camRight = new Cartesian3();
  Matrix3.getColumn(options.cameraRotation, 0, camRight);

  const fovX = 2.0 * Math.atan(options.imageWidth / (2.0 * options.fx));
  const aspectRatio = options.imageWidth / options.imageHeight;
  const debugFrustum = new PerspectiveFrustum();
  debugFrustum.fov = fovX;
  debugFrustum.aspectRatio = aspectRatio;
  debugFrustum.near = 1.0;
  debugFrustum.far = planeDistance;

  const cameraProxy = {
    positionWC: Cartesian3.clone(options.cameraPosition),
    directionWC: forward,
    upWC: camUp,
    rightWC: camRight,
    frustum: debugFrustum,
  };

  const frustumPrimitive = new DebugCameraPrimitive({
    camera: cameraProxy,
    color: this._frustumColor,
    updateOnChange: false,
  });
  this._frustumCollection.add(frustumPrimitive);

  const item = {
    primitive: primitive,
    billboard: billboard,
    label: label,
    frustumPrimitive: frustumPrimitive,
    cameraPosition: Cartesian3.clone(options.cameraPosition),
    cameraDirection: Cartesian3.clone(forward),
    cameraUp: Cartesian3.clone(camUp),
    cameraRight: Cartesian3.clone(camRight),
    show: true,
    options: options,
  };

  // Set billboard id to the item so it can be picked and traced back
  billboard.id = item;

  this._items.push(item);

  return item;
};

/**
 * Remove a projected image item from the collection.
 * @param {object} item The item handle returned by {@link ProjectedImageCollection#add}.
 * @returns {boolean} true if the item was found and removed.
 */
ProjectedImageCollection.prototype.remove = function (item) {
  const index = this._items.indexOf(item);
  if (index === -1) {
    return false;
  }

  this._primitiveCollection.remove(item.primitive);
  this._billboards.remove(item.billboard);
  this._labels.remove(item.label);
  if (defined(item.frustumPrimitive)) {
    this._frustumCollection.remove(item.frustumPrimitive);
  }

  this._items.splice(index, 1);
  return true;
};

/**
 * Remove all projected images from the collection.
 */
ProjectedImageCollection.prototype.removeAll = function () {
  for (let i = this._items.length - 1; i >= 0; i--) {
    this.remove(this._items[i]);
  }
};

/**
 * Show or hide an individual projected image item.
 *
 * @param {object} item The item handle returned by {@link ProjectedImageCollection#add}.
 * @param {boolean} visible Whether the item should be visible.
 */
ProjectedImageCollection.prototype.setItemShow = function (item, visible) {
  item.show = visible;
  item.primitive.show = visible;
  item.billboard.show = visible && this._showCameraIcons;
  item.label.show = visible && this._showLabels && item.label.text !== "";
  if (defined(item.frustumPrimitive)) {
    item.frustumPrimitive.show = visible && this._showFrustums;
  }
};

/**
 * Get the projected image item at the given index.
 * @param {number} index Zero-based index.
 * @returns {object} The item handle.
 */
ProjectedImageCollection.prototype.get = function (index) {
  return this._items[index];
};

/**
 * Find the collection item associated with a pick result.
 * Works for billboards, labels, or any picked object whose id is an item.
 *
 * @param {object} pickedObject The object returned by scene.pick().
 * @returns {object|undefined} The item handle, or undefined if not from this collection.
 */
ProjectedImageCollection.prototype.getItemFromPick = function (pickedObject) {
  if (!defined(pickedObject) || !defined(pickedObject.id)) {
    return undefined;
  }
  const candidate = pickedObject.id;
  if (this._items.indexOf(candidate) !== -1) {
    return candidate;
  }
  return undefined;
};

/**
 * @private
 */
ProjectedImageCollection.prototype.update = function (frameState) {
  if (!this._show) {
    return;
  }
  this._primitiveCollection.update(frameState);
};

/**
 * Returns true if this object was destroyed.
 * @returns {boolean}
 */
ProjectedImageCollection.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroy this collection and all resources.
 */
ProjectedImageCollection.prototype.destroy = function () {
  this._primitiveCollection.destroy();
  return destroyObject(this);
};

// ---------------------------------------------------------------------------
// View scoring
// ---------------------------------------------------------------------------

const scratchToCamera = new Cartesian3();

/**
 * Compute a 0–1 score indicating how well a projected image item matches
 * the current viewer camera. Higher scores mean better alignment.
 *
 * The score combines:
 * - **Alignment** (dot product of viewer direction and source camera direction)
 * - **Distance** (inverse distance from viewer to source camera position)
 *
 * @param {object} item An item from the collection.
 * @param {Camera} viewerCamera The viewer's camera (e.g. `viewer.camera`).
 * @param {object} [weights] Scoring weights.
 * @param {number} [weights.alignment=0.7] Weight for directional alignment (0–1).
 * @param {number} [weights.distance=0.3] Weight for proximity (0–1).
 * @returns {number} Score in approximately [0, 1]. Higher is better.
 */
ProjectedImageCollection.computeViewScore = function (
  item,
  viewerCamera,
  weights,
) {
  const wAlign = (weights && weights.alignment) ?? 0.7;
  const wDist = (weights && weights.distance) ?? 0.3;

  // Alignment: dot product of viewer direction and source camera direction
  // Both are unit vectors; dot ranges from -1 (opposite) to +1 (same direction)
  const viewerDir = viewerCamera.directionWC;
  const camDir = item.cameraDirection;
  const dot = Cartesian3.dot(viewerDir, camDir);
  // Remap [-1, 1] → [0, 1]
  const alignmentScore = (dot + 1.0) * 0.5;

  // Distance: inverse distance, normalized by a reference distance
  Cartesian3.subtract(
    item.cameraPosition,
    viewerCamera.positionWC,
    scratchToCamera,
  );
  const dist = Cartesian3.magnitude(scratchToCamera);
  // Use a smooth falloff: score = 1 / (1 + dist/refDist)
  // refDist is the planeDistance as a reasonable scale reference
  const refDist = item.options.planeDistance ?? 50.0;
  const distanceScore = refDist / (refDist + dist);

  return wAlign * alignmentScore + wDist * distanceScore;
};

// ---------------------------------------------------------------------------
// ccOrientations XML parsing
// ---------------------------------------------------------------------------

/**
 * Parse a ccOrientations XML string and populate a ProjectedImageCollection.
 *
 * @param {string} xmlString The ccOrientations XML content.
 * @param {object} options Object with the following properties:
 * @param {Function} options.resolveImageUrl A function that receives an ImagePath string
 *   and returns a URL (string) or Promise&lt;string&gt; for the image resource.
 * @param {number} [options.defaultPlaneDistance=50.0] Default projection plane distance.
 * @param {boolean} [options.showFrustums=true] Show frustum wireframes.
 * @param {boolean} [options.showCameraIcons=true] Show camera icons.
 * @param {boolean} [options.showLabels=false] Show camera labels.
 * @param {Color} [options.frustumColor=Color.YELLOW] Frustum wireframe color.
 * @param {number} [options.alpha=1.0] Default image alpha.
 * @returns {Promise<ProjectedImageCollection>}
 */
ProjectedImageCollection.fromCCOrientationsXml = async function (
  xmlString,
  options,
) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("xmlString", xmlString);
  Check.typeOf.object("options", options);
  Check.typeOf.func("options.resolveImageUrl", options.resolveImageUrl);
  //>>includeEnd('debug');

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const collection = new ProjectedImageCollection({
    defaultPlaneDistance: options.defaultPlaneDistance ?? 50.0,
    showFrustums: options.showFrustums,
    showCameraIcons: options.showCameraIcons,
    showLabels: options.showLabels,
    frustumColor: options.frustumColor,
  });

  const blocks = doc.querySelectorAll("Block");
  for (const block of blocks) {
    const photogroups = block.querySelectorAll("Photogroup");
    for (const photogroup of photogroups) {
      const pgParams = parsePhotogroupIntrinsics(photogroup);
      const photos = photogroup.querySelectorAll("Photo");

      for (const photo of photos) {
        const pose = photo.querySelector("Pose");
        if (!pose) {
          continue; // Skip photos without pose data
        }

        const rotation = pose.querySelector("Rotation");
        const center = pose.querySelector("Center");
        if (!rotation || !center) {
          continue;
        }

        // Parse pose
        const worldToCamera = parseRotationMatrix(rotation);
        // ccOrientations stores world→camera; we need camera→world (transpose)
        const cameraToWorld = Matrix3.transpose(worldToCamera, new Matrix3());

        // Handle CameraOrientation convention
        // Default is XRightYDown: camera X = right, Y = down
        // Our convention: columns = [right, up, forward]
        // For XRightYDown: right = col0, up = -col1, forward = col2
        const cameraOrientation = getTextContent(
          photogroup,
          "CameraOrientation",
          "XRightYDown",
        );
        adjustRotationForCameraOrientation(cameraToWorld, cameraOrientation);

        const cx = parseFloat(getTextContent(center, "x", "0"));
        const cy = parseFloat(getTextContent(center, "y", "0"));
        const cz = parseFloat(getTextContent(center, "z", "0"));
        const cameraPosition = new Cartesian3(cx, cy, cz);

        // Compute focal length in pixels
        const fxPx = pgParams.focalLengthPx;
        const fyPx = pgParams.focalLengthPx;
        const ppX = pgParams.principalPointX;
        const ppY = pgParams.principalPointY;

        // Resolve image URL
        const imagePath = getTextContent(photo, "ImagePath", "");
        const photoId = getTextContent(photo, "Id", "");
        let imageUrl;
        try {
          imageUrl = await options.resolveImageUrl(imagePath);
        } catch {
          continue; // Skip photos whose images can't be resolved
        }

        // Debug: log the first image path and URL
        if (collection._items.length === 0) {
          console.log("First ImagePath from XML:", imagePath);
          console.log("Resolved image URL:", imageUrl);
        }

        const planeDistance =
          options.defaultPlaneDistance ?? collection._defaultPlaneDistance;

        collection.add({
          cameraPosition: cameraPosition,
          cameraRotation: cameraToWorld,
          image: imageUrl,
          imageWidth: pgParams.imageWidth,
          imageHeight: pgParams.imageHeight,
          fx: fxPx,
          fy: fyPx,
          cx: ppX,
          cy: ppY,
          distortion: pgParams.distortion,
          projectionType: pgParams.projectionType,
          planeDistance: planeDistance,
          alpha: options.alpha ?? 1.0,
          name: `Photo ${photoId}`,
          id: `photo-${photoId}`,
        });
      }
    }
  }

  return collection;
};

// ---------------------------------------------------------------------------
// Internal XML helpers
// ---------------------------------------------------------------------------

function getTextContent(parent, tagName, defaultValue) {
  const el = parent.querySelector(tagName);
  if (el && el.textContent) {
    return el.textContent.trim();
  }
  return defaultValue;
}

function parseFloatTag(parent, tagName, defaultValue) {
  const text = getTextContent(parent, tagName, null);
  if (text === null) {
    return defaultValue;
  }
  return parseFloat(text);
}

function parseRotationMatrix(rotationEl) {
  const m00 = parseFloatTag(rotationEl, "M_00", 1);
  const m01 = parseFloatTag(rotationEl, "M_01", 0);
  const m02 = parseFloatTag(rotationEl, "M_02", 0);
  const m10 = parseFloatTag(rotationEl, "M_10", 0);
  const m11 = parseFloatTag(rotationEl, "M_11", 1);
  const m12 = parseFloatTag(rotationEl, "M_12", 0);
  const m20 = parseFloatTag(rotationEl, "M_20", 0);
  const m21 = parseFloatTag(rotationEl, "M_21", 0);
  const m22 = parseFloatTag(rotationEl, "M_22", 1);

  // Matrix3 is column-major: [col0.x, col0.y, col0.z, col1.x, ...]
  // The XML M_ij = row i, column j, so we need to transpose for column-major
  return new Matrix3(m00, m01, m02, m10, m11, m12, m20, m21, m22);
}

function parsePhotogroupIntrinsics(photogroup) {
  const imageDimEl = photogroup.querySelector("ImageDimensions");
  const imageWidth = imageDimEl
    ? parseInt(getTextContent(imageDimEl, "Width", "1"), 10)
    : 1;
  const imageHeight = imageDimEl
    ? parseInt(getTextContent(imageDimEl, "Height", "1"), 10)
    : 1;

  const focalLengthMm = parseFloatTag(photogroup, "FocalLength", 50);
  const sensorSizeMm = parseFloatTag(photogroup, "SensorSize", 36);

  // Focal length in pixels = FocalLength_mm * max(W, H) / SensorSize_mm
  const largestDim = Math.max(imageWidth, imageHeight);
  const focalLengthPx = (focalLengthMm / sensorSizeMm) * largestDim;

  // Principal point (defaults to image center)
  let principalPointX = imageWidth / 2;
  let principalPointY = imageHeight / 2;
  const ppEl = photogroup.querySelector("PrincipalPoint");
  if (ppEl) {
    principalPointX = parseFloatTag(ppEl, "x", principalPointX);
    principalPointY = parseFloatTag(ppEl, "y", principalPointY);
  }

  // Distortion (Brown's model by default)
  let distortion = [];
  let projectionType = ProjectionType.PINHOLE;

  const cameraModelType = getTextContent(
    photogroup,
    "CameraModelType",
    "Perspective",
  );
  const distortionEl = photogroup.querySelector("Distortion");

  if (cameraModelType === "Fisheye") {
    projectionType = ProjectionType.FISHEYE;
    const fisheyeDistEl = photogroup.querySelector("FisheyeDistortion");
    if (fisheyeDistEl) {
      distortion = [
        parseFloatTag(fisheyeDistEl, "P0", 0),
        parseFloatTag(fisheyeDistEl, "P1", 0),
        parseFloatTag(fisheyeDistEl, "P2", 0),
        parseFloatTag(fisheyeDistEl, "P3", 0),
      ];
    }
  } else if (distortionEl) {
    const k1 = parseFloatTag(distortionEl, "K1", 0);
    const k2 = parseFloatTag(distortionEl, "K2", 0);
    const k3 = parseFloatTag(distortionEl, "K3", 0);
    const p1 = parseFloatTag(distortionEl, "P1", 0);
    const p2 = parseFloatTag(distortionEl, "P2", 0);

    if (k1 !== 0 || k2 !== 0 || k3 !== 0 || p1 !== 0 || p2 !== 0) {
      if (p1 !== 0 || p2 !== 0 || k3 !== 0) {
        projectionType = ProjectionType.BROWN_CONRADY;
        distortion = [k1, k2, k3, p1, p2];
      } else {
        projectionType = ProjectionType.PERSPECTIVE_2;
        distortion = [k1, k2];
      }
    }
  }

  return {
    imageWidth: imageWidth,
    imageHeight: imageHeight,
    focalLengthPx: focalLengthPx,
    principalPointX: principalPointX,
    principalPointY: principalPointY,
    distortion: distortion,
    projectionType: projectionType,
  };
}

/**
 * Adjust the camera-to-world rotation matrix based on the CameraOrientation convention.
 * Our internal convention uses columns = [right, up, forward].
 * ccOrientations default is XRightYDown where camera X=right, Y=down, Z=forward.
 * We need to negate the Y column (up = -down) to get our convention.
 *
 * @param {Matrix3} cameraToWorld The camera-to-world rotation to modify in place.
 * @param {string} orientation The CameraOrientation string from ccOrientations.
 * @private
 */
function adjustRotationForCameraOrientation(cameraToWorld, orientation) {
  // For XRightYDown (default): column 0 = right, column 1 = down, column 2 = forward
  // We need column 1 = up (= -down), so negate column 1
  if (
    orientation === "XRightYDown" ||
    !defined(orientation) ||
    orientation === ""
  ) {
    // Negate column 1 (indices 3, 4, 5 in column-major)
    cameraToWorld[3] = -cameraToWorld[3];
    cameraToWorld[4] = -cameraToWorld[4];
    cameraToWorld[5] = -cameraToWorld[5];
  }
  // XRightYUp: column 0 = right, column 1 = up, column 2 = -forward
  // Negate column 2 to get forward
  else if (orientation === "XRightYUp") {
    cameraToWorld[6] = -cameraToWorld[6];
    cameraToWorld[7] = -cameraToWorld[7];
    cameraToWorld[8] = -cameraToWorld[8];
  }
  // XLeftYDown: column 0 = -right, column 1 = down, column 2 = forward
  // Negate col 0 and col 1
  else if (orientation === "XLeftYDown") {
    cameraToWorld[0] = -cameraToWorld[0];
    cameraToWorld[1] = -cameraToWorld[1];
    cameraToWorld[2] = -cameraToWorld[2];
    cameraToWorld[3] = -cameraToWorld[3];
    cameraToWorld[4] = -cameraToWorld[4];
    cameraToWorld[5] = -cameraToWorld[5];
  }
  // XLeftYUp: column 0 = -right, column 1 = up, column 2 = -forward
  // Negate col 0 and col 2
  else if (orientation === "XLeftYUp") {
    cameraToWorld[0] = -cameraToWorld[0];
    cameraToWorld[1] = -cameraToWorld[1];
    cameraToWorld[2] = -cameraToWorld[2];
    cameraToWorld[6] = -cameraToWorld[6];
    cameraToWorld[7] = -cameraToWorld[7];
    cameraToWorld[8] = -cameraToWorld[8];
  }
  // Other orientations (XDownYRight, etc.) are rare — skip for now
}

/**
 * Load a ccOrientations XML file from a URL and create a ProjectedImageCollection.
 *
 * @param {string|Resource} url URL to the ccOrientations XML file.
 * @param {object} options Options passed to {@link ProjectedImageCollection.fromCCOrientationsXml}.
 * @returns {Promise<ProjectedImageCollection>}
 */
ProjectedImageCollection.fromCCOrientationsUrl = async function (url, options) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("url", url);
  Check.typeOf.object("options", options);
  //>>includeEnd('debug');

  const resource = url instanceof Resource ? url : new Resource({ url: url });
  const xmlString = await resource.fetchText();
  return ProjectedImageCollection.fromCCOrientationsXml(xmlString, options);
};

export default ProjectedImageCollection;
