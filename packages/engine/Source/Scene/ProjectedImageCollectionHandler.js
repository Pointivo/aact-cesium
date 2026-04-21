import Check from "../Core/Check.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Frozen from "../Core/Frozen.js";
import ProjectedImageCollection from "./ProjectedImageCollection.js";

/**
 * Automatically selects and displays the best-matching projected image from a
 * {@link ProjectedImageCollection} based on the viewer camera's position and direction.
 *
 * Each frame, the handler scores every item in the collection against the viewer
 * camera using {@link ProjectedImageCollection.computeViewScore}, then shows only
 * the highest-scoring item (or none if all scores are below a threshold).
 *
 * @alias ProjectedImageCollectionHandler
 * @constructor
 *
 * @param {ProjectedImageCollection} collection The collection to manage.
 * @param {Scene} scene The Cesium scene (used for preRender subscription).
 * @param {object} [options] Object with the following properties:
 * @param {boolean} [options.enabled=true] Whether automatic selection is active.
 * @param {object} [options.weights] Scoring weights passed to computeViewScore.
 * @param {number} [options.weights.alignment=0.7] Weight for directional alignment.
 * @param {number} [options.weights.distance=0.3] Weight for proximity.
 * @param {number} [options.threshold=0.1] Minimum score to show any image.
 * @param {number} [options.hysteresis=0.05] Score margin the current best must lose by before switching.
 * @param {boolean} [options.showOnlyBest=true] If true, only the best item is shown. If false, all items above threshold are shown.
 *
 * @example
 * const handler = new Cesium.ProjectedImageCollectionHandler(collection, viewer.scene, {
 *   weights: { alignment: 0.7, distance: 0.3 },
 *   hysteresis: 0.05,
 * });
 * // Later:
 * handler.enabled = false; // pause automatic switching
 * handler.destroy();       // remove the preRender listener
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 */
function ProjectedImageCollectionHandler(collection, scene, options) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("collection", collection);
  Check.typeOf.object("scene", scene);
  //>>includeEnd('debug');

  options = options ?? Frozen.EMPTY_OBJECT;

  this._collection = collection;
  this._scene = scene;
  this._enabled = options.enabled ?? true;
  this._weights = options.weights ?? { alignment: 0.7, distance: 0.3 };
  this._threshold = options.threshold ?? 0.1;
  this._hysteresis = options.hysteresis ?? 0.05;
  this._showOnlyBest = options.showOnlyBest ?? true;
  this._currentBestItem = undefined;

  this._preRenderListener = scene.preRender.addEventListener(
    ProjectedImageCollectionHandler.prototype._onPreRender,
    this,
  );
}

Object.defineProperties(ProjectedImageCollectionHandler.prototype, {
  /**
   * The collection being managed.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {ProjectedImageCollection}
   * @readonly
   */
  collection: {
    get: function () {
      return this._collection;
    },
  },

  /**
   * Whether automatic selection is active.
   * When disabled, item visibility is not changed by the handler.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {boolean}
   */
  enabled: {
    get: function () {
      return this._enabled;
    },
    set: function (value) {
      this._enabled = value;
    },
  },

  /**
   * Scoring weights.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {object}
   */
  weights: {
    get: function () {
      return this._weights;
    },
    set: function (value) {
      this._weights = value;
    },
  },

  /**
   * Minimum score to show any image.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {number}
   */
  threshold: {
    get: function () {
      return this._threshold;
    },
    set: function (value) {
      this._threshold = value;
    },
  },

  /**
   * Score margin the current best must lose by before switching to a new best.
   * Prevents flickering between two similarly-scored items.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {number}
   */
  hysteresis: {
    get: function () {
      return this._hysteresis;
    },
    set: function (value) {
      this._hysteresis = value;
    },
  },

  /**
   * If true, only the best item is shown. If false, all items above threshold are shown.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {boolean}
   */
  showOnlyBest: {
    get: function () {
      return this._showOnlyBest;
    },
    set: function (value) {
      this._showOnlyBest = value;
    },
  },

  /**
   * The currently displayed best item, or undefined if none meets the threshold.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {object|undefined}
   * @readonly
   */
  currentBestItem: {
    get: function () {
      return this._currentBestItem;
    },
  },
});

/**
 * @private
 */
ProjectedImageCollectionHandler.prototype._onPreRender = function () {
  if (!this._enabled) {
    return;
  }

  const collection = this._collection;
  const camera = this._scene.camera;
  const length = collection.length;

  if (length === 0) {
    this._currentBestItem = undefined;
    return;
  }

  let bestItem;
  let bestScore = -Infinity;

  // Score all items
  for (let i = 0; i < length; i++) {
    const item = collection.get(i);
    const score = ProjectedImageCollection.computeViewScore(
      item,
      camera,
      this._weights,
    );

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  // Apply hysteresis: keep current if it's still close
  if (
    defined(this._currentBestItem) &&
    this._currentBestItem !== bestItem &&
    bestScore <
      ProjectedImageCollection.computeViewScore(
        this._currentBestItem,
        camera,
        this._weights,
      ) +
        this._hysteresis
  ) {
    bestItem = this._currentBestItem;
    bestScore = ProjectedImageCollection.computeViewScore(
      bestItem,
      camera,
      this._weights,
    );
  }

  // Apply threshold
  if (bestScore < this._threshold) {
    bestItem = undefined;
  }

  this._currentBestItem = bestItem;

  // Update visibility
  if (this._showOnlyBest) {
    for (let i = 0; i < length; i++) {
      const item = collection.get(i);
      collection.setItemShow(item, item === bestItem);
    }
  } else {
    // Show all items above threshold
    for (let i = 0; i < length; i++) {
      const item = collection.get(i);
      const score = ProjectedImageCollection.computeViewScore(
        item,
        camera,
        this._weights,
      );
      collection.setItemShow(item, score >= this._threshold);
    }
  }
};

/**
 * Returns true if this object was destroyed.
 * @returns {boolean}
 */
ProjectedImageCollectionHandler.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroy this handler and remove the preRender listener.
 * Does NOT destroy the collection itself.
 */
ProjectedImageCollectionHandler.prototype.destroy = function () {
  if (defined(this._preRenderListener)) {
    this._preRenderListener();
    this._preRenderListener = undefined;
  }
  return destroyObject(this);
};

export default ProjectedImageCollectionHandler;
