import { AxonBrick } from '../AxonBrick';
import { studsForTitle } from '../brickPictogram';
import type { ThumbnailSource } from '../../scene/thumbnail';
import { displayTitle } from './format';
import { usePartThumbnail } from './usePartThumbnail';
import type { ChestPart } from './types';

interface PartTileProps {
  part: ChestPart;
  index: number;
  isSelected: boolean;
  isRound: boolean;
  activeColorHex: string;
  thumbnailSource: ThumbnailSource | undefined;
  onSelect: (id: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>, index: number) => void;
}

/**
 * One chest tile. Split out from `PartsChest` because `usePartThumbnail` is a hook —
 * every tile needs its own call, which the list `.map()` in the parent can't do inline.
 *
 * Shows the real rendered part (`RuntimeThumbnailRenderer`, in `activeColorHex`) once it
 * resolves; the `AxonBrick` pictogram covers the gap before that first render lands
 * (usually low tens of milliseconds — see `docs/DESIGN.md` rule 7, this isn't a spinner,
 * it's a known placeholder standing in for a known-fast fetch) and stands in permanently
 * when no thumbnail source is wired in (Storybook, tests) or a part fails to load.
 */
export function PartTile({
  part,
  index,
  isSelected,
  isRound,
  activeColorHex,
  thumbnailSource,
  onSelect,
  onKeyDown,
}: PartTileProps) {
  const thumbnail = usePartThumbnail(thumbnailSource, part.id, activeColorHex);

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={`by-tile${isSelected ? ' is-selected' : ''}`}
      data-index={index}
      title={part.title}
      onClick={() => onSelect(part.id)}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      <span className="by-tile__thumb">
        {thumbnail.status === 'ready' && thumbnail.url !== undefined ? (
          <img src={thumbnail.url} alt="" width={52} height={52} />
        ) : (
          <AxonBrick hex={activeColorHex} studs={studsForTitle(part.title)} round={isRound} />
        )}
      </span>
      <span className="by-tile__title">{displayTitle(part.title)}</span>
      <span className="by-tile__label">{part.id}</span>
    </button>
  );
}
