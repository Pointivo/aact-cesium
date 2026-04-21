import Cartesian3 from "../Core/Cartesian3.js";
import Color from "../Core/Color.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Event from "../Core/Event.js";
import ScreenSpaceEventHandler from "../Core/ScreenSpaceEventHandler.js";
import ScreenSpaceEventType from "../Core/ScreenSpaceEventType.js";
import CallbackProperty from "../DataSources/CallbackProperty.js";
import ConstantProperty from "../DataSources/ConstantProperty.js";
import PolygonHierarchy from "../Core/PolygonHierarchy.js";
import HeightReference from "../Scene/HeightReference.js";

/**
 * @typedef {object} DrawToolOptions
 * @property {import('../Scene/Scene.js').default} scene The scene.
 * @property {import('../DataSources/EntityCollection.js').default} entities The entity collection to add drawn shapes to.
 * @property {boolean} [clampToGround=true] Whether drawn shapes should be clamped to terrain.
 * @property {Color} [vertexColor=Color.WHITE] Color for vertex point markers.
 * @property {number} [vertexPixelSize=8] Pixel size for vertex point markers.
 * @property {Color} [edgeColor=Color.YELLOW] Color for polyline edges.
 * @property {number} [edgeWidth=3] Width for polyline edges.
 * @property {Color} [fillColor] Fill color for polygons.
 */

/**
 * Internal tool that handles click-to-place vertex drawing for polylines and polygons.
 *
 * @alias DrawTool
 * @constructor
 * @private
 *
 * @param {DrawToolOptions} options
 */
function DrawTool(options) {
  this._scene = options.scene;
  this._entities = options.entities;
  this._clampToGround = options.clampToGround !== false;
  this._vertexColor = options.vertexColor ?? Color.WHITE;
  this._vertexPixelSize = options.vertexPixelSize ?? 8;
  this._edgeColor = options.edgeColor ?? Color.YELLOW;
  this._edgeWidth = options.edgeWidth ?? 3;
  this._fillColor = options.fillColor ?? Color.WHITE.withAlpha(0.3);

  this._handler = undefined;
  this._activePositions = [];
  this._vertexEntities = [];
  this._activeShapeEntity = undefined;
  this._floatingVertex = undefined;
  this._drawingType = undefined; // 'polygon' or 'polyline'

  this._drawComplete = new Event();
  this._drawCancelled = new Event();
}

Object.defineProperties(DrawTool.prototype, {
  /**
   * Event raised when drawing is completed. The callback receives the finalized entity and the array of positions.
   * @memberof DrawTool.prototype
   * @type {Event}
   * @readonly
   */
  drawComplete: {
    get: function () {
      return this._drawComplete;
    },
  },

  /**
   * Event raised when drawing is cancelled.
   * @memberof DrawTool.prototype
   * @type {Event}
   * @readonly
   */
  drawCancelled: {
    get: function () {
      return this._drawCancelled;
    },
  },

  /**
   * Whether a draw operation is currently active.
   * @memberof DrawTool.prototype
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
 * Picks a position on the globe from a screen coordinate.
 * @private
 * @param {Cartesian2} windowPosition
 * @returns {Cartesian3|undefined}
 */
DrawTool.prototype._pickPosition = function (windowPosition) {
  const scene = this._scene;

  // Check what object is under the cursor.
  const pickedObject = scene.pick(windowPosition);
  const isEditorEntity =
    defined(pickedObject) &&
    defined(pickedObject.id) &&
    (pickedObject.id._isEditorVertex ||
      pickedObject.id._isEditorPreview ||
      pickedObject.id._isEditorHandle);
  const isSceneContent = defined(pickedObject) && !isEditorEntity;

  // For 3D Tiles, models, point clouds — use pickPosition to get the
  // surface position. Skip this when hovering over editor entities
  // to avoid depth-buffer jitter from our own preview geometry.
  if (isSceneContent && scene.pickPositionSupported) {
    const picked = scene.pickPosition(windowPosition);
    if (defined(picked)) {
      return picked;
    }
  }

  // For terrain or when over editor entities, use globe.pick
  // (ray-ellipsoid/terrain intersection in float64).
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
 * Creates a vertex marker point entity.
 * @private
 * @param {Cartesian3} position
 * @returns {Entity}
 */
DrawTool.prototype._createVertexEntity = function (position) {
  return this._entities.add({
    position: position,
    point: {
      color: this._vertexColor,
      pixelSize: this._vertexPixelSize,
      outlineColor: Color.BLACK,
      outlineWidth: 1,
      heightReference: this._clampToGround
        ? HeightReference.CLAMP_TO_GROUND
        : HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    _isEditorVertex: true,
  });
};

/**
 * Creates the live preview shape entity using CallbackProperty.
 * @private
 */
DrawTool.prototype._createActiveShape = function () {
  const positions = this._activePositions;
  const drawingType = this._drawingType;
  const clampToGround = this._clampToGround;

  if (drawingType === "polygon") {
    this._activeShapeEntity = this._entities.add({
      polygon: {
        hierarchy: new CallbackProperty(function () {
          return new PolygonHierarchy(positions);
        }, false),
        material: this._fillColor,
        heightReference: clampToGround
          ? HeightReference.CLAMP_TO_GROUND
          : HeightReference.NONE,
      },
      _isEditorPreview: true,
    });
  } else {
    this._activeShapeEntity = this._entities.add({
      polyline: {
        positions: new CallbackProperty(function () {
          return positions;
        }, false),
        clampToGround: clampToGround,
        width: this._edgeWidth,
        material: this._edgeColor,
      },
      _isEditorPreview: true,
    });
  }
};

/**
 * Starts a drawing session.
 * @param {string} type Either 'polygon' or 'polyline'.
 */
DrawTool.prototype.activate = function (type) {
  if (this.isActive) {
    this.cancel();
  }

  this._drawingType = type;
  this._activePositions = [];
  this._vertexEntities = [];

  const handler = new ScreenSpaceEventHandler(this._scene.canvas);
  this._handler = handler;

  const self = this;

  // Track mouse button state so we skip floating vertex updates
  // during camera drag (orbit/pan).
  let isMouseDown = false;

  handler.setInputAction(function () {
    isMouseDown = true;
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction(function () {
    isMouseDown = false;
  }, ScreenSpaceEventType.LEFT_UP);

  // LEFT_CLICK: add a vertex
  handler.setInputAction(function (event) {
    const position = self._pickPosition(event.position);
    if (!defined(position)) {
      return;
    }

    if (self._activePositions.length === 0) {
      // First click — create floating vertex and preview shape
      self._floatingVertex = self._createVertexEntity(position);
      self._activePositions.push(position);
      self._createActiveShape();
    }

    self._activePositions.push(position);
    self._vertexEntities.push(self._createVertexEntity(position));
  }, ScreenSpaceEventType.LEFT_CLICK);

  // MOUSE_MOVE: update floating vertex position
  handler.setInputAction(function (event) {
    if (!defined(self._floatingVertex)) {
      return;
    }

    // Skip updates while the user is dragging to control the camera
    if (isMouseDown) {
      return;
    }

    const newPosition = self._pickPosition(event.endPosition);
    if (defined(newPosition)) {
      self._floatingVertex.position = new ConstantProperty(newPosition);
      // Replace the last (floating) position
      self._activePositions.pop();
      self._activePositions.push(newPosition);
    }
  }, ScreenSpaceEventType.MOUSE_MOVE);

  // RIGHT_CLICK: finish drawing
  handler.setInputAction(function () {
    self._finishDrawing();
  }, ScreenSpaceEventType.RIGHT_CLICK);

  // Double click also finishes
  handler.setInputAction(function () {
    self._finishDrawing();
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
};

/**
 * Finishes the current draw operation, creates the final entity.
 * @private
 */
DrawTool.prototype._finishDrawing = function () {
  // Remove the floating point from positions
  this._activePositions.pop();

  const positions = this._activePositions;
  const minVertices = this._drawingType === "polygon" ? 3 : 2;

  if (positions.length < minVertices) {
    this.cancel();
    return;
  }

  // Clone the final positions
  const finalPositions = positions.map(function (p) {
    return Cartesian3.clone(p);
  });

  // Remove preview entities
  this._cleanupPreview();

  // Create the final entity
  let finalEntity;
  if (this._drawingType === "polygon") {
    finalEntity = this._entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy(finalPositions),
        material: this._fillColor,
        outline: true,
        outlineColor: this._edgeColor,
        outlineWidth: 1,
        heightReference: this._clampToGround
          ? HeightReference.CLAMP_TO_GROUND
          : HeightReference.NONE,
      },
      _editorPositions: finalPositions,
    });
  } else {
    finalEntity = this._entities.add({
      polyline: {
        positions: finalPositions,
        clampToGround: this._clampToGround,
        width: this._edgeWidth,
        material: this._edgeColor,
      },
      _editorPositions: finalPositions,
    });
  }

  this._deactivateHandler();
  this._drawComplete.raiseEvent(finalEntity, finalPositions);
};

/**
 * Cancels the current drawing operation.
 */
DrawTool.prototype.cancel = function () {
  this._cleanupPreview();
  this._deactivateHandler();
  this._drawCancelled.raiseEvent();
};

/**
 * Removes all preview/temporary entities.
 * @private
 */
DrawTool.prototype._cleanupPreview = function () {
  const entities = this._entities;

  if (defined(this._floatingVertex)) {
    entities.remove(this._floatingVertex);
    this._floatingVertex = undefined;
  }

  if (defined(this._activeShapeEntity)) {
    entities.remove(this._activeShapeEntity);
    this._activeShapeEntity = undefined;
  }

  for (let i = 0; i < this._vertexEntities.length; i++) {
    entities.remove(this._vertexEntities[i]);
  }
  this._vertexEntities = [];
  this._activePositions = [];
};

/**
 * Removes the event handler.
 * @private
 */
DrawTool.prototype._deactivateHandler = function () {
  if (defined(this._handler)) {
    this._handler.destroy();
    this._handler = undefined;
  }
  this._drawingType = undefined;
};

DrawTool.prototype.isDestroyed = function () {
  return false;
};

DrawTool.prototype.destroy = function () {
  this.cancel();
  return destroyObject(this);
};

export default DrawTool;
