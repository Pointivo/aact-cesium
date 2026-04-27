import Cartesian3 from "../Core/Cartesian3.js";
import Color from "../Core/Color.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Transforms from "../Core/Transforms.js";
import CallbackProperty from "../DataSources/CallbackProperty.js";
import PolylineArrowMaterialProperty from "../DataSources/PolylineArrowMaterialProperty.js";

/**
 * @private
 */
const AXIS_CONFIGS = [
  { name: "east", color: Color.RED, column: 0 },
  { name: "north", color: Color.GREEN, column: 1 },
  { name: "up", color: Color.BLUE, column: 2 },
];

const ARROW_LENGTH_FACTOR = 0.04;

/**
 * A 3D transform gizmo that displays three axis arrows (East=Red, North=Green, Up=Blue)
 * at a given position on the globe. Each arrow is a pickable polyline entity
 * that acts as a drag handle for axis-constrained translation.
 *
 * @alias TransformGizmo
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {import('../Scene/Scene.js').default} options.scene The scene.
 * @param {import('../DataSources/EntityCollection.js').default} options.entities Entity collection to hold the gizmo entities.
 */
function TransformGizmo(options) {
  this._scene = options.scene;
  this._entities = options.entities;
  this._center = undefined;
  this._arrows = [];
  this._visible = false;
}

Object.defineProperties(TransformGizmo.prototype, {
  /**
   * Whether the gizmo is currently visible.
   * @memberof TransformGizmo.prototype
   * @type {boolean}
   * @readonly
   */
  visible: {
    get: function () {
      return this._visible;
    },
  },

  /**
   * The current center position of the gizmo in world coordinates.
   * @memberof TransformGizmo.prototype
   * @type {Cartesian3|undefined}
   * @readonly
   */
  center: {
    get: function () {
      return this._center;
    },
  },
});

/**
 * Shows the gizmo at the specified center position.
 * If already visible, hides the previous gizmo first.
 *
 * @param {Cartesian3} center The world-space center position.
 */
TransformGizmo.prototype.show = function (center) {
  this.hide();
  this._center = Cartesian3.clone(center);
  this._visible = true;

  const self = this;

  for (let i = 0; i < AXIS_CONFIGS.length; i++) {
    const config = AXIS_CONFIGS[i];
    const columnIndex = config.column;

    const arrowMaterial = new PolylineArrowMaterialProperty(config.color);

    const arrow = this._entities.add({
      polyline: {
        positions: new CallbackProperty(function () {
          return self._computePositions(columnIndex);
        }, false),
        width: 12,
        material: arrowMaterial,
        depthFailMaterial: arrowMaterial,
      },
      _isEditorHandle: true,
      _handleType: "gizmoAxis",
      _axisName: config.name,
      _axisColumn: columnIndex,
    });

    this._arrows.push(arrow);
  }
};

/**
 * Computes the two endpoints for a gizmo arrow based on axis column index.
 * Arrow length scales with camera distance so the gizmo maintains a
 * consistent apparent size.
 * @private
 *
 * @param {number} columnIndex 0=East, 1=North, 2=Up
 * @returns {Cartesian3[]} Two-element array [center, endpoint].
 */
TransformGizmo.prototype._computePositions = function (columnIndex) {
  if (!defined(this._center)) {
    return [];
  }

  const enuMatrix = Transforms.eastNorthUpToFixedFrame(this._center);

  const cameraPos = this._scene.camera.positionWC;
  const distance = Cartesian3.distance(cameraPos, this._center);
  const length = distance * ARROW_LENGTH_FACTOR;

  // Column-major: column c occupies indices [c*4, c*4+1, c*4+2]
  const direction = new Cartesian3(
    enuMatrix[columnIndex * 4],
    enuMatrix[columnIndex * 4 + 1],
    enuMatrix[columnIndex * 4 + 2],
  );

  const scaledDir = Cartesian3.multiplyByScalar(
    direction,
    length,
    new Cartesian3(),
  );
  const endpoint = Cartesian3.add(this._center, scaledDir, new Cartesian3());

  return [Cartesian3.clone(this._center), endpoint];
};

/**
 * Updates the gizmo center without recreating the arrow entities.
 * The arrows reposition automatically via their CallbackProperty.
 *
 * @param {Cartesian3} center The new center position.
 */
TransformGizmo.prototype.updateCenter = function (center) {
  if (defined(center)) {
    this._center = Cartesian3.clone(center);
  }
};

/**
 * Hides the gizmo and removes all arrow entities.
 */
TransformGizmo.prototype.hide = function () {
  for (let i = 0; i < this._arrows.length; i++) {
    this._entities.remove(this._arrows[i]);
  }
  this._arrows = [];
  this._visible = false;
  this._center = undefined;
};

/**
 * Returns the world-space unit direction vector for the given axis.
 *
 * @param {string} axisName "east", "north", or "up".
 * @returns {Cartesian3|undefined} Normalized direction vector, or undefined if gizmo is hidden.
 */
TransformGizmo.prototype.getAxisDirection = function (axisName) {
  if (!defined(this._center)) {
    return undefined;
  }

  const enuMatrix = Transforms.eastNorthUpToFixedFrame(this._center);

  let columnIndex;
  for (let i = 0; i < AXIS_CONFIGS.length; i++) {
    if (AXIS_CONFIGS[i].name === axisName) {
      columnIndex = AXIS_CONFIGS[i].column;
      break;
    }
  }

  if (!defined(columnIndex)) {
    return undefined;
  }

  const direction = new Cartesian3(
    enuMatrix[columnIndex * 4],
    enuMatrix[columnIndex * 4 + 1],
    enuMatrix[columnIndex * 4 + 2],
  );

  return Cartesian3.normalize(direction, direction);
};

TransformGizmo.prototype.isDestroyed = function () {
  return false;
};

TransformGizmo.prototype.destroy = function () {
  this.hide();
  return destroyObject(this);
};

export default TransformGizmo;
