import { useState } from 'react';

import { AppShell } from './ui/AppShell/AppShell';
import { ColorPicker } from './ui/ColorPicker/ColorPicker';
import { MOCK_COLORS } from './ui/ColorPicker/mockColors';
import { PartsChest } from './ui/PartsChest/PartsChest';
import { MOCK_PARTS } from './ui/PartsChest/mockParts';

/**
 * Composition root. Owns the only state in the UI slice — which part and colour are
 * selected — as plain `useState`; the document store connects here once it exists.
 * Everything below is built and verified against mock data, per docs/AGENTS.md: this
 * slice must not depend on `src/scene/`, `src/model/`, or `src/ldraw/` internals.
 */
function App() {
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>(undefined);
  const [selectedColorCode, setSelectedColorCode] = useState<number | undefined>(undefined);

  return (
    <AppShell
      chestPanel={
        <PartsChest parts={MOCK_PARTS} selectedId={selectedPartId} onSelect={setSelectedPartId} />
      }
      colorPanel={
        <ColorPicker
          colors={MOCK_COLORS}
          selectedCode={selectedColorCode}
          onSelect={setSelectedColorCode}
        />
      }
    />
  );
}

export default App;
