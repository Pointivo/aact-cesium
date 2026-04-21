import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DeveloperError from "../Core/DeveloperError.js";
import Event from "../Core/Event.js";
import CustomDataSource from "../DataSources/CustomDataSource.js";
import DrawTool from "./DrawTool.js";
import EditTool from "./EditTool.js";
import ShapeEditorMode from "./ShapeEditorMode.js";
import ScreenSpaceEventHandler from "../Core/ScreenSpaceEventHandler.js";
import ScreenSpaceEventType from "../Core/ScreenSpaceEventType.js";

/**
 * @typedef {object} ShapeEditorOptions
 * @property {import('../Widget/CesiumWidget.js').default|{scene: import('../Scene/Scene.js').default, dataSources: import('../DataSources/DataSourceCollection.js').default}} viewer
 *   A Cesium Viewer or any object with `scene` and `dataSources` properties.
 * @property {boolean} [clampToGround=true] Whether drawn/edited geometry should clamp to terrain.
 * @property {Color} [vertexColor=Color.CYAN] Color for vertex handles in edit mode.
 * @property {Color} [vertexSelectedColor=Color.YELLOW] Color for the active/dragged vertex.
 * @property {number} [vertexPixelSize=10] Pixel size for vertex handles.
 * @property {Color} [drawVertexColor=Color.WHITE] Color for vertex markers while drawing.
 * @property {number} [drawVertexPixelSize=8] Pixel size for vertex markers while drawing.
 * @property {Color} [edgeColor=Color.YELLOW] Color for polyline edges.
 * @property {number} [edgeWidth=3] Width for polyline edges.
 * @property {Color} [fillColor] Fill color for polygons.
 * @property {Color} [midpointColor=Color.GRAY] Color for mid-edge insert handles.
 * @property {number} [midpointPixelSize=7] Pixel size for mid-edge insert handles.
 */

/**
 * A shape editor for creating and editing polygons and polylines on the Cesium globe.
 *
 * Supports three modes:
 * - **INACTIVE**: No editing in progress. Clicking an editable entity selects it for editing.
 * - **DRAWING**: Click to place vertices, right-click or double-click to finish.
 * - **EDITING**: Drag vertex handles to move them, click midpoint handles to insert vertices,
 *   press Delete to remove the last vertex, press Escape to finish editing.
 *
 * @alias ShapeEditor
 * @constructor
 *
 * @param {ShapeEditorOptions} options
 *
 * @example
 * const editor = new Cesium.ShapeEditor({ viewer: viewer });
 *
 * // Draw a polygon
 * editor.startDrawing('polygon');
 *
 * // Listen for completion
 * editor.drawComplete.addEventListener(function(entity, positions) {
 *   console.log('Drew polygon with', positions.length, 'vertices');
 * });
 *
 * // Later, edit an entity
 * editor.startEditing(entity);
 */
function ShapeEditor(options) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(options) || !defined(options.viewer)) {
    throw new DeveloperError("options.viewer is required.");
  }
  //>>includeEnd('debug');

  const viewer = options.viewer;
  const scene = viewer.scene;

  this._viewer = viewer;
  this._scene = scene;

  // Create a dedicated data source for editor entities (handles, previews)
  this._dataSource = new CustomDataSource("_shapeEditor");
  viewer.dataSources.add(this._dataSource);

  // Keep drawn shapes in a separate data source
  this._shapesDataSource = new CustomDataSource("_shapeEditorShapes");
  viewer.dataSources.add(this._shapesDataSource);

  const clampToGround = options.clampToGround !== false;

  this._drawTool = new DrawTool({
    scene: scene,
    entities: this._shapesDataSource.entities,
    clampToGround: clampToGround,
    vertexColor: options.drawVertexColor,
    vertexPixelSize: options.drawVertexPixelSize,
    edgeColor: options.edgeColor,
    edgeWidth: options.edgeWidth,
    fillColor: options.fillColor,
  });

  this._editTool = new EditTool({
    scene: scene,
    entities: this._dataSource.entities,
    clampToGround: clampToGround,
    vertexColor: options.vertexColor,
    vertexSelectedColor: options.vertexSelectedColor,
    vertexPixelSize: options.vertexPixelSize,
    midpointColor: options.midpointColor,
    midpointPixelSize: options.midpointPixelSize,
  });

  this._mode = ShapeEditorMode.INACTIVE;
  this._selectHandler = undefined;

  // Public events
  this._drawComplete = new Event();
  this._drawCancelled = new Event();
  this._editComplete = new Event();
  this._modeChanged = new Event();

  // Wire up internal tool events
  const self = this;

  this._drawTool.drawComplete.addEventListener(function (entity, positions) {
    self._setMode(ShapeEditorMode.INACTIVE);
    self._drawComplete.raiseEvent(entity, positions);
    self._enableSelectHandler();
  });

  this._drawTool.drawCancelled.addEventListener(function () {
    self._setMode(ShapeEditorMode.INACTIVE);
    self._drawCancelled.raiseEvent();
    self._enableSelectHandler();
  });

  this._editTool.editComplete.addEventListener(function (entity, positions) {
    self._setMode(ShapeEditorMode.INACTIVE);
    self._editComplete.raiseEvent(entity, positions);
    self._enableSelectHandler();
  });

  // Enable click-to-select by default
  this._enableSelectHandler();
}

Object.defineProperties(ShapeEditor.prototype, {
  /**
   * The current editor mode.
   * @memberof ShapeEditor.prototype
   * @type {ShapeEditorMode}
   * @readonly
   */
  mode: {
    get: function () {
      return this._mode;
    },
  },

  /**
   * Event raised when a shape is finished drawing. Callback receives (entity, positions).
   * @memberof ShapeEditor.prototype
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
   * @memberof ShapeEditor.prototype
   * @type {Event}
   * @readonly
   */
  drawCancelled: {
    get: function () {
      return this._drawCancelled;
    },
  },

  /**
   * Event raised when editing is finished. Callback receives (entity, positions).
   * @memberof ShapeEditor.prototype
   * @type {Event}
   * @readonly
   */
  editComplete: {
    get: function () {
      return this._editComplete;
    },
  },

  /**
   * Event raised when the editor mode changes. Callback receives (newMode, oldMode).
   * @memberof ShapeEditor.prototype
   * @type {Event}
   * @readonly
   */
  modeChanged: {
    get: function () {
      return this._modeChanged;
    },
  },

  /**
   * The entity currently being edited, if any.
   * @memberof ShapeEditor.prototype
   * @type {Entity|undefined}
   * @readonly
   */
  editingEntity: {
    get: function () {
      return this._editTool.editingEntity;
    },
  },

  /**
   * The data source containing editor-created shapes.
   * Access this to enumerate or remove drawn entities.
   * @memberof ShapeEditor.prototype
   * @type {CustomDataSource}
   * @readonly
   */
  shapes: {
    get: function () {
      return this._shapesDataSource;
    },
  },
});

/**
 * Starts drawing a new shape.
 *
 * @param {string} type Either `'polygon'` or `'polyline'`.
 *
 * @example
 * editor.startDrawing('polygon');
 */
ShapeEditor.prototype.startDrawing = function (type) {
  //>>includeStart('debug', pragmas.debug);
  if (type !== "polygon" && type !== "polyline") {
    throw new DeveloperError("type must be 'polygon' or 'polyline'.");
  }
  //>>includeEnd('debug');

  this.cancel();
  this._disableSelectHandler();
  this._setMode(ShapeEditorMode.DRAWING);
  this._drawTool.activate(type);
};

/**
 * Starts editing an existing entity. The entity must have been created by this editor
 * (i.e. it must have an `_editorPositions` array).
 *
 * @param {Entity} entity The entity to edit.
 *
 * @example
 * editor.drawComplete.addEventListener(function(entity) {
 *   // Immediately edit the drawn shape
 *   editor.startEditing(entity);
 * });
 */
ShapeEditor.prototype.startEditing = function (entity) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(entity)) {
    throw new DeveloperError("entity is required.");
  }
  //>>includeEnd('debug');

  if (!defined(entity._editorPositions)) {
    return;
  }

  this.cancel();
  this._disableSelectHandler();
  this._setMode(ShapeEditorMode.EDITING);
  this._editTool.activate(entity);
};

/**
 * Cancels any active drawing or editing operation.
 */
ShapeEditor.prototype.cancel = function () {
  if (this._mode === ShapeEditorMode.DRAWING) {
    this._drawTool.cancel();
  } else if (this._mode === ShapeEditorMode.EDITING) {
    this._editTool.deactivate();
  }
  this._setMode(ShapeEditorMode.INACTIVE);
  this._enableSelectHandler();
};

/**
 * Removes all shapes created by this editor.
 */
ShapeEditor.prototype.clearAll = function () {
  this.cancel();
  this._shapesDataSource.entities.removeAll();
};

/**
 * @private
 */
ShapeEditor.prototype._setMode = function (newMode) {
  if (this._mode !== newMode) {
    const oldMode = this._mode;
    this._mode = newMode;
    this._modeChanged.raiseEvent(newMode, oldMode);
  }
};

/**
 * Enables the click-to-select handler for picking editable entities.
 * @private
 */
ShapeEditor.prototype._enableSelectHandler = function () {
  if (defined(this._selectHandler)) {
    return;
  }

  const handler = new ScreenSpaceEventHandler(this._scene.canvas);
  this._selectHandler = handler;

  const self = this;

  handler.setInputAction(function (event) {
    const picked = self._scene.pick(event.position);

    if (!defined(picked) || !defined(picked.id)) {
      return;
    }

    const entity = picked.id;

    // Don't pick editor handles — those belong to the edit tool
    if (
      entity._isEditorHandle ||
      entity._isEditorVertex ||
      entity._isEditorPreview
    ) {
      return;
    }

    // Only pick entities with _editorPositions (created by this editor)
    if (defined(entity._editorPositions)) {
      self.startEditing(entity);
    }
  }, ScreenSpaceEventType.LEFT_CLICK);
};

/**
 * Disables the click-to-select handler.
 * @private
 */
ShapeEditor.prototype._disableSelectHandler = function () {
  if (defined(this._selectHandler)) {
    this._selectHandler.destroy();
    this._selectHandler = undefined;
  }
};

ShapeEditor.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys this editor and releases all resources.
 */
ShapeEditor.prototype.destroy = function () {
  this.cancel();
  this._disableSelectHandler();
  this._drawTool.destroy();
  this._editTool.destroy();
  this._viewer.dataSources.remove(this._dataSource, true);
  this._viewer.dataSources.remove(this._shapesDataSource, true);
  return destroyObject(this);
};

export default ShapeEditor;
