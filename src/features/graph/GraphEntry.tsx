/**
 * The graph feature's entry control. A floating icon button, mounted once at the
 * composition root (see `src/App.tsx`) so it's reachable from every route — a real
 * toolbar with a reserved slot for it is being built in parallel; this is the
 * placeholder until that lands, per the task that scoped this slice.
 */
import { useState } from 'react';

import { GraphExplorer } from './GraphExplorer';
import { GraphIcon } from './icons';
import './GraphEntry.css';

export function GraphEntry() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="by-graph-entry">
        <button
          type="button"
          className="by-icon-btn"
          aria-label="Show the connection graph"
          title="Show the connection graph"
          onClick={() => setOpen(true)}
        >
          <GraphIcon />
        </button>
      </div>
      {open && <GraphExplorer onClose={() => setOpen(false)} />}
    </>
  );
}
