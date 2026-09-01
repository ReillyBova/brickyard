import { describe, expect, it } from 'vitest';

import { createDocument } from '../../model/document.ts';
import { applyOperation } from '../../model/operations.ts';
import { mintBrickId } from '../../model/ids.ts';
import type { BrickInstance } from '../../model/types';
import { createDirtyTracker } from './dirty.ts';

const brick = (): BrickInstance => ({
  id: mintBrickId(),
  partId: '3001',
  colorCode: 4,
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});

describe('createDirtyTracker', () => {
  it('starts clean against the document it was built with', () => {
    const doc = createDocument([]);
    const tracker = createDirtyTracker(doc);
    expect(tracker.isDirty(doc)).toBe(false);
  });

  it('goes dirty once the document changes', () => {
    const doc = createDocument([]);
    const tracker = createDirtyTracker(doc);
    const next = applyOperation(doc, { type: 'add', bricks: [brick()] });
    expect(tracker.isDirty(next)).toBe(true);
  });

  it('goes clean again once markSaved moves the baseline', () => {
    const doc = createDocument([]);
    const tracker = createDirtyTracker(doc);
    const next = applyOperation(doc, { type: 'add', bricks: [brick()] });
    tracker.markSaved(next);
    expect(tracker.isDirty(next)).toBe(false);
  });

  it('treats a value-equal but distinct document as dirty', () => {
    // Reference equality, not deep equality: two independently-built empty documents
    // are content-equal but not the same object, and that's meant to count as dirty —
    // the tracker never diffs content, only identity against the marker.
    const tracker = createDirtyTracker(createDocument([]));
    expect(tracker.isDirty(createDocument([]))).toBe(true);
  });
});
