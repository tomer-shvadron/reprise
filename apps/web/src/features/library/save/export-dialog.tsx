import type { Warning } from '@reprise/formats';
import { useState } from 'react';
import { useStore } from 'zustand';

import { LossDialog } from '@/app/loss-dialog';
import { useAppServices } from '@/app/services-context';

import { libraryOf } from '../library';

type Choice = 'export' | 'cancel';

const count = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

function Prompt({
  fileName,
  losses,
  canRemember,
  answer,
}: {
  fileName: string;
  losses: readonly Warning[];
  canRemember: boolean;
  answer: (choice: Choice, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <LossDialog<Choice>
      open
      title={`Export ${fileName}?`}
      description={`Guitar Pro 7–8 files can't hold ${count(losses.length, 'thing')} in this score. Exporting writes a copy and leaves your song as it is.`}
      losses={losses}
      choices={[{ value: 'export', label: 'Export', primary: true }]}
      cancel="cancel"
      onChoose={(choice) => {
        answer(choice, remember);
      }}
    >
      {canRemember && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
          Don’t warn again for this song
        </label>
      )}
    </LossDialog>
  );
}

/** Asks before Export as Guitar Pro writes a file that cannot hold everything; mounted once. */
export function ExportDialog() {
  const { exportPrompt } = libraryOf(useAppServices());
  const { prompt, answer } = useStore(exportPrompt);
  if (!prompt || !answer) return null;
  return (
    <Prompt
      fileName={prompt.fileName}
      losses={prompt.dropped}
      canRemember={prompt.canRemember}
      answer={(choice, remember) => {
        answer(choice === 'export' ? { choice, remember } : { choice });
      }}
    />
  );
}
