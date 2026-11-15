import { Button } from '@/components/ui/button';

import { noteLabel } from './notes';
import type { StringSet } from './strings';

/** The track's strings from the lowest, the auto-picked one marked, a click pinning another. */
export function StringPicker({
  set,
  highlighted,
  override,
  onSelect,
}: {
  set: StringSet;
  /** The string the meter measures against: the pick, or what auto settled on. */
  highlighted: number | undefined;
  override: number | undefined;
  onSelect: (string: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          Strings{set.tuningName ? ` · ${set.tuningName}` : ''}
        </span>
        {set.capo > 0 && (
          <span className="text-muted-foreground text-xs">Capo {String(set.capo)}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Strings">
        {set.targets.map((target) => {
          const note = noteLabel(target.midi);
          const pressed = target.string === highlighted;
          return (
            <Button
              key={target.string}
              size="sm"
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              aria-label={`String ${String(target.string)}, ${note.text}`}
              className="h-9 min-w-11 flex-col gap-0 px-2 leading-tight"
              onClick={() => {
                onSelect(target.string);
              }}
            >
              <span>{note.text}</span>
              <span className="text-[0.65rem] font-normal opacity-70">{target.string}</span>
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={override === undefined ? 'secondary' : 'outline'}
          aria-pressed={override === undefined}
          className="h-9"
          onClick={() => {
            onSelect(undefined);
          }}
        >
          Auto
        </Button>
      </div>
    </div>
  );
}
