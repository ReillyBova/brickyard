/**
 * `/` — the front door. Two ways in, per `docs/SPEC.md`: an empty baseplate to build
 * from scratch, or a published model to take apart (the picker behind that second link
 * is a placeholder for now, `src/routes/ModelPicker.tsx`).
 *
 * CSS and SVG only — no three.js scene here, so the page is instant. The one hand-drawn
 * mark settles into place with `--by-ease-snap`'s overshoot and then drifts gently, per
 * docs/DESIGN.md's Motion section; `prefers-reduced-motion` removes all of it in
 * `Landing.css`, both via the token collapse and via an explicit override so nothing
 * here can bypass it.
 */
import { BrickMark } from './BrickMark';
import './Landing.css';
import { Link } from '../../routes/Link';

export function Landing() {
  return (
    <main className="by-landing">
      <div className="by-landing__hero">
        <div className="by-landing__lockup">
          <BrickMark />
          <h1 className="by-landing__wordmark">BrickYard</h1>
        </div>

        <p className="by-landing__tagline">
          A browser-based brick building canvas. Pieces snap together the way real bricks do.
        </p>

        <div className="by-landing__actions">
          <Link to="sandbox" className="by-btn by-btn--primary by-btn--lg by-landing__cta">
            Sandbox
          </Link>
          <Link to="models" className="by-btn by-btn--secondary by-btn--lg by-landing__cta">
            Load a model
          </Link>
        </div>

        <p className="by-landing__hint by-muted">
          Sandbox opens an empty baseplate. Load a model opens a published model to take apart.
        </p>
      </div>
    </main>
  );
}
