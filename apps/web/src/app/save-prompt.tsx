import { useStore } from 'zustand';

import type { SaveAnswer } from '@/state/document';

import { LossDialog } from './loss-dialog';
import { useAppServices } from './services-context';

const count = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

export function SavePromptDialog() {
  const { document } = useAppServices();
  const prompt = useStore(document, (state) => state.savePrompt);
  const answer = (value: SaveAnswer) => {
    document.getState().answerSavePrompt(value);
  };
  if (prompt === undefined) return null;
  return (
    <LossDialog
      open
      title={`Save ${prompt.fileName}?`}
      description={`Guitar Pro 7–8 files can't hold ${count(prompt.losses.length, 'thing')} in this score, and saving overwrites the original.`}
      losses={prompt.losses}
      choices={[{ value: 'overwrite', label: 'Save', primary: true }]}
      cancel="cancel"
      onChoose={answer}
    />
  );
}
