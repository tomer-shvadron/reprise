import { STANDARD_TUNING, type Score } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';

/** A score with every feature gpif can carry, on every kind of track. */
export function kitchenSink(): Score {
  const bend = (kind: 'bend' | 'prebendRelease' | 'bendRelease' | 'hold') =>
    ({
      bend: {
        kind,
        points: [
          { position: 0, value: 0 },
          { position: 15, value: 4 },
          { position: 60, value: 4 },
        ],
      },
      prebendRelease: {
        kind,
        points: [
          { position: 0, value: 4 },
          { position: 60, value: 0 },
        ],
      },
      bendRelease: {
        kind,
        points: [
          { position: 0, value: 0 },
          { position: 12, value: 4 },
          { position: 36, value: 4 },
          { position: 60, value: 0 },
        ],
      },
      hold: {
        kind,
        points: [
          { position: 0, value: 0 },
          { position: 60, value: 0 },
        ],
      },
    })[kind];

  return score()
    .meta({
      title: 'Kitchen sink',
      subtitle: 'sub',
      artist: 'artist <&>',
      album: 'album ]]> cdata',
      words: 'words',
      music: 'music',
      copyright: 'copyright',
      tab: 'tab',
      instructions: '  spaced  ',
      notices: ['one', 'two'],
    })
    .tempo(100, { label: 'Intro' })
    .key(2, true)
    .track('guitar', {
      name: 'Lead',
      shortName: 'ld',
      color: '#123456',
      program: 29,
      capo: 2,
      fretCount: 22,
      display: { notation: 'both', clef: 'treble', octaveShift: 1 },
      channel: {
        volume: 80,
        pan: 30,
        chorus: 0,
        reverb: 0,
        phaser: 0,
        tremolo: 0,
        mute: false,
        solo: true,
      },
    })
    .bar()
    .repeatStart()
    .section('Verse', { letter: 'A' })
    .target('segno')
    .masterBar({ tripletFeel: 'sixteenth' })
    .beat('8', [note(1, 5), note(2, 7, { dead: true })], {
      effects: { pickStroke: 'up', brush: { direction: 'up', duration: 8 } },
      text: 'text',
      chord: {
        name: 'D',
        diagram: {
          baseFret: 1,
          frets: [2, 3, 2, 0, null, null],
          fingering: ['middle', 'ring', 'index', null, null, null],
        },
      },
      lyrics: ['la', ''],
    })
    .beat('8', [note(1, 7, { hammerPull: true, staccato: true, accent: 'accent' })])
    .beat('8t', [note(1, 7, { tie: true })])
    .beat('8t', [note(2, 5, { slide: ['shift', 'intoFromBelow'], bend: bend('bend') })])
    .beat('8t', [
      note(2, 7, { bend: bend('prebendRelease'), harmonic: { kind: 'artificial', value: 5.8 } }),
    ])
    .beat(
      '4',
      [
        note(3, 1, {
          bend: bend('bendRelease'),
          ghost: true,
          letRing: true,
          palmMute: true,
          vibrato: 'slight',
          leftHandFinger: 'little',
          rightHandFinger: 'thumb',
          trill: { fret: 3, speed: 16 },
          dynamics: 'ppp',
          accidental: 'sharp',
        }),
      ],
      {
        grace: [
          { duration: 16, before: false, notes: [note(3, 0, { dynamics: 'p' })] },
          { duration: 64, before: true, notes: [note(3, 3, { slide: ['legato'] })] },
        ],
      },
    )
    .beat('4', [note(4, 12, { harmonic: { kind: 'natural', value: 12 } })], {
      effects: {
        tremoloPicking: 32,
        fadeOut: true,
        vibrato: 'wide',
        whammy: {
          kind: 'dip',
          points: [
            { position: 0, value: 0 },
            { position: 30, value: -4 },
            { position: 60, value: 0 },
          ],
        },
        arpeggio: { direction: 'down', duration: 128 },
      },
    })
    .voice(1)
    .beat('2', [note(5, 3, { harmonic: { kind: 'pinch' } })])
    .rest('2')
    .bar()
    .volta([1])
    .repeatEnd(2)
    .beat('4', [note(1, 0)], { mix: { program: 30 } })
    .beat('4', [note(1, 2, { harmonic: { kind: 'semi' } })], { effects: { tapping: true } })
    .beat('2', [note(6, 0, { harmonic: { kind: 'feedback' } })], {
      effects: { slapping: true, popping: true, volumeSwell: true },
    })
    .bar()
    .volta([2])
    .key(-4)
    .beat('4', [note(2, 1, { harmonic: { kind: 'tapped', value: 7 } })])
    .beat('4', [note(2, 2)], { mix: { tempo: { bpm: 80 } } })
    .beat('2', [note(2, 3)], { effects: { fadeIn: true } })
    .bar()
    .jump('dsAlCoda')
    .jump('toCoda')
    .beat('4', [note(3, 3, { bend: bend('hold') })])
    .beat('4', [note(3, 4)], {
      mix: { tempo: { bpm: 140, unit: 'half', label: 'faster', duration: 2 } },
    })
    .beat('4', [note(3, 5)])
    .beat('4', [note(3, 6)])
    .bar({ clef: 'bass' })
    .target('coda')
    .timeSignature(6, 8)
    .beat('4.', [note(4, 4)])
    .beat('4.', [note(4, 5)])
    .bar()
    .repeatStart()
    .beat('4.', [note(5, 1)])
    .rest('4.')
    .bar()
    .volta([1, 2])
    .beat('2.', [note(5, 2)])
    .bar()
    .volta([1, 2])
    .repeatEnd(3)
    .beat('2.', [note(5, 3)])
    .bar()
    .volta([3])
    .beat('2.', [note(5, 4)])
    .bar()
    .masterBar({ doubleBar: true, tripletFeel: 'scottishEighth' })
    .tempo(60, { unit: 'dottedQuarter' })
    .beat('2.', [note(6, 1)], { effects: { brush: { direction: 'down' } } })
    .track('bass', {
      channel: {
        volume: 100,
        pan: 64,
        chorus: 0,
        reverb: 0,
        phaser: 0,
        tremolo: 0,
        mute: true,
        solo: false,
      },
    })
    .bar()
    .beat('4', [note(4, 3)])
    .beat('4', [note(4, 5, { hammerPull: true })])
    .beat('4', [note(4, 3, { hammerPull: true })])
    .rest('4')
    .track('drums')
    .bar()
    .beat('4', [midi(36), midi(42, { accent: 'heavy' })])
    .beat('4', [midi(38, { ghost: true })])
    .beat('4', [midi(20)])
    .rest('4')
    .track('piano')
    .bar()
    .beat('4', [midi(62)])
    .beat('4', [midi(64, { hammerPull: true })])
    .beat('2', [midi(64, { tie: true }), midi(67)])
    .track('piano', {
      name: 'Keys',
      program: 4,
      tuning: [...STANDARD_TUNING],
      fretCount: 24,
      lyrics: [{ startBar: 0, text: 'one two' }],
    })
    .bar()
    .beat('2', [midi(76)])
    .beat('2', [midi(50, { accidental: 'natural' })])
    .build();
}
