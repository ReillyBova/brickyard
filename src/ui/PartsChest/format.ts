/**
 * Display formatting for a part's real LDraw title. `part.title` itself stays the raw
 * string (whitespace already normalised by `tools/build-chest-catalog.ts`, but still
 * LDraw's own "2 x 4" spelling) so search keeps matching what a user actually types;
 * this is purely presentational, used only where the title is rendered.
 *
 * Judgement call: dimensions render with a proper multiplication sign ("Brick 2 × 4"
 * rather than "Brick 2 x 4") — LDraw titles spell it with a lowercase x because the
 * format predates Unicode-safe tooling, not because "x" is the intended glyph, and "×"
 * reads as a dimension rather than a stray letter at tile size.
 */
export function displayTitle(title: string): string {
  return title.replace(/(\d)\s*x\s*(\d)/gi, '$1 × $2');
}
