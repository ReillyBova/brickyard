/**
 * Worker message protocol. Contract file — see docs/ARCHITECTURE.md.
 *
 * GitHub Pages cannot set COOP/COEP headers, so the page is not cross-origin
 * isolated and SharedArrayBuffer is unavailable. All traffic is postMessage with
 * transferable typed arrays; there is no shared memory.
 */

import type { PartDef } from '../snap/types';
import type { BrickInstance, ConnectionEdge } from '../model/types';
import type { PartGeometry } from '../ldraw/types';

export type WorkerRequest =
  | { id: number; kind: 'resolvePart'; partId: string }
  | { id: number; kind: 'parseModel'; text: string; name: string }
  | { id: number; kind: 'solveGraph'; bricks: BrickInstance[] };

export type WorkerResponse =
  | { id: number; ok: true; kind: 'resolvePart'; part: PartDef; geometry: PartGeometry }
  | { id: number; ok: true; kind: 'parseModel'; bricks: BrickInstance[]; partIds: string[] }
  | { id: number; ok: true; kind: 'solveGraph'; edges: ConnectionEdge[] }
  | { id: number; ok: false; error: string }
  /** 0..1, for long jobs. */
  | { id: number; progress: number };
