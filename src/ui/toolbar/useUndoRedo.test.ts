/**
 * Pure logic tests for `handleGlobalUndoRedoKeydown` — the window-level ⌘Z/⌘⇧Z/⌘Y
 * decision `useUndoRedo` wires up as a `keydown` listener. Exercised directly, without
 * mounting React or a DOM: this project's test environment is Node, not jsdom (see
 * `vite.config.ts`), and this function needs neither — it's a pure decision over a
 * plain event-shaped object.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { handleGlobalUndoRedoKeydown, type UndoRedoKeyEvent } from './useUndoRedo';

function keyEvent(overrides: Partial<UndoRedoKeyEvent> = {}): UndoRedoKeyEvent {
  return {
    target: null,
    // Both set so the test is independent of the host platform's navigator.platform
    // (handleGlobalUndoRedoKeydown reads metaKey on Mac, ctrlKey elsewhere).
    metaKey: true,
    ctrlKey: true,
    shiftKey: false,
    key: 'z',
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe('handleGlobalUndoRedoKeydown', () => {
  it('undoes on Ctrl/Cmd+Z when the event did not target the canvas', () => {
    const session = { undo: vi.fn(), redo: vi.fn() };
    handleGlobalUndoRedoKeydown(keyEvent(), session);
    expect(session.undo).toHaveBeenCalledTimes(1);
    expect(session.redo).not.toHaveBeenCalled();
  });

  it('redoes on Ctrl/Cmd+Shift+Z and on Ctrl/Cmd+Y', () => {
    const session = { undo: vi.fn(), redo: vi.fn() };
    handleGlobalUndoRedoKeydown(keyEvent({ shiftKey: true }), session);
    handleGlobalUndoRedoKeydown(keyEvent({ key: 'y', shiftKey: false }), session);
    expect(session.redo).toHaveBeenCalledTimes(2);
    expect(session.undo).not.toHaveBeenCalled();
  });

  it('does nothing when the event targeted the canvas — BuilderCanvas already handled it', () => {
    const session = { undo: vi.fn(), redo: vi.fn() };
    handleGlobalUndoRedoKeydown(keyEvent({ target: { tagName: 'CANVAS' } }), session);
    expect(session.undo).not.toHaveBeenCalled();
    expect(session.redo).not.toHaveBeenCalled();
  });

  it('does nothing without the modifier key', () => {
    const session = { undo: vi.fn(), redo: vi.fn() };
    handleGlobalUndoRedoKeydown(keyEvent({ ctrlKey: false, metaKey: false }), session);
    expect(session.undo).not.toHaveBeenCalled();
  });
});

describe('canvas/toolbar undo-redo composition', () => {
  it('undo fires exactly once for one Ctrl/Cmd+Z keystroke with the canvas focused', () => {
    // BuilderCanvas.tsx binds the same combo scoped to its own <canvas> element and
    // never calls stopPropagation — asserted by placement.test.ts's "never stops
    // propagation on its keydown handler" — so one physical keystroke reaches BOTH
    // BuilderCanvas's own canvas-level handler and this module's window-level one, in
    // that order. BuilderCanvas calling session.undo() once when Ctrl+Z is pressed
    // while it's focused is that file's own contract and is covered by its own tests,
    // not re-derived here (`session.undo()` below stands in for it). What this test
    // protects is the other half, owned by this file: that the window-level handler
    // declines to fire a *second* time for the very same keystroke.
    const session = { undo: vi.fn(), redo: vi.fn() };
    const canvasTarget = { tagName: 'CANVAS' };

    // 1. BuilderCanvas's own canvas-scoped handler fires first (real behaviour, stood
    //    in for here since it isn't exported — see the source-shape check below).
    session.undo();

    // 2. The event bubbles to `window` unstopped; this module's handler sees it too and
    //    must not call undo again because its target is the canvas.
    handleGlobalUndoRedoKeydown(keyEvent({ target: canvasTarget }), session);

    expect(session.undo).toHaveBeenCalledTimes(1);
  });

  it("targets a real <canvas> element, so this module's tagName check is meaningful", () => {
    const source = readFileSync(new URL('../../scene/interaction/BuilderCanvas.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/<canvas\b/);
  });
});
