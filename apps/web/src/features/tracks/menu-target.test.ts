import { note, score as builder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { targetTrackOf } from './menu-target';

function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const score = builder()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .track('bass')
    .bar()
    .beat('4', [note(1, 0)])
    .build();
  services.document.setState({ score });
  return { services, score, registry: createAppRegistry(services) };
}

describe('targetTrackOf', () => {
  it('is the track a menu was opened on, else the current track', () => {
    const { services, score } = setup();
    const [first, second] = score.tracks;
    if (!first || !second) throw new Error('the fixture needs two tracks');
    services.selection.getState().setCurrentTrack(first.id);
    expect(targetTrackOf(services)?.id).toBe(first.id);
    services.menuTarget.getState().set({ kind: 'track', track: second.id });
    expect(targetTrackOf(services)?.id).toBe(second.id);
    services.menuTarget.getState().clear();
    expect(targetTrackOf(services)?.id).toBe(first.id);
  });

  it('makes the track commands act on the right-clicked track', () => {
    const { services, score, registry } = setup();
    const [first, second] = score.tracks;
    if (!first || !second) throw new Error('the fixture needs two tracks');
    services.selection.getState().setCurrentTrack(first.id);
    services.menuTarget.getState().set({ kind: 'track', track: second.id });
    const command = registry.get('track.toggleSolo');
    if (!command) throw new Error('no command');
    runCommand(command);
    services.menuTarget.getState().clear();
    expect(services.playback.getState().mixer[second.id]?.solo).toBe(true);
    expect(services.playback.getState().mixer[first.id]?.solo).toBeUndefined();
  });
});
