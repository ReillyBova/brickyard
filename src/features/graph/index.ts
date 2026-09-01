/**
 * Barrel for the graph feature — see `docs/ROADMAP.md`'s "Graph explode". The only
 * export a caller outside this directory needs is the entry control; everything else
 * (`GraphExplodeScene`, `computeExplodeLayout`, `classifyEdges`, `computeGraphStats`)
 * is an internal.
 */
export { GraphEntry } from './GraphEntry';
