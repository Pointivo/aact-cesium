import Cartesian3 from "../Core/Cartesian3.js";
import Color from "../Core/Color.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Event from "../Core/Event.js";
import ScreenSpaceEventHandler from "../Core/ScreenSpaceEventHandler.js";
import ScreenSpaceEventType from "../Core/ScreenSpaceEventType.js";
import HeightReference from "../Scene/HeightReference.js";

/**
 * @typedef {object} PointToolOptions
 * @property {import('../Scene/Scene.js').default} scene The scene.
 * @property {import('../DataSources/EntityCollection.js').default} entities The entity collection to add points to.
 * @property {boolean} [clampToGround=true] Whether placed points should clamp to terrain.
 * @property {Color} [color=Color.YELLOW] Color for placed points.
 * @property {number} [pixelSize=12] Pixel size for placed points.
 * @property {Color} [outlineColor=Color.BLACK] Outline color for placed points.
 * @property {number} [outlineWidth=1] Outline width for placed points.
 */

/**
 * Internal tool that handles single-click point placement.
 *
 * @alias PointTool
 * @constructor
 * @private
 *
 * @param {PointToolOptions} options
 */
function PointTool(options) {
  this._scene = options.scene;
  this._entities = options.entities;
  this._clampToGround = options.clampToGround !== false;
  this._color = options.color ?? Color.YELLOW;
  this._pixelSize = options.pixelSize ?? 12;
  this._outlineColor = options.outlineColor ?? Color.BLACK;
  this._outlineWidth = options.outlineWidth ?? 1;

  this._handler = undefined;

  this._pointPlaced = new Event();
}

Object.defineProperties(PointTool.prototype, {
  /**
   * Event raised when a point is placed. Callback receives (entity, position).
   * @memberof PointTool.prototype
   * @type {Event}
   * @readonly
   */
  pointPlaced: {
    get: function () {
      return this._pointPlaced;
    },
  },

  /**
   * Whether the point tool is currently active.
   * @memberof PointTool.prototype
   * @type {boolean}
   * @readonly
   */
  isActive: {
    get: function () {
      return defined(this._handler);
    },
  },
});

/**
 * Picks a position on the globe or 3D content from a screen coordinate.
 * @private
 */
PointTool.prototype._pickPosition = function (windowPosition) {
  const scene = this._scene;

  const pickedObject = scene.pick(windowPosition);
  const isEditorEntity =
    defined(pickedObject) &&
    defined(pickedObject.id) &&
    (pickedObject.id._isEditorVertex ||
      pickedObject.id._isEditorPreview ||
      pickedObject.id._isEditorHandle);
  const isSceneContent = defined(pickedObject) && !isEditorEntity;

  if (isSceneContent && scene.pickPositionSupported) {
    const picked = scene.pickPosition(windowPosition);
    if (defined(picked)) {
      return picked;
    }
  }

  const ray = scene.camera.getPickRay(windowPosition);
  if (defined(ray)) {
    const globePosition = scene.globe.pick(ray, scene);
    if (defined(globePosition)) {
      return globePosition;
    }
  }

  return undefined;
};

/**
 * Starts the point placement tool. Each click places a point.
 */
PointTool.prototype.activate = function () {
  if (this.isActive) {
    this.deactivate();
  }

  const handler = new ScreenSpaceEventHandler(this._scene.canvas);
  this._handler = handler;

  const self = this;

  handler.setInputAction(function (event) {
    const position = self._pickPosition(event.position);
    if (!defined(position)) {
      return;
    }

    const clonedPosition = Cartesian3.clone(position);
    const entity = self._entities.add({
      position: clonedPosition,
      point: {
        color: self._color,
        pixelSize: self._pixelSize,
        outlineColor: self._outlineColor,
        outlineWidth: self._outlineWidth,
        heightReference: self._clampToGround
          ? HeightReference.CLAMP_TO_GROUND
          : HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      _editorPositions: [clonedPosition],
      _editorType: "point",
    });

    self._pointPlaced.raiseEvent(entity, clonedPosition);
  }, ScreenSpaceEventType.LEFT_CLICK);
};

/**
 * Deactivates the point placement tool.
 */
PointTool.prototype.deactivate = function () {
  if (defined(this._handler)) {
    this._handler.destroy();
    this._handler = undefined;
  }
};

PointTool.prototype.isDestroyed = function () {
  return false;
};

PointTool.prototype.destroy = function () {
  this.deactivate();
  return destroyObject(this);
};

export default PointTool;
