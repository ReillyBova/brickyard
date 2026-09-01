/**
 * Save / Open / Export / Import as `ToolbarAction`s, per docs/ROADMAP.md's "Save and
 * load". Save and Open round-trip the app's own `.json` format losslessly
 * (`src/model/serialize.ts`: ids, groups and the connection graph all survive). Export
 * and Import cross to `.ldr`/`.mpd` for Studio, LeoCAD and LDView — lossy by the format's
 * own nature, so Export's status message says so rather than pretending otherwise.
 */
import { useState } from 'react';

import { importModel } from '../omr/importModel';
import { createHttpReader } from '../../ldraw/httpReader';
import { parseDocument, stringifyDocument, toLdr } from '../../model/serialize';
import type { ToolbarSession } from '../../ui/toolbar/session';
import type { ToolbarAction } from '../../ui/toolbar/types';
import { FileDownIcon, FileUpIcon, FolderOpenIcon, SaveIcon } from '../../ui/icons';
import { downloadText, pickTextFile } from './fileIO';
import { resolveDocumentParts } from './partResolve';

export type FileStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string; progress?: number }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string };

export interface UseFileActionsResult {
  actions: readonly [save: ToolbarAction, open: ToolbarAction, exportLdr: ToolbarAction, importLdr: ToolbarAction];
  status: FileStatus;
  dismissStatus: () => void;
}

/**
 * `markSaved` is threaded in rather than this hook owning a `useDirty` itself, because
 * Open needs to reset the same dirty baseline Save does — a freshly opened document has
 * nothing unsaved yet, the same way opening a file in any editor doesn't leave it dirty.
 * Import doesn't call it: it merges into whatever is already loaded (see
 * `EditorSession.mergeDocument`), which is an edit like any other and should leave the
 * document dirty.
 */
export function useFileActions(session: ToolbarSession | null, markSaved: () => void): UseFileActionsResult {
  const [status, setStatus] = useState<FileStatus>({ kind: 'idle' });
  const busy = status.kind === 'busy';

  const save: ToolbarAction = {
    id: 'save',
    icon: <SaveIcon />,
    label: 'Save',
    shortcut: ['⌘', 'S'],
    disabled: !session,
    onClick: () => {
      if (!session) return;
      try {
        downloadText('brickyard-model.json', stringifyDocument(session.document));
        markSaved();
        setStatus({ kind: 'info', message: 'Saved brickyard-model.json.' });
      } catch (err) {
        setStatus({ kind: 'error', message: `Couldn't save: ${String(err)}` });
      }
    },
  };

  const open: ToolbarAction = {
    id: 'open',
    icon: <FolderOpenIcon />,
    label: 'Open',
    disabled: !session || busy,
    onClick: () => {
      if (!session) return;
      void (async () => {
        const picked = await pickTextFile('.json,application/json');
        if (!picked) return;
        setStatus({ kind: 'busy', label: 'Opening', progress: 0 });
        try {
          const doc = parseDocument(picked.text);
          const parts = await resolveDocumentParts(doc, {
            onProgress: (progress) => setStatus({ kind: 'busy', label: 'Opening', progress }),
          });
          session.loadDocument(doc, parts.values());
          markSaved();
          setStatus({ kind: 'info', message: `Opened ${picked.name}.` });
        } catch (err) {
          setStatus({ kind: 'error', message: `Couldn't open ${picked.name}: ${String(err)}` });
        }
      })();
    },
  };

  const exportLdr: ToolbarAction = {
    id: 'export-ldr',
    icon: <FileDownIcon />,
    label: 'Export .ldr',
    disabled: !session,
    onClick: () => {
      if (!session) return;
      try {
        downloadText('brickyard-model.ldr', toLdr(session.document, { name: 'BrickYard model' }), 'text/plain');
        setStatus({
          kind: 'info',
          message: 'Exported brickyard-model.ldr for Studio, LeoCAD or LDView — reimporting it will mint new ids and drop groups.',
        });
      } catch (err) {
        setStatus({ kind: 'error', message: `Couldn't export: ${String(err)}` });
      }
    },
  };

  const importLdr: ToolbarAction = {
    id: 'import-ldr',
    icon: <FileUpIcon />,
    label: 'Import model',
    disabled: !session || busy,
    onClick: () => {
      if (!session) return;
      void (async () => {
        const picked = await pickTextFile('.ldr,.mpd,.dat');
        if (!picked) return;
        setStatus({ kind: 'busy', label: 'Importing', progress: 0 });
        try {
          const read = createHttpReader();
          const result = await importModel(picked.text, picked.name, {
            read,
            onProgress: (progress) => setStatus({ kind: 'busy', label: 'Importing', progress }),
          });
          // Adds alongside whatever is already in the document rather than replacing
          // it — importing a second model is bringing in more content, not starting
          // over the way Open is. See EditorSession.mergeDocument. Unlike Open, this
          // doesn't call markSaved(): it's an edit against whatever was already
          // loaded, so it leaves the document exactly as dirty as any other commit
          // would.
          session.mergeDocument(result.document, result.partDefs.values());
          setStatus({ kind: 'info', message: `Imported ${picked.name}: ${result.brickCount} bricks.` });
        } catch (err) {
          setStatus({ kind: 'error', message: `Couldn't import ${picked.name}: ${String(err)}` });
        }
      })();
    },
  };

  return {
    actions: [save, open, exportLdr, importLdr],
    status,
    dismissStatus: () => setStatus({ kind: 'idle' }),
  };
}
