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
 * @param {Function} [options.warmCallback] Called with an array of candidate items when the best item changes. Use to pre-warm server caches for likely next images.
 * @param {number} [options.warmCount=5] Number of top-scoring candidates to pass to warmCallback.
 *
 * @example
 * const handler = new Cesium.ProjectedImageCollectionHandler(collection, viewer.scene, {
 *   weights: { alignment: 0.7, distance: 0.3 },
 *   hysteresis: 0.05,
 *   warmCount: 5,
 *   warmCallback: function (items) {
 *     // Pre-warm IIIF server cache for top candidates
 *     items.forEach(function (item) { warmServerCache(item); });
 *   },
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
  this._targetPoint = undefined;
  this._warmCallback = options.warmCallback;
  this._warmCount = options.warmCount ?? 5;
  this._warmedSet = new WeakSet();

  this._preRenderListener = scene.preRender.addEventListener(
    ProjectedImageCollectionHandler.prototype._onPreRender,
    this,
  );

  // When starting disabled, hide all projected image primitives immediately
  // so they don't all try to load textures simultaneously (request
  // throttling would permanently break most textures).
  if (!this._enabled) {
    this._hideAllImagePrimitives();
  }
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
      if (!value) {
        this._hideAllImagePrimitives();
      }
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

  /**
   * Optional target point for scoring. When set, images are scored by how well
   * the source camera covers this point rather than by viewer direction alignment.
   * Set to the orbit pivot to get stable, target-aware image selection.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {Cartesian3|undefined}
   */
  targetPoint: {
    get: function () {
      return this._targetPoint;
    },
    set: function (value) {
      this._targetPoint = value;
    },
  },

  /**
   * Called with an array of candidate items when the best item changes.
   * Use to pre-warm server caches for likely next images.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {Function|undefined}
   */
  warmCallback: {
    get: function () {
      return this._warmCallback;
    },
    set: function (value) {
      this._warmCallback = value;
    },
  },

  /**
   * Number of top-scoring candidates to pass to warmCallback.
   * @memberof ProjectedImageCollectionHandler.prototype
   * @type {number}
   */
  warmCount: {
    get: function () {
      return this._warmCount;
    },
    set: function (value) {
      this._warmCount = value;
    },
  },
});

/**
 * Hide all projected image primitives in the collection.
 * Only hides the image primitive itself — camera icons, labels, and
 * frustums remain visible so the user can still see where cameras are.
 * @private
 */
ProjectedImageCollectionHandler.prototype._hideAllImagePrimitives =
  function () {
    const collection = this._collection;
    for (let i = 0; i < collection.length; i++) {
      collection.get(i).primitive.show = false;
    }
    this._currentBestItem = undefined;
  };

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
  const tp = this._targetPoint;

  if (length === 0) {
    this._currentBestItem = undefined;
    return;
  }

  let bestItem;
  let bestScore = -Infinity;
  const scored = [];

  // Score all items
  for (let i = 0; i < length; i++) {
    const item = collection.get(i);
    const score = ProjectedImageCollection.computeViewScore(
      item,
      camera,
      this._weights,
      tp,
    );

    scored.push({ item: item, score: score });

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
        tp,
      ) +
        this._hysteresis
  ) {
    bestItem = this._currentBestItem;
    bestScore = ProjectedImageCollection.computeViewScore(
      bestItem,
      camera,
      this._weights,
      tp,
    );
  }

  // Apply threshold
  if (bestScore < this._threshold) {
    bestItem = undefined;
  }

  const previousBest = this._currentBestItem;
  this._currentBestItem = bestItem;

  // Warm top candidates when the best item changes
  if (bestItem !== previousBest && defined(this._warmCallback)) {
    const threshold = this._threshold;
    const warmedSet = this._warmedSet;

    scored.sort((a, b) => b.score - a.score);

    const candidates = [];
    for (let i = 0; i < scored.length; i++) {
      const entry = scored[i];
      if (entry.item === bestItem) {
        continue;
      }
      if (entry.score < threshold) {
        break; // sorted descending, no more above threshold
      }
      if (warmedSet.has(entry.item)) {
        continue;
      }
      candidates.push(entry.item);
      warmedSet.add(entry.item);
      if (candidates.length >= this._warmCount) {
        break;
      }
    }

    if (candidates.length > 0) {
      try {
        this._warmCallback(candidates);
      } catch (e) {
        console.warn("ProjectedImageCollectionHandler: warmCallback error", e);
      }
    }
  }

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
        tp,
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
