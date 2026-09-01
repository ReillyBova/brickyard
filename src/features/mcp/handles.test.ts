import { describe, expect, it } from 'vitest';

import { mintBrickId } from '../../model/ids.ts';
import { HandleTable, slugFor } from './handles.ts';

describe('slugFor', () => {
  it('collapses LDraw dimension spacing into one token', () => {
    expect(slugFor('3001', 'Brick  2 x  4')).toBe('brick-2x4');
    expect(slugFor('3623', 'Plate 1 x 3')).toBe('plate-1x3');
  });

  it('falls back to the part number when there is no usable title', () => {
    expect(slugFor('3001')).toBe('part-3001');
    expect(slugFor('3001', '   ')).toBe('part-3001');
    expect(slugFor('3001', '///')).toBe('part-3001');
  });
});

describe('HandleTable', () => {
  it('numbers bricks of the same part in placement order', () => {
    const table = new HandleTable();
    const a = mintBrickId();
    const b = mintBrickId();

    expect(table.assign(a, '3001', 'Brick  2 x  4')).toBe('brick-2x4-1');
    expect(table.assign(b, '3001', 'Brick  2 x  4')).toBe('brick-2x4-2');
  });

  it('counts each part separately', () => {
    const table = new HandleTable();
    expect(table.assign(mintBrickId(), '3001', 'Brick 2 x 4')).toBe('brick-2x4-1');
    expect(table.assign(mintBrickId(), '3023', 'Plate 1 x 2')).toBe('plate-1x2-1');
  });

  it('is idempotent, so replaying a document does not renumber it', () => {
    const table = new HandleTable();
    const brick = mintBrickId();
    const first = table.assign(brick, '3001', 'Brick 2 x 4');
    expect(table.assign(brick, '3001', 'Brick 2 x 4')).toBe(first);
    expect(table.size).toBe(1);
  });

  it('never reuses an ordinal, so a stale handle fails rather than aliasing', () => {
    const table = new HandleTable();
    const first = mintBrickId();
    const second = mintBrickId();
    table.assign(first, '3001', 'Brick 2 x 4');
    const secondHandle = table.assign(second, '3001', 'Brick 2 x 4');
    table.release(second);

    const third = table.assign(mintBrickId(), '3001', 'Brick 2 x 4');
    expect(third).toBe('brick-2x4-3');
    expect(table.resolve(secondHandle)).toBeUndefined();
  });

  it('resolves handles and raw ids alike', () => {
    const table = new HandleTable();
    const brick = mintBrickId();
    const handle = table.assign(brick, '3001', 'Brick 2 x 4');

    expect(table.resolve(handle)).toBe(brick);
    expect(table.resolve(brick)).toBe(brick);
    expect(table.resolve('brick-2x4-99')).toBeUndefined();
  });
});
