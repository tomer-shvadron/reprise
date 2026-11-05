import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type {
  EventChannel,
  EventChannels,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
} from '@reprise/web';

import { parsers, type Parsers } from './validate';

export type InvokeHandlers = {
  [C in InvokeChannel]: (
    event: IpcMainInvokeEvent,
    ...args: InvokeArgs<C>
  ) => Promise<InvokeResult<C>>;
};

function register<C extends InvokeChannel>(
  channel: C,
  parse: Parsers[C],
  handle: InvokeHandlers[C],
  isTrusted: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(channel, (event, ...raw: unknown[]) => {
    if (!isTrusted(event)) throw new Error(`Rejected ${channel} from an untrusted frame`);
    return handle(event, ...parse(raw));
  });
}

/** Registers every channel of the map: the handlers object must name each one to typecheck. */
export function registerInvokeHandlers(
  handlers: InvokeHandlers,
  isTrusted: (event: IpcMainInvokeEvent) => boolean,
): void {
  let channel: InvokeChannel;
  for (channel in parsers) register(channel, parsers[channel], handlers[channel], isTrusted);
}

export function sendEvent<C extends EventChannel>(
  contents: WebContents,
  channel: C,
  ...args: EventChannels[C]
): void {
  contents.send(channel, ...args);
}
