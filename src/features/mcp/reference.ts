/**
 * Lookups over the parts catalog and the reference corpus.
 *
 * Two different questions. "What part is a 1x2 plate?" is answered from the catalog,
 * which is committed data. "How do published models attach a wing?" is answered from
 * the step-decomposed corpus described in `docs/MCP.md` — published models carry
 * `0 STEP`, so each step is a set of bricks and the edges they formed, which is
 * idiomatic construction in the same representation the tools speak.
 *
 * The corpus is supplied by the adapter. Without one, `lookup` says so rather than
 * inventing an answer, and every other tool keeps working.
 *
 * Pure: no three.js imports, no DOM.
 */

export interface CatalogEntry {
  id: string;
  title: string;
  category: string;
}

export interface ReferenceExample {
  /** Where it came from, e.g. a published model name. */
  source: string;
  /** What the step accomplishes, from its own metadata where present. */
  step: string;
  parts: readonly string[];
  /** How the added bricks join what was already there. */
  connections: readonly { kind: string; count: number }[];
}

export interface ReferenceCorpus {
  lookup(query: string, limit: number): Promise<readonly ReferenceExample[]>;
}

export interface ReferenceLookup {
  searchParts(query: string, limit: number): readonly CatalogEntry[];
  lookup(query: string, limit: number): Promise<readonly ReferenceExample[]>;
  /** Whether a corpus is attached. Without one, `lookup` has nothing to answer from. */
  readonly hasCorpus: boolean;
}

/**
 * Rank by where the match lands: a part whose title starts with the query is a better
 * answer than one that merely contains it, and both beat a category-only match.
 */
function score(entry: CatalogEntry, terms: readonly string[]): number {
  const title = entry.title.toLowerCase();
  const category = entry.category.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (entry.id.toLowerCase() === term) total += 8;
    else if (title.startsWith(term)) total += 4;
    else if (title.includes(term)) total += 2;
    else if (category.includes(term)) total += 1;
    else return 0; // Every term must land somewhere.
  }
  return total;
}

export function createReference(
  catalog: readonly CatalogEntry[],
  corpus?: ReferenceCorpus,
): ReferenceLookup {
  return {
    hasCorpus: corpus !== undefined,

    searchParts(query, limit) {
      const terms = query
        .toLowerCase()
        // 'plate 1x2' and 'plate 1 x 2' should find the same part.
        .replace(/(\d)\s*x\s*(\d)/g, '$1 x $2')
        .split(/\s+/)
        .filter((t) => t !== '');
      if (terms.length === 0) return catalog.slice(0, limit);

      return catalog
        .map((entry) => ({ entry, rank: score(entry, terms) }))
        .filter((r) => r.rank > 0)
        .sort((a, b) => b.rank - a.rank || a.entry.title.localeCompare(b.entry.title))
        .slice(0, limit)
        .map((r) => r.entry);
    },

    async lookup(query, limit) {
      if (!corpus) return [];
      return corpus.lookup(query, limit);
    },
  };
}
