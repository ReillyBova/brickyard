import { useMemo, useState } from 'react';

import { AppRouter } from './routes/AppRouter';
import { RouteProvider } from './routes/router';
import { BuilderCanvas } from './scene/interaction/BuilderCanvas.tsx';
import { RuntimeThumbnailRenderer } from './scene/thumbnail.ts';
import { AppShell } from './ui/AppShell/AppShell';
import { ColorPicker } from './ui/ColorPicker/ColorPicker';
import { LDRAW_PALETTE } from './ui/ColorPicker/palette';
import { PartsChest } from './ui/PartsChest/PartsChest';
import { PART_CATALOG } from './ui/PartsChest/catalog';

/** LDraw 4 — classic brick red — so the chest always has a real active color to preview. */
const DEFAULT_COLOR_CODE = 4;

/**
 * The `/sandbox` route. Owns the only state in the UI slice — which part and color are
 * selected — as plain `useState`; the document store connects here once it exists.
 * Everything below is built and verified against mock data, per docs/AGENTS.md: this
 * slice must not depend on `src/scene/` or `src/model/` internals. It does depend on
 * `src/ldraw/colors.ts` for the real LDraw palette (`ui/ColorPicker/palette.ts`) — a
 * pure parser over a committed fixture, not a runtime dependency on the ldraw slice's
 * fetch/cache machinery.
 */
function SandboxEditor() {
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>(undefined);
  const [selectedColorCode, setSelectedColorCode] = useState<number>(DEFAULT_COLOR_CODE);

  // One offscreen renderer for the whole session — see src/scene/thumbnail.ts. Built once
  // via useMemo rather than per render, since it owns a WebGL context.
  const thumbnailSource = useMemo(() => new RuntimeThumbnailRenderer(), []);

  const activeColor = useMemo(
    () => LDRAW_PALETTE.find((color) => color.code === selectedColorCode) ?? LDRAW_PALETTE[0],
    [selectedColorCode],
  );

  return (
    <AppShell
      viewport={<BuilderCanvas />}
      chestPanel={
        <PartsChest
          parts={PART_CATALOG}
          selectedId={selectedPartId}
          onSelect={setSelectedPartId}
          activeColorHex={activeColor.hex}
          thumbnailSource={thumbnailSource}
        />
      }
      colorPanel={
        <ColorPicker colors={LDRAW_PALETTE} selectedCode={selectedColorCode} onSelect={setSelectedColorCode} />
      }
    />
  );
}

/**
 * Composition root. Mounts the hand-rolled router (`src/routes/`) and hands it the
 * sandbox editor as a prop, so the routing slice never imports `src/scene/` or
 * `src/model/` directly — see `src/routes/AppRouter.tsx`.
 */
function App() {
  return (
    <RouteProvider>
      <AppRouter sandbox={<SandboxEditor />} />
    </RouteProvider>
  );
}

export default App;
