/**
 * Transaction stack and undo/redo.
 *
 * A `Transaction` is one user-visible undo step and may contain several operations.
 * Undo inverts each operation and applies them in reverse order; because operations
 * carry both sides of their change, no document state is consulted to do it.
 *
 * The history value is immutable: every call returns a new one.
 *
 * Pure: no three.js imports, no DOM.
 */

import { applyOperation, invertOperation } from './operations';
import type { Operation, SceneDocument, Transaction } from './types';

export interface History {
  doc: SceneDocument;
  /** Oldest first; the last entry is the next undo. */
  undoStack: readonly Transaction[];
  /** Oldest first; the last entry is the next redo. */
  redoStack: readonly Transaction[];
  /** Maximum undo depth. `Infinity` keeps everything. */
  limit: number;
}

export const applyTransaction = (doc: SceneDocument, tx: Transaction): SceneDocument =>
  tx.ops.reduce(applyOperation, doc);

/** Inverse of a transaction: each op inverted, in reverse order. */
export const invertTransaction = (tx: Transaction): Transaction => ({
  label: tx.label,
  ops: [...tx.ops].reverse().map(invertOperation) as readonly Operation[],
});

export const createHistory = (doc: SceneDocument, limit = Infinity): History => ({
  doc,
  undoStack: [],
  redoStack: [],
  limit,
});

const trim = (stack: readonly Transaction[], limit: number): readonly Transaction[] =>
  stack.length > limit ? stack.slice(stack.length - limit) : stack;

/**
 * Apply a transaction and push it onto the undo stack. Committing discards the redo
 * stack: a new edit after an undo forks the timeline.
 */
export const commit = (history: History, tx: Transaction): History => ({
  doc: applyTransaction(history.doc, tx),
  undoStack: trim([...history.undoStack, tx], history.limit),
  redoStack: [],
  limit: history.limit,
});

export const canUndo = (history: History): boolean => history.undoStack.length > 0;
export const canRedo = (history: History): boolean => history.redoStack.length > 0;

/** Label of the next undo step, for menu chrome. */
export const undoLabel = (history: History): string | undefined =>
  history.undoStack.at(-1)?.label;

export const redoLabel = (history: History): string | undefined =>
  history.redoStack.at(-1)?.label;

export const undo = (history: History): History => {
  const tx = history.undoStack.at(-1);
  if (!tx) return history;
  return {
    doc: applyTransaction(history.doc, invertTransaction(tx)),
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, tx],
    limit: history.limit,
  };
};

export const redo = (history: History): History => {
  const tx = history.redoStack.at(-1);
  if (!tx) return history;
  return {
    doc: applyTransaction(history.doc, tx),
    undoStack: trim([...history.undoStack, tx], history.limit),
    redoStack: history.redoStack.slice(0, -1),
    limit: history.limit,
  };
};

/** Drop both stacks, keeping the current document. */
export const clearHistory = (history: History): History => ({
  doc: history.doc,
  undoStack: [],
  redoStack: [],
  limit: history.limit,
});
