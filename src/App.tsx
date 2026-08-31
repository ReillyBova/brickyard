import { useMemo, useState } from 'react';

import { SceneCanvas } from './scene/index.ts';
import { AppShell } from './ui/AppShell/AppShell';
import { ColorPicker } from './ui/ColorPicker/ColorPicker';
import { LDRAW_PALETTE } from './ui/ColorPicker/palette';
import { PartsChest } from './ui/PartsChest/PartsChest';
import { MOCK_PARTS } from './ui/PartsChest/mockParts';

/** LDraw 4 — classic brick red — so the chest always has a real active color to preview. */
const DEFAULT_COLOR_CODE = 4;

/**
 * Composition root. Owns the only state in the UI slice — which part and color are
 * selected — as plain `useState`; the document store connects here once it exists.
 * Everything below is built and verified against mock data, per docs/AGENTS.md: this
 * slice must not depend on `src/scene/` or `src/model/` internals. It does depend on
 * `src/ldraw/colors.ts` for the real LDraw palette (`ui/ColorPicker/palette.ts`) — a
 * pure parser over a committed fixture, not a runtime dependency on the ldraw slice's
 * fetch/cache machinery.
 */
function App() {
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>(undefined);
  const [selectedColorCode, setSelectedColorCode] = useState<number>(DEFAULT_COLOR_CODE);

  const activeColor = useMemo(
    () => LDRAW_PALETTE.find((color) => color.code === selectedColorCode) ?? LDRAW_PALETTE[0],
    [selectedColorCode],
  );

  return (
    <AppShell
      viewport={<SceneCanvas />}
      chestPanel={
        <PartsChest
          parts={MOCK_PARTS}
          selectedId={selectedPartId}
          onSelect={setSelectedPartId}
          activeColorHex={activeColor.hex}
        />
      }
      colorPanel={
        <ColorPicker colors={LDRAW_PALETTE} selectedCode={selectedColorCode} onSelect={setSelectedColorCode} />
      }
    />
  );
}

export default App;
