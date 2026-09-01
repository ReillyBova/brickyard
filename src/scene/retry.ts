/**
 * A small bounded retry wrapper, used around individual part-geometry fetches.
 *
 * Part of the Colosseum finding: 11,725 of 20,725 bricks (57%) failed geometry loading
 * with 404s from the upstream mirror, and failed *silently* — the rejection was never
 * awaited (`EditorSession.reconcile` fires `void this.scene.addBrick(brick)`), so the
 * piece just never appeared, with nothing in the console or the UI to say so. A retry
 * does not fix a genuinely missing upstream file, but it does help the fraction of
 * failures that are transient (a dropped connection, a momentary mirror hiccup under the
 * burst of requests a big model creates) — cheap, and worth doing regardless. The other
 * half of that finding — turning a swallowed rejection into a counted, logged one — is in
 * `SceneRenderer.addBrick`, not here.
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  attempts: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
