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
 * @typedef {object} EditToolOptions
 * @property {import('../Scene/Scene.js').default} scene The scene.
 * @property {import('../DataSources/EntityCollection.js').default} entities The entity collection for handle entities.
 * @property {boolean} [clampToGround=true] Whether editing should clamp to terrain.
 * @property {Color} [vertexColor=Color.CYAN] Color for vertex handles.
 * @property {Color} [vertexSelectedColor=Color.YELLOW] Color for the selected/dragged vertex.
 * @property {number} [vertexPixelSize=10] Pixel size for vertex handles.
 * @property {Color} [midpointColor=Color.GRAY] Color for mid-edge handles.
 * @property {number} [midpointPixelSize=7] Pixel size for mid-edge handles.
 */

/**
 * Internal tool that handles editing existing geometry: dragging vertices,
 * inserting mid-edge vertices, and deleting vertices.
 *
 * @alias EditTool
 * @constructor
 * @private
 *
 * @param {EditToolOptions} options
 */
function EditTool(options) {
  this._scene = options.scene;
  this._entities = options.entities;
  this._clampToGround = options.clampToGround !== false;

  this._vertexColor = options.vertexColor ?? Color.CYAN;
  this._vertexSelectedColor = options.vertexSelectedColor ?? Color.YELLOW;
  this._vertexPixelSize = options.vertexPixelSize ?? 10;
  this._midpointColor = options.midpointColor ?? Color.GRAY;
  this._midpointPixelSize = options.midpointPixelSize ?? 7;

  this._handler = undefined;
  this._editingEntity = undefined;
  this._positions = []; // live positions array (Cartesian3[])
  this._vertexHandles = []; // point entities for each vertex
  this._midpointHandles = []; // point entities between each pair of vertices
  this._dragIndex = -1; // index of vertex being dragged
  this._isDragging = false;

  this._editComplete = new Event();
  this._vertexMoved = new Event();
  this._vertexAdded = new Event();
  this._vertexRemoved = new Event();
}

Object.defineProperties(EditTool.prototype, {
  /**
   * Event raised when editing is completed (user clicks away or presses Escape).
   * @memberof EditTool.prototype
   * @type {Event}
   * @readonly
   */
  editComplete: {
    get: function () {
      return this._editComplete;
    },
  },

  /**
   * Event raised when a vertex is moved. Callback receives (index, newPosition).
   * @memberof EditTool.prototype
   * @type {Event}
   * @readonly
   */
  vertexMoved: {
    get: function () {
      return this._vertexMoved;
    },
  },

  /**
   * Event raised when a vertex is inserted. Callback receives (index, position).
   * @memberof EditTool.prototype
   * @type {Event}
   * @readonly
   */
  vertexAdded: {
    get: function () {
      return this._vertexAdded;
    },
  },

  /**
   * Event raised when a vertex is removed. Callback receives (index).
   * @memberof EditTool.prototype
   * @type {Event}
   * @readonly
   */
  vertexRemoved: {
    get: function () {
      return this._vertexRemoved;
    },
  },

  /**
   * Whether an edit operation is currently active.
   * @memberof EditTool.prototype
   * @type {boolean}
   * @readonly
   */
  isActive: {
    get: function () {
      return defined(this._handler);
    },
  },

  /**
   * The entity currently being edited.
   * @memberof EditTool.prototype
   * @type {Entity|undefined}
   * @readonly
   */
  editingEntity: {
    get: function () {
      return this._editingEntity;
    },
  },
});

/**
 * Picks a position on the globe from a screen coordinate.
 * @private
 */
EditTool.prototype._pickPosition = function (windowPosition) {
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
  // surface position. Skip this when over editor entities to avoid
  // depth-buffer jitter from our own preview/handle geometry.
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
 * Starts editing an entity. The entity must have either polygon or polyline graphics
 * and must have an `_editorPositions` array attached.
 *
 * @param {Entity} entity The entity to edit.
 */
EditTool.prototype.activate = function (entity) {
  if (this.isActive) {
    this.deactivate();
  }

  const positions = entity._editorPositions;
  if (!defined(positions) || positions.length === 0) {
    return;
  }

  this._editingEntity = entity;
  this._positions = positions;
  this._isPolygon = defined(entity.polygon);

  // Switch the entity's geometry to use CallbackProperty for live updates
  this._bindLiveGeometry(entity);

  // Create vertex and midpoint handles
  this._createHandles();

  // Set up event handling
  const handler = new ScreenSpaceEventHandler(this._scene.canvas);
  this._handler = handler;

  const self = this;

  // LEFT_DOWN: start dragging a vertex handle
  handler.setInputAction(function (event) {
    self._onLeftDown(event);
  }, ScreenSpaceEventType.LEFT_DOWN);

  // MOUSE_MOVE: drag vertex
  handler.setInputAction(function (event) {
    self._onMouseMove(event);
  }, ScreenSpaceEventType.MOUSE_MOVE);

  // LEFT_UP: stop dragging
  handler.setInputAction(function (event) {
    self._onLeftUp(event);
  }, ScreenSpaceEventType.LEFT_UP);

  // Listen for keyboard events on the canvas
  this._onKeyDown = function (e) {
    self._handleKeyDown(e);
  };
  this._scene.canvas.addEventListener("keydown", this._onKeyDown);
  // Make canvas focusable for keyboard events
  if (!this._scene.canvas.hasAttribute("tabindex")) {
    this._scene.canvas.setAttribute("tabindex", "0");
  }
  this._scene.canvas.focus();
};

/**
 * Binds the entity's geometry positions to a CallbackProperty for live updates.
 * @private
 */
EditTool.prototype._bindLiveGeometry = function (entity) {
  const positions = this._positions;

  if (defined(entity.polygon)) {
    entity.polygon.hierarchy = new CallbackProperty(function () {
      return new PolygonHierarchy(positions);
    }, false);
  } else if (defined(entity.polyline)) {
    entity.polyline.positions = new CallbackProperty(function () {
      return positions.slice();
    }, false);
  }
};

/**
 * Creates vertex handles and midpoint handles for all positions.
 * @private
 */
EditTool.prototype._createHandles = function () {
  this._clearHandles();

  const positions = this._positions;

  // Create vertex handles
  for (let i = 0; i < positions.length; i++) {
    this._vertexHandles.push(this._createVertexHandle(i));
  }

  // Create midpoint handles
  this._rebuildMidpointHandles();
};

/**
 * Creates a draggable vertex handle at the given index.
 * @private
 */
EditTool.prototype._createVertexHandle = function (index) {
  const positions = this._positions;
  const clamp = this._clampToGround;
  const color = this._vertexColor;

  return this._entities.add({
    position: new CallbackProperty(function () {
      return positions[index];
    }, false),
    point: {
      color: color,
      pixelSize: this._vertexPixelSize,
      outlineColor: Color.BLACK,
      outlineWidth: 1,
      heightReference: clamp
        ? HeightReference.CLAMP_TO_GROUND
        : HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    _isEditorHandle: true,
    _handleType: "vertex",
    _handleIndex: index,
  });
};

/**
 * Rebuilds the midpoint handles (between each consecutive pair of vertices).
 * @private
 */
EditTool.prototype._rebuildMidpointHandles = function () {
  // Remove existing midpoints
  for (let i = 0; i < this._midpointHandles.length; i++) {
    this._entities.remove(this._midpointHandles[i]);
  }
  this._midpointHandles = [];

  const positions = this._positions;
  const count = this._isPolygon ? positions.length : positions.length - 1;

  for (let i = 0; i < count; i++) {
    const nextIndex = (i + 1) % positions.length;
    this._midpointHandles.push(this._createMidpointHandle(i, nextIndex));
  }
};

/**
 * Creates a midpoint handle entity between two vertex positions.
 * @private
 */
EditTool.prototype._createMidpointHandle = function (indexA, indexB) {
  const positions = this._positions;
  const midScratch = new Cartesian3();
  const clamp = this._clampToGround;
  const color = this._midpointColor;

  return this._entities.add({
    position: new CallbackProperty(function () {
      return Cartesian3.midpoint(
        positions[indexA],
        positions[indexB],
        midScratch,
      );
    }, false),
    point: {
      color: color,
      pixelSize: this._midpointPixelSize,
      outlineColor: Color.BLACK,
      outlineWidth: 1,
      heightReference: clamp
        ? HeightReference.CLAMP_TO_GROUND
        : HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    _isEditorHandle: true,
    _handleType: "midpoint",
    _handleInsertAfter: indexA,
  });
};

/**
 * Handles left mouse button down — begins dragging if a vertex/midpoint handle is picked.
 * @private
 */
EditTool.prototype._onLeftDown = function (event) {
  const picked = this._scene.pick(event.position);

  if (!defined(picked) || !defined(picked.id)) {
    return;
  }

  const entity = picked.id;

  if (!entity._isEditorHandle) {
    return;
  }

  if (entity._handleType === "midpoint") {
    // Insert a new vertex at this midpoint
    const insertIndex = entity._handleInsertAfter + 1;
    const position = this._pickPosition(event.position);
    if (!defined(position)) {
      return;
    }
    this._insertVertex(insertIndex, position);
    // Start dragging the newly inserted vertex
    this._dragIndex = insertIndex;
  } else {
    // Start dragging this vertex
    this._dragIndex = entity._handleIndex;
  }

  this._isDragging = true;

  // Highlight the active vertex
  this._highlightVertex(this._dragIndex, true);

  // Disable camera controls during drag
  this._scene.screenSpaceCameraController.enableInputs = false;
};

/**
 * Handles mouse move — drags the active vertex if one is being dragged.
 * @private
 */
EditTool.prototype._onMouseMove = function (event) {
  if (!this._isDragging || this._dragIndex < 0) {
    // Update cursor based on what we're hovering over
    this._updateCursor(event.endPosition);
    return;
  }

  const newPosition = this._pickPosition(event.endPosition);
  if (!defined(newPosition)) {
    return;
  }

  // Update the position in the array (CallbackProperty will pick up the change)
  this._positions[this._dragIndex] = Cartesian3.clone(newPosition);
};

/**
 * Handles left mouse button up — stops dragging.
 * @private
 */
EditTool.prototype._onLeftUp = function () {
  if (this._isDragging && this._dragIndex >= 0) {
    this._highlightVertex(this._dragIndex, false);
    this._vertexMoved.raiseEvent(
      this._dragIndex,
      Cartesian3.clone(this._positions[this._dragIndex]),
    );
  }

  this._isDragging = false;
  this._dragIndex = -1;

  // Re-enable camera controls
  this._scene.screenSpaceCameraController.enableInputs = true;
};

/**
 * Handles keyboard events for vertex deletion and cancellation.
 * @private
 */
EditTool.prototype._handleKeyDown = function (event) {
  if (event.key === "Escape") {
    this.deactivate();
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    // Delete is handled on next click — we need a selected vertex
    // For MVP, delete the last vertex if we have enough
    this._deleteLastVertex();
  }
};

/**
 * Inserts a new vertex at the given index.
 * @private
 */
EditTool.prototype._insertVertex = function (index, position) {
  this._positions.splice(index, 0, Cartesian3.clone(position));
  this._rebuildAllHandles();
  this._vertexAdded.raiseEvent(index, Cartesian3.clone(position));
};

/**
 * Deletes the last vertex if there are enough vertices remaining.
 * @private
 */
EditTool.prototype._deleteLastVertex = function () {
  const minVertices = this._isPolygon ? 3 : 2;
  if (this._positions.length <= minVertices) {
    return;
  }

  const removedIndex = this._positions.length - 1;
  this._positions.pop();
  this._rebuildAllHandles();
  this._vertexRemoved.raiseEvent(removedIndex);
};

/**
 * Deletes a vertex at a specific index if there are enough vertices remaining.
 * @param {number} index
 */
EditTool.prototype.deleteVertex = function (index) {
  const minVertices = this._isPolygon ? 3 : 2;
  if (
    this._positions.length <= minVertices ||
    index < 0 ||
    index >= this._positions.length
  ) {
    return;
  }

  this._positions.splice(index, 1);
  this._rebuildAllHandles();
  this._vertexRemoved.raiseEvent(index);
};

/**
 * Clears and recreates all vertex and midpoint handles.
 * @private
 */
EditTool.prototype._rebuildAllHandles = function () {
  this._clearHandles();

  for (let i = 0; i < this._positions.length; i++) {
    this._vertexHandles.push(this._createVertexHandle(i));
  }

  this._rebuildMidpointHandles();
};

/**
 * Highlights or unhighlights a vertex handle.
 * @private
 */
EditTool.prototype._highlightVertex = function (index, highlight) {
  if (index >= 0 && index < this._vertexHandles.length) {
    const handle = this._vertexHandles[index];
    handle.point.color = new ConstantProperty(
      highlight ? this._vertexSelectedColor : this._vertexColor,
    );
    handle.point.pixelSize = new ConstantProperty(
      highlight ? this._vertexPixelSize + 4 : this._vertexPixelSize,
    );
  }
};

/**
 * Updates the cursor based on what's under the mouse.
 * @private
 */
EditTool.prototype._updateCursor = function (windowPosition) {
  const picked = this._scene.pick(windowPosition);
  const canvas = this._scene.canvas;

  if (defined(picked) && defined(picked.id) && picked.id._isEditorHandle) {
    canvas.style.cursor =
      picked.id._handleType === "midpoint" ? "copy" : "move";
  } else {
    canvas.style.cursor = "default";
  }
};

/**
 * Removes all handle entities.
 * @private
 */
EditTool.prototype._clearHandles = function () {
  const entities = this._entities;

  for (let i = 0; i < this._vertexHandles.length; i++) {
    entities.remove(this._vertexHandles[i]);
  }
  this._vertexHandles = [];

  for (let i = 0; i < this._midpointHandles.length; i++) {
    entities.remove(this._midpointHandles[i]);
  }
  this._midpointHandles = [];
};

/**
 * Deactivates the edit tool and cleans up.
 */
EditTool.prototype.deactivate = function () {
  this._clearHandles();

  if (defined(this._handler)) {
    this._handler.destroy();
    this._handler = undefined;
  }

  if (defined(this._onKeyDown)) {
    this._scene.canvas.removeEventListener("keydown", this._onKeyDown);
    this._onKeyDown = undefined;
  }

  this._scene.canvas.style.cursor = "default";

  // Re-enable camera controls
  this._scene.screenSpaceCameraController.enableInputs = true;

  // Finalize the geometry — switch from CallbackProperty to static
  if (defined(this._editingEntity)) {
    const entity = this._editingEntity;
    const finalPositions = this._positions.map(function (p) {
      return Cartesian3.clone(p);
    });

    if (defined(entity.polygon)) {
      entity.polygon.hierarchy = new PolygonHierarchy(finalPositions);
    } else if (defined(entity.polyline)) {
      entity.polyline.positions = finalPositions;
    }

    entity._editorPositions = finalPositions;
    this._editComplete.raiseEvent(entity, finalPositions);
  }

  this._editingEntity = undefined;
  this._positions = [];
  this._isDragging = false;
  this._dragIndex = -1;
};

EditTool.prototype.isDestroyed = function () {
  return false;
};

EditTool.prototype.destroy = function () {
  this.deactivate();
  return destroyObject(this);
};

export default EditTool;
