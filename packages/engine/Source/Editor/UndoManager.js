import destroyObject from "../Core/destroyObject.js";
import Event from "../Core/Event.js";

/**
 * A command-based undo/redo manager.
 *
 * Commands are objects with `execute()` and `undo()` methods.
 * When a command is pushed, `execute()` is called immediately.
 * Calling {@link UndoManager#undo} calls `undo()` on the most recent command.
 * Calling {@link UndoManager#redo} calls `execute()` again on the last undone command.
 *
 * @alias UndoManager
 * @constructor
 * @private
 *
 * @param {object} [options]
 * @param {number} [options.maxStackSize=50] Maximum number of undo entries to retain.
 */
function UndoManager(options) {
  options = options ?? {};
  this._undoStack = [];
  this._redoStack = [];
  this._maxStackSize = options.maxStackSize ?? 50;

  this._changed = new Event();
}

Object.defineProperties(UndoManager.prototype, {
  /**
   * Whether there are commands that can be undone.
   * @memberof UndoManager.prototype
   * @type {boolean}
   * @readonly
   */
  canUndo: {
    get: function () {
      return this._undoStack.length > 0;
    },
  },

  /**
   * Whether there are commands that can be redone.
   * @memberof UndoManager.prototype
   * @type {boolean}
   * @readonly
   */
  canRedo: {
    get: function () {
      return this._redoStack.length > 0;
    },
  },

  /**
   * Event raised when the undo/redo state changes. No arguments.
   * @memberof UndoManager.prototype
   * @type {Event}
   * @readonly
   */
  changed: {
    get: function () {
      return this._changed;
    },
  },

  /**
   * Number of commands on the undo stack.
   * @memberof UndoManager.prototype
   * @type {number}
   * @readonly
   */
  undoCount: {
    get: function () {
      return this._undoStack.length;
    },
  },

  /**
   * Number of commands on the redo stack.
   * @memberof UndoManager.prototype
   * @type {number}
   * @readonly
   */
  redoCount: {
    get: function () {
      return this._redoStack.length;
    },
  },
});

/**
 * Executes a command and pushes it onto the undo stack.
 * Clears the redo stack.
 *
 * @param {object} command An object with `execute()` and `undo()` methods.
 *   Optionally includes a `name` string for debugging.
 */
UndoManager.prototype.execute = function (command) {
  command.execute();

  this._undoStack.push(command);

  // Enforce max stack size
  if (this._undoStack.length > this._maxStackSize) {
    this._undoStack.shift();
  }

  // New action clears the redo stack
  this._redoStack.length = 0;

  this._changed.raiseEvent();
};

/**
 * Undoes the most recent command.
 */
UndoManager.prototype.undo = function () {
  if (this._undoStack.length === 0) {
    return;
  }

  const command = this._undoStack.pop();
  command.undo();
  this._redoStack.push(command);

  this._changed.raiseEvent();
};

/**
 * Redoes the most recently undone command.
 */
UndoManager.prototype.redo = function () {
  if (this._redoStack.length === 0) {
    return;
  }

  const command = this._redoStack.pop();
  command.execute();
  this._undoStack.push(command);

  this._changed.raiseEvent();
};

/**
 * Clears both undo and redo stacks.
 */
UndoManager.prototype.clear = function () {
  this._undoStack.length = 0;
  this._redoStack.length = 0;
  this._changed.raiseEvent();
};

UndoManager.prototype.isDestroyed = function () {
  return false;
};

UndoManager.prototype.destroy = function () {
  this.clear();
  return destroyObject(this);
};

export default UndoManager;
