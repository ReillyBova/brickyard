/**
 * `/models` — a placeholder. The real picker lists published models from the LDraw
 * Official Model Repository (`docs/SPEC.md`); that's a separate workstream. This route
 * exists so the link from the landing page and deep-links to `/models` both resolve
 * to something honest about its own state, per docs/DESIGN.md's rule that empty states
 * name the next move rather than apologize.
 */
import { Link } from './Link';
import './ModelPicker.css';

export function ModelPicker() {
  return (
    <div className="by-model-picker">
      <div className="by-empty">
        <p className="by-empty__title">Model picker isn&rsquo;t wired up yet</p>
        <p className="by-empty__body">
          This will list published models from the LDraw repository, ready to open and take apart.
          For now, start from an empty baseplate instead.
        </p>
        <Link to="sandbox" className="by-btn by-btn--primary by-model-picker__back">
          Go to sandbox
        </Link>
      </div>
    </div>
  );
}
