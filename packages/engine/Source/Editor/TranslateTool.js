import Cartesian3 from "../Core/Cartesian3.js";
import Cartographic from "../Core/Cartographic.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Ellipsoid from "../Core/Ellipsoid.js";
import Event from "../Core/Event.js";
import PolygonHierarchy from "../Core/PolygonHierarchy.js";
import ScreenSpaceEventHandler from "../Core/ScreenSpaceEventHandler.js";
import ScreenSpaceEventType from "../Core/ScreenSpaceEventType.js";
import TransformGizmo from "./TransformGizmo.js";

/**
 * @typedef {object} TranslateToolOptions
 * @property {import('../Scene/Scene.js').default} scene The scene.
 * @property {import('../DataSources/EntityCollection.js').default} entities Entity collection for gizmo handle entities.
 */

/**
 * Internal tool that handles translation of entities created by the shape editor
 * using a 3D transform gizmo. Click an entity to display axis arrows
 * (East=Red, North=Green, Up=Blue), then drag an arrow to translate
 * the entity along that axis.
 *
 * @alias TranslateTool
 * @constructor
 * @private
 *
 * @param {TranslateToolOptions} options
 */
function TranslateTool(options) {
  this._scene = options.scene;

  this._handler = undefined;
  this._activeEntity = undefined;
  this._isDragging = false;
  this._lastPickPosition = undefined;
  this._lastScreenY = undefined;
  this._dragAxis = undefined;
  this._dragAxisDirection = undefined;
  this._dragStartCenter = undefined;
  this._dragStartProjection = undefined;

  this._gizmo = new TransformGizmo({
    scene: options.scene,
    entities: options.entities,
  });

  this._translateComplete = new Event();
}

Object.defineProperties(TranslateTool.prototype, {
  /**
   * Event raised when a translate drag is completed.
   * Callback receives (entity, oldPositions, newPositions).
   * @memberof TranslateTool.prototype
   * @type {Event}
   * @readonly
   */
  translateComplete: {
    get: function () {
      return this._translateComplete;
    },
  },

  /**
   * Whether the translate tool is currently active.
   * @memberof TranslateTool.prototype
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
 * Picks a globe position from a screen coordinate.
 * @private
 */
TranslateTool.prototype._pickGlobePosition = function (windowPosition) {
  const scene = this._scene;
  const ray = scene.camera.getPickRay(windowPosition);
  if (defined(ray)) {
    return scene.globe.pick(ray, scene);
  }
  return undefined;
};

/**
 * Activates the translate tool. Click an editor entity to show the gizmo,
 * then drag a gizmo arrow to translate along that axis.
 */
TranslateTool.prototype.activate = function () {
  if (this.isActive) {
    this.deactivate();
  }

  const handler = new ScreenSpaceEventHandler(this._scene.canvas);
  this._handler = handler;

  const self = this;

  handler.setInputAction(function (event) {
    const picked = self._scene.pick(event.position);

    if (!defined(picked) || !defined(picked.id)) {
      // Clicked empty space — hide gizmo
      self._gizmo.hide();
      self._activeEntity = undefined;
      return;
    }

    const entity = picked.id;

    // Skip editor handles (gizmo axes handled on LEFT_DOWN)
    if (
      entity._isEditorHandle ||
      entity._isEditorVertex ||
      entity._isEditorPreview
    ) {
      return;
    }

    // Editor entity picked — select it and show gizmo
    if (defined(entity._editorPositions)) {
      self._activeEntity = entity;
      self._gizmo.show(self._computeSurfaceCenter(entity._editorPositions));
    }
  }, ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(function (event) {
    const picked = self._scene.pick(event.position);

    if (!defined(picked) || !defined(picked.id)) {
      return;
    }

    const entity = picked.id;

    // Gizmo axis arrow picked — start constrained drag
    if (entity._isEditorHandle && entity._handleType === "gizmoAxis") {
      self._dragAxis = entity._axisName;
      self._dragAxisDirection = self._gizmo.getAxisDirection(entity._axisName);
      self._isDragging = true;
      self._dragStartCenter = Cartesian3.clone(self._gizmo.center);

      if (entity._axisName === "up") {
        self._lastScreenY = event.position.y;
      } else {
        const pickPos = self._pickGlobePosition(event.position);
        if (defined(pickPos)) {
          const fromCenter = Cartesian3.subtract(
            pickPos,
            self._dragStartCenter,
            new Cartesian3(),
          );
          self._dragStartProjection = Cartesian3.dot(
            fromCenter,
            self._dragAxisDirection,
          );
        }
        self._lastPickPosition = pickPos;
      }

      // Save original positions for undo
      if (defined(self._activeEntity)) {
        self._originalPositions = self._activeEntity._editorPositions.map(
          function (p) {
            return Cartesian3.clone(p);
          },
        );
      }

      self._scene.screenSpaceCameraController.enableInputs = false;
      return;
    }
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction(function (event) {
    if (
      !self._isDragging ||
      !defined(self._activeEntity) ||
      !defined(self._dragAxis)
    ) {
      return;
    }

    const positions = self._activeEntity._editorPositions;

    if (self._dragAxis === "up") {
      // Screen-space vertical drag for the Up axis
      const currentY = event.endPosition.y;
      const deltaY = self._lastScreenY - currentY; // screen up = positive

      const cameraPos = self._scene.camera.positionWC;
      const gizmoCenter = self._gizmo.center;
      const distance = Cartesian3.distance(cameraPos, gizmoCenter);
      const heightDelta = deltaY * (distance / self._scene.canvas.clientHeight);

      const offset = Cartesian3.multiplyByScalar(
        self._dragAxisDirection,
        heightDelta,
        new Cartesian3(),
      );

      for (let i = 0; i < positions.length; i++) {
        Cartesian3.add(positions[i], offset, positions[i]);
      }

      const newCenter = Cartesian3.add(
        self._gizmo.center,
        offset,
        new Cartesian3(),
      );
      self._gizmo.updateCenter(newCenter);
      self._applyPositions(self._activeEntity, positions);
      self._lastScreenY = currentY;
    } else {
      // East/North: absolute positioning from drag start
      const currentPos = self._pickGlobePosition(event.endPosition);
      if (!defined(currentPos) || !defined(self._dragStartCenter)) {
        return;
      }

      // Project current pick onto the axis relative to the original center
      const fromOrigCenter = Cartesian3.subtract(
        currentPos,
        self._dragStartCenter,
        new Cartesian3(),
      );
      const currentProjection = Cartesian3.dot(
        fromOrigCenter,
        self._dragAxisDirection,
      );

      // The displacement is the difference from the initial click projection
      const displacement = currentProjection - (self._dragStartProjection || 0);
      const newCenter = Cartesian3.add(
        self._dragStartCenter,
        Cartesian3.multiplyByScalar(
          self._dragAxisDirection,
          displacement,
          new Cartesian3(),
        ),
        new Cartesian3(),
      );

      // Compute offset from current gizmo center
      const offset = Cartesian3.subtract(
        newCenter,
        self._gizmo.center,
        new Cartesian3(),
      );

      for (let i = 0; i < positions.length; i++) {
        Cartesian3.add(positions[i], offset, positions[i]);
      }

      self._gizmo.updateCenter(newCenter);
      self._applyPositions(self._activeEntity, positions);
    }
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(function () {
    if (self._isDragging && defined(self._activeEntity)) {
      self._scene.screenSpaceCameraController.enableInputs = true;

      const newPositions = self._activeEntity._editorPositions.map(
        function (p) {
          return Cartesian3.clone(p);
        },
      );

      self._translateComplete.raiseEvent(
        self._activeEntity,
        self._originalPositions,
        newPositions,
      );

      // Update gizmo to new entity center
      self._gizmo.show(self._computeSurfaceCenter(newPositions));
    }

    self._isDragging = false;
    self._dragAxis = undefined;
    self._dragAxisDirection = undefined;
    self._lastPickPosition = undefined;
    self._lastScreenY = undefined;
    self._dragStartCenter = undefined;
    self._dragStartProjection = undefined;
    self._originalPositions = undefined;
  }, ScreenSpaceEventType.LEFT_UP);
};

/**
 * Computes the geographic center of an array of positions on the surface.
 * Uses cartographic averaging so the result stays on the ellipsoid surface
 * rather than ending up underground.
 * @private
 */
TranslateTool.prototype._computeSurfaceCenter = function (positions) {
  let lon = 0;
  let lat = 0;
  let height = 0;
  for (let i = 0; i < positions.length; i++) {
    const carto = Cartographic.fromCartesian(positions[i], Ellipsoid.WGS84);
    lon += carto.longitude;
    lat += carto.latitude;
    height += carto.height;
  }
  const n = positions.length;
  return Cartesian3.fromRadians(lon / n, lat / n, height / n);
};

/**
 * Applies an updated positions array to an entity's graphics.
 * @private
 */
TranslateTool.prototype._applyPositions = function (entity, positions) {
  if (defined(entity.polygon)) {
    entity.polygon.hierarchy = new PolygonHierarchy(positions.slice());
  } else if (defined(entity.polyline)) {
    entity.polyline.positions = positions.slice();
  } else if (defined(entity.position)) {
    // Point entity
    if (positions.length > 0) {
      entity.position = positions[0];
    }
  }
};

/**
 * Deactivates the translate tool and hides the gizmo.
 */
TranslateTool.prototype.deactivate = function () {
  if (defined(this._handler)) {
    this._handler.destroy();
    this._handler = undefined;
  }

  this._gizmo.hide();

  if (this._isDragging) {
    this._scene.screenSpaceCameraController.enableInputs = true;
  }

  this._isDragging = false;
  this._activeEntity = undefined;
  this._lastPickPosition = undefined;
  this._lastScreenY = undefined;
  this._dragAxis = undefined;
  this._dragAxisDirection = undefined;
  this._dragStartCenter = undefined;
  this._dragStartProjection = undefined;
};

TranslateTool.prototype.isDestroyed = function () {
  return false;
};

TranslateTool.prototype.destroy = function () {
  this.deactivate();
  this._gizmo.destroy();
  return destroyObject(this);
};

export default TranslateTool;
