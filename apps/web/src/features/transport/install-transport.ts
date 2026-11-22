import type { AudioService } from '@/app/audio/audio-service';
import type { DocumentStore } from '@/state/document';
import type { PlaybackStore, TempoSetting } from '@/state/playback';
import {
  COUNT_IN_SETTING,
  GM_TIER_BYPASS_SETTING,
  MASTER_VOLUME_SETTING,
  MEMORY_BUDGET_SETTING,
  METRONOME_ON_SETTING,
  COUNT_IN_VOLUME_SETTING,
  METRONOME_VOLUME_SETTING,
} from '@/state/app-settings';
import type { SelectionStore } from '@/state/selection';
import type { SettingDef, SettingsStore } from '@/state/settings';

import { applyLoop } from './loop';
import { importLegacyTransportPreferences } from './preferences';
import { soundStatus } from './sound-status';
import { TEMPO_PERCENT } from './tempo';
import type { TransportUiStore } from './transport-ui';

export interface TransportDeps {
  audio: AudioService;
  playback: PlaybackStore;
  document: DocumentStore;
  selection: SelectionStore;
  transport: TransportUiStore;
  settings: SettingsStore;
  /** The pack installs, so the start of one is announced while the Sounds sheet is closed. */
  installJob?: {
    subscribe(listener: (state: { job: { name: string } | undefined }) => void): () => void;
  };
  /** Where the pre-#343 preferences blob is looked for; `localStorage` by default. */
  legacyStorage?: () => Storage;
}

/**
 * Wires the transport's rules that no control owns: the preferences between the settings store and the audio service, the speed
 * per song, and the loop following the selection and the score's edits. Returns its cleanup.
 */
export function installTransport(deps: TransportDeps): () => void {
  const { audio, playback, document, selection, transport, settings, legacyStorage } = deps;

  // The store holds what outlives a reload and `audio` what plays; each follows the other, and a
  // side is touched only when it differs, so the two never loop. Playback changes are compared
  // against their own previous state, not against the store: during hydration the store is ahead
  // of `audio` for the keys not yet applied, and a whole-state comparison would write them back.
  const now = () => playback.getState().settings;
  const metronome = () => {
    const on = settings.get(METRONOME_ON_SETTING);
    const volume = settings.get(METRONOME_VOLUME_SETTING);
    if (now().metronome.on !== on || now().metronome.volume !== volume) {
      audio.setMetronome(on, volume);
    }
  };
  audio.setCountIn(settings.get(COUNT_IN_SETTING));
  audio.setCountInVolume(settings.get(COUNT_IN_VOLUME_SETTING));
  audio.setMetronome(settings.get(METRONOME_ON_SETTING), settings.get(METRONOME_VOLUME_SETTING));
  audio.setMasterVolume(settings.get(MASTER_VOLUME_SETTING));
  audio.setGmTierBypass(settings.get(GM_TIER_BYPASS_SETTING));
  audio.setMemoryBudget(settings.get(MEMORY_BUDGET_SETTING));

  const unsubscribeSettings = [
    settings.subscribe(COUNT_IN_SETTING, (value) => {
      if (now().countIn !== value) audio.setCountIn(value);
    }),
    settings.subscribe(COUNT_IN_VOLUME_SETTING, (value) => {
      if (now().countInVolume !== value) audio.setCountInVolume(value);
    }),
    settings.subscribe(METRONOME_ON_SETTING, metronome),
    settings.subscribe(METRONOME_VOLUME_SETTING, metronome),
    settings.subscribe(MASTER_VOLUME_SETTING, (value) => {
      if (now().masterVolume !== value) audio.setMasterVolume(value);
    }),
    settings.subscribe(GM_TIER_BYPASS_SETTING, (value) => {
      if (now().gmTierBypass !== value) audio.setGmTierBypass(value);
    }),
    settings.subscribe(MEMORY_BUDGET_SETTING, (value) => {
      if (now().memoryBudgetBytes !== value) audio.setMemoryBudget(value);
    }),
  ];

  const unsubscribePlayback = playback.subscribe(({ settings: current }, { settings: before }) => {
    const put = <T>(def: SettingDef<T>, value: T, previous: T) => {
      if (value !== previous && settings.get(def) !== value) settings.set(def, value);
    };
    put(COUNT_IN_SETTING, current.countIn, before.countIn);
    put(COUNT_IN_VOLUME_SETTING, current.countInVolume, before.countInVolume);
    put(METRONOME_ON_SETTING, current.metronome.on, before.metronome.on);
    put(METRONOME_VOLUME_SETTING, current.metronome.volume, before.metronome.volume);
    put(MASTER_VOLUME_SETTING, current.masterVolume, before.masterVolume);
    put(GM_TIER_BYPASS_SETTING, current.gmTierBypass, before.gmTierBypass);
    put(MEMORY_BUDGET_SETTING, current.memoryBudgetBytes, before.memoryBudgetBytes);
  });

  // Once the table has loaded, the old localStorage blob moves into it, once.
  let disposed = false;
  void settings.whenHydrated().then(() => {
    if (!disposed) void importLegacyTransportPreferences(settings, legacyStorage);
  });

  // Politely, once per install: the sheet's own announcer is unmounted while it is closed.
  let installing: string | undefined;
  const unsubscribeInstall = deps.installJob?.subscribe(({ job }) => {
    if (job?.name === installing) return;
    installing = job?.name;
    if (installing !== undefined) transport.getState().announce(`Installing ${installing}`);
  });
  const unsubscribeSounds = playback.subscribe((state, previous) => {
    const stage = soundStatus(state)?.stage;
    if (stage !== undefined && stage !== soundStatus(previous)?.stage) {
      transport.getState().announce(stage);
    }
  });

  // The speed is a song's own, found by the hash of its bytes: a different file starts at 100%
  // whatever its name, and the same song reopened, or saved and reopened, keeps it.
  const fresh = (): TempoSetting => ({ mode: 'percent', value: TEMPO_PERCENT.default });
  const speeds = new Map<string, { tempo: TempoSetting }>();
  const entryOf = (key: string) => {
    const entry = speeds.get(key) ?? { tempo: fresh() };
    speeds.set(key, entry);
    return entry;
  };
  const unsubscribeDocument = document.subscribe((state, previous) => {
    if (state.id !== previous.id) {
      if (previous.file) entryOf(previous.file.key).tempo = playback.getState().settings.tempo;
      const tempo = state.file ? entryOf(state.file.key).tempo : fresh();
      audio.setTempo(tempo.mode, tempo.value);
      transport.getState().setRememberedSpeed(undefined);
      return;
    }
    if (state.file && state.file !== previous.file) {
      const entry = entryOf(state.file.key);
      for (const key of state.file.savedKeys) speeds.set(key, entry);
    }
    const { loop } = playback.getState().settings;
    if (state.score === previous.score || !loop || !state.score) return;
    const ids = new Set(state.score.masterBars.map((bar) => bar.id));
    if (!ids.has(loop.startBar) || !ids.has(loop.endBar)) audio.setLoop(undefined);
  });

  // A cleared selection keeps the loop, so a click that seeks cannot widen it to the whole song.
  // A selection that only marks what a menu acts on (`barsReloop` false) leaves the loop as it is.
  const unsubscribeSelection = selection.subscribe(({ bars, barsReloop }, { bars: before }) => {
    if (!bars || bars === before || !barsReloop || !playback.getState().settings.loop) return;
    const failed = applyLoop({ audio, playback }, document.getState().score, bars);
    if (failed) transport.getState().announce(failed);
  });

  return () => {
    disposed = true;
    for (const unsubscribe of unsubscribeSettings) unsubscribe();
    unsubscribePlayback();
    unsubscribeSounds();
    unsubscribeInstall?.();
    unsubscribeDocument();
    unsubscribeSelection();
  };
}
