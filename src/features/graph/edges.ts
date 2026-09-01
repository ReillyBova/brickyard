/**
 * Classifies every edge in a document's graph the way `docs/ARCHITECTURE.md` defines
 * direction: `out` is what a brick supports, `in` is what supports it. An edge with a
 * gendered side becomes a `directed` edge from the supporter to the supported; an edge
 * with no gendered side (hinge fingers, symmetric general connections) becomes `peer`.
 *
 * Pure: no three.js imports, no DOM. Feature-owned, not a frozen contract.
 */
import type { BrickId, EdgeId } from '../../types';
import type { SceneDocument } from '../../model/types';

export type ClassifiedEdge =
  | { kind: 'directed'; id: EdgeId; from: BrickId; to: BrickId }
  | { kind: 'peer'; id: EdgeId; a: BrickId; b: BrickId };

export function classifyEdges(doc: SceneDocument): readonly ClassifiedEdge[] {
  const { graph } = doc;
  const result: ClassifiedEdge[] = [];

  for (const edge of graph.edges.values()) {
    const aOut = graph.nodes.get(edge.a)?.out.includes(edge.id) ?? false;
    const bOut = graph.nodes.get(edge.b)?.out.includes(edge.id) ?? false;

    if (aOut) result.push({ kind: 'directed', id: edge.id, from: edge.a, to: edge.b });
    else if (bOut) result.push({ kind: 'directed', id: edge.id, from: edge.b, to: edge.a });
    else result.push({ kind: 'peer', id: edge.id, a: edge.a, b: edge.b });
  }

  return result;
}
