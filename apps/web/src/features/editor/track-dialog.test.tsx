import { CommandError, openStringPitch } from '@reprise/model';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { setupTracks, tracksOf } from './test/tracks';

function setup() {
  return { ...setupTracks(), user: userEvent.setup() };
}

const dialog = () => screen.getByRole('dialog');
const field = (name: string) => within(dialog()).getByLabelText(name);

describe('the track dialog, editing', () => {
  it('opens on the current track with the first field focused', () => {
    const { run } = setup();
    run('track.properties');
    expect(screen.getByRole('dialog', { name: 'Track properties' })).toBeInTheDocument();
    expect(field('Name')).toHaveValue('Lead');
    expect(field('Name')).toHaveFocus();
    expect(field('Short name')).toHaveValue('Gtr.');
    expect(field('Strings')).toHaveValue('7');
    expect(field('Tuning')).toHaveValue('7-string standard');
    expect(field('String 1')).toHaveDisplayValue('E4');
    expect(field('String 7')).toHaveDisplayValue('B1');
  });

  it('shows the kind as read-only with its hint', () => {
    const { run } = setup();
    run('track.properties');
    expect(within(dialog()).queryByRole('radio', { name: 'Drums' })).toBeNull();
    expect(within(dialog()).getByText('Add a new track to change the kind')).toBeInTheDocument();
  });

  it('applies the changes as one undo step on Enter', async () => {
    const { services, ids, run, user } = setup();
    run('track.properties');
    const before = services.document.getState().revision;
    await user.clear(field('Name'));
    await user.type(field('Name'), 'Rhythm{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    const track = tracksOf(services)[0];
    expect(track).toMatchObject({ id: ids[0], name: 'Rhythm' });
    expect(services.document.getState().revision).toBe(before + 1);
    expect(services.document.getState().undoLabel).toBe('setTrackProperties');
  });

  it('cancels on Escape and changes nothing', async () => {
    const { services, run, user } = setup();
    run('track.properties');
    const before = services.document.getState().revision;
    await user.type(field('Name'), 'x');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.document.getState().revision).toBe(before);
    expect(tracksOf(services)[0]?.name).toBe('Lead');
  });

  it('keeps the dialog open and applies nothing while a field is invalid', async () => {
    const { services, run, user } = setup();
    run('track.properties');
    const before = services.document.getState().revision;
    await user.clear(field('Name'));
    expect(field('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Name')).toHaveAccessibleDescription('Give the track a name.');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(dialog()).toBeInTheDocument();
    await user.type(field('Capo'), '30');
    expect(field('Capo')).toHaveAttribute('aria-invalid', 'true');
    expect(services.document.getState().revision).toBe(before);
  });

  it('keeps every fret when the tuning changes', async () => {
    const { services, run, user } = setup();
    run('track.properties');
    await user.selectOptions(field('String 7'), 'A1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const track = tracksOf(services)[0];
    expect(track && openStringPitch(track, 7)).toBe(33);
    const note = track?.bars[0]?.voices[0]?.beats[1]?.notes[0];
    expect(note).toMatchObject({ string: 7, fret: 2 });
  });

  it('refuses to remove strings that still hold notes, naming strings and bars', async () => {
    const { services, run, user } = setup();
    run('track.properties');
    const before = services.document.getState().revision;
    await user.selectOptions(field('Strings'), '6');
    expect(field('Strings')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Strings')).toHaveAccessibleDescription(/String 7 has notes in bar 1/);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(services.document.getState().revision).toBe(before);
  });

  it('shows a refusal from the model and stays open', async () => {
    const { services, run, user } = setup();
    run('track.properties');
    // Nothing the form offers breaks a model rule, so the command is made to refuse.
    vi.spyOn(services.document.getState(), 'apply').mockImplementation(() => {
      throw new CommandError('setTrackProperties', 'invariant', 'the model said no');
    });
    await user.type(field('Name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('The model said no');
    await user.type(field('Name'), 'y');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
  });

  it('lets Tab visit the controls in the visual order, ending on the footer', async () => {
    const { run, user } = setup();
    run('track.properties');
    const nameOf = (element: Element) =>
      element.getAttribute('aria-label') ??
      document.querySelector(`label[for="${element.id}"]`)?.textContent ??
      element.textContent;
    const order: (string | null)[] = [nameOf(document.activeElement ?? document.body)];
    while (order.at(-1) !== 'Apply' && order.length < 40) {
      await user.tab();
      const active = document.activeElement;
      if (active === null || !dialog().contains(active)) break;
      order.push(nameOf(active));
    }
    expect(order).toEqual([
      'Name',
      'Short name',
      'Colour #d9480f',
      'Colour hex',
      'Instrument',
      'Strings',
      'Tuning',
      'Capo',
      'String 1',
      'String 2',
      'String 3',
      'String 4',
      'String 5',
      'String 6',
      'String 7',
      'Cancel',
      'Apply',
    ]);
  });
});

describe('the track dialog, adding', () => {
  it('starts from the defaults and adds a bass at the end with the capo', async () => {
    const { services, run, user } = setup();
    run('track.add');
    expect(screen.getByRole('dialog', { name: 'Add track' })).toBeInTheDocument();
    expect(field('Name')).toHaveValue('Guitar');
    await user.selectOptions(field('Strings'), '4');
    await user.selectOptions(field('Tuning'), 'Bass standard');
    expect(field('Name')).toHaveValue('Bass');
    expect(field('Instrument')).toHaveDisplayValue('Electric Bass (finger)');
    await user.clear(field('Capo'));
    await user.type(field('Capo'), '2');
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    const added = tracksOf(services).at(-1);
    expect(added).toMatchObject({ name: 'Bass', capo: 2, tuning: [28, 33, 38, 43], program: 33 });
    expect(added?.bars).toHaveLength(2);
    expect(services.selection.getState().currentTrack).toBe(added?.id);
  });

  it('offers the 12-string, mandolin and banjo presets in their own groups', () => {
    const { run } = setup();
    run('track.add');
    const labels = [...within(dialog()).getByLabelText('Tuning').querySelectorAll('optgroup')].map(
      (group) => group.label,
    );
    expect(labels).toEqual(['Guitar', 'Bass', '12-string']);
  });

  it('adds a 12-string with its courses, named for the preset, and says what is doubled', async () => {
    const { services, run, user } = setup();
    run('track.add');
    await user.selectOptions(field('Strings'), '6');
    await user.selectOptions(field('Tuning'), '12-string standard');
    expect(field('Name')).toHaveValue('12-string Guitar');
    expect(
      within(dialog()).getByText(
        'Doubled courses: octave on strings 6 to 3, unison on strings 2 and 1',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).at(-1)).toMatchObject({
      name: '12-string Guitar',
      tuning: [40, 45, 50, 55, 59, 64],
      courses: [12, 12, 12, 12, 0, 0],
    });
  });

  it('adds a mandolin on four strings, and offers the tenor banjos', async () => {
    const { services, run, user } = setup();
    run('track.add');
    await user.selectOptions(field('Strings'), '4');
    expect(
      [...within(dialog()).getByLabelText('Tuning').querySelectorAll('optgroup')].map(
        (group) => group.label,
      ),
    ).toEqual(['Bass', 'Ukulele', 'Mandolin', 'Banjo']);
    await user.selectOptions(field('Tuning'), 'Mandolin GDAE');
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).at(-1)).toMatchObject({
      name: 'Mandolin',
      tuning: [55, 62, 69, 76],
      courses: [0, 0, 0, 0],
      program: 25,
    });
  });

  it('adds a 5-string banjo with its short string, which a checkbox turns off', async () => {
    const { services, run, user } = setup();
    run('track.add');
    await user.selectOptions(field('Strings'), '5');
    expect(
      [...within(dialog()).getByLabelText('Tuning').querySelectorAll('optgroup')].map(
        (group) => group.label,
      ),
    ).toContain('Banjo');
    await user.selectOptions(field('Tuning'), 'Banjo Open G');
    expect(field('Name')).toHaveValue('Banjo');
    const drone = within(dialog()).getByLabelText('Short 5th string (drone) from fret 5');
    expect(drone).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).at(-1)).toMatchObject({
      name: 'Banjo',
      program: 105,
      drone: { string: 5, fret: 5 },
    });

    run('track.add');
    await user.selectOptions(field('Strings'), '5');
    await user.selectOptions(field('Tuning'), 'Banjo Open G');
    await user.click(within(dialog()).getByLabelText('Short 5th string (drone) from fret 5'));
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).at(-1)?.drone).toBeUndefined();
  });

  it('drops the drone with the fifth string count, and offers none on a 5-string bass', async () => {
    const { services, run, user } = setup();
    run('track.add');
    await user.selectOptions(field('Strings'), '5');
    await user.selectOptions(field('Tuning'), 'Banjo Open G');
    await user.selectOptions(field('Strings'), '6');
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).at(-1)?.drone).toBeUndefined();

    run('track.add');
    await user.selectOptions(field('Strings'), '4');
    await user.selectOptions(field('Tuning'), 'Bass standard');
    await user.selectOptions(field('Strings'), '5');
    expect(within(dialog()).queryByLabelText(/Short 5th string/)).toBeNull();
  });

  it('offers no drone checkbox off five strings', async () => {
    const { run, user } = setup();
    run('track.add');
    await user.selectOptions(field('Strings'), '4');
    expect(within(dialog()).queryByLabelText(/Short 5th string/)).toBeNull();
  });

  it('adds a drum track with no strings', async () => {
    const { services, run, user } = setup();
    run('track.add');
    await user.click(within(dialog()).getByRole('radio', { name: 'Drums' }));
    expect(within(dialog()).queryByLabelText('Strings')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).at(-1)).toMatchObject({ kind: 'drums', tuning: [], name: 'Drums' });
  });

  it('follows the name with the short name and takes a typed hex colour', async () => {
    const { services, run, user } = setup();
    run('track.add');
    await user.clear(field('Name'));
    await user.type(field('Name'), 'Rhythm');
    expect(field('Short name')).toHaveValue('Rhyt.');
    await user.click(within(dialog()).getByRole('radio', { name: 'Colour #2f9e44' }));
    expect(field('Colour hex')).toHaveValue('#2f9e44');
    await user.clear(field('Colour hex'));
    await user.type(field('Colour hex'), '#ABCDEF');
    await user.keyboard('{Enter}');
    expect(tracksOf(services).at(-1)).toMatchObject({
      name: 'Rhythm',
      shortName: 'Rhyt.',
      color: '#abcdef',
    });
  });
});
