/**
 * The current mode of a {@link ShapeEditor}.
 *
 * @enum {string}
 */
const ShapeEditorMode = Object.freeze({
  /**
   * The editor is inactive. No drawing or editing is in progress.
   * @type {string}
   * @constant
   */
  INACTIVE: "INACTIVE",

  /**
   * The editor is in drawing mode. Clicking places vertices to create new geometry.
   * @type {string}
   * @constant
   */
  DRAWING: "DRAWING",

  /**
   * The editor is in edit mode. An existing shape's vertices can be moved, added, or removed.
   * @type {string}
   * @constant
   */
  EDITING: "EDITING",

  /**
   * The editor is in point placement mode. Each click places a point entity.
   * @type {string}
   * @constant
   */
  PLACING_POINTS: "PLACING_POINTS",

  /**
   * The editor is in translate mode. Drag entities to move them across the globe.
   * @type {string}
   * @constant
   */
  TRANSLATING: "TRANSLATING",
});

export default ShapeEditorMode;
