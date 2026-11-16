import type { PackManifest } from './manifest';

const karoryfer = (repo: string, tag: string, asset: string) => ({
  sourceUrl: `https://github.com/sfzinstruments/${repo}`,
  licenseName: 'CC0 1.0',
  licenseUrl: `https://github.com/sfzinstruments/${repo}/blob/master/LICENSE`,
  downloadUrl: `https://github.com/sfzinstruments/${repo}/releases/download/${tag}/${asset}`,
});

const swagbass = karoryfer('karoryfer.swagbass', 'v1.001', 'Karoryfer.Swagbass.v1.001.zip');
const growlybass = karoryfer('karoryfer.growlybass', 'v1.002', 'Karoryfer.Growlybass.v1.002.zip');
const emilyguitar = karoryfer(
  'karoryfer.emilyguitar',
  'v1.001',
  'Karoryfer.Emilyguitar.v1.001.zip',
);

/**
 * The packs the Sounds screen offers. Every entry's licence was read on the pack's own source page
 * (dates in `docs/reference/sound-packs.md`). A pack is listed only when its terms are confirmed;
 * `directDownload` also needs a stable archive URL whose hash and size were measured from one real
 * download. Ids are fixed, not derived from anything: a song names a pack by id, so changing one
 * orphans every song that uses the pack.
 */
/** Growlybass keeps its staccato samples in one file of their own, shared by every sound. */
const STACCATO = 'growlybass_vicious.sfz';

export const CURATED_PACKS: readonly PackManifest[] = [
  {
    schema: 1,
    id: 'HetrHZohZ3oo',
    name: 'Karoryfer Swagbass',
    family: 'bass',
    gmPrograms: [32, 33, 34, 35],
    format: 'sfz',
    version: '1.001',
    sourceUrl: swagbass.sourceUrl,
    licenseName: swagbass.licenseName,
    licenseUrl: swagbass.licenseUrl,
    directDownload: true,
    download: {
      url: swagbass.downloadUrl,
      sha256: '4b4db964413be99a597da246651961e1c4dbb0004db49daccd11387c5f9a535a',
      sizeBytes: 144_579_232,
      root: 'Swagbass',
    },
    sizeBytes: 174_246_979,
    instruments: [
      { key: 'swagbass', name: 'Swagbass', entries: { default: 'swagbass.sfz' } },
      { key: 'clean', name: 'Clean', entries: { default: 'swagbass_clean.sfz' } },
      {
        key: 'clean-four-voices',
        name: 'Clean, four voices',
        entries: { default: 'swagbass_clean_things.sfz' },
      },
      { key: 'shiny', name: 'Shiny', entries: { default: 'swagbass_shiny.sfz' } },
      {
        key: 'shiny-four-voices',
        name: 'Shiny, four voices',
        entries: { default: 'swagbass_shiny_things.sfz' },
      },
    ],
  },
  {
    schema: 1,
    id: 'oP2Y6UriacYx',
    name: 'Karoryfer Growlybass',
    family: 'bass',
    gmPrograms: [32, 33, 34, 35],
    format: 'sfz',
    version: '1.002',
    sourceUrl: growlybass.sourceUrl,
    licenseName: growlybass.licenseName,
    licenseUrl: growlybass.licenseUrl,
    directDownload: true,
    download: {
      url: growlybass.downloadUrl,
      sha256: 'b92dca75494fa39d6e8d8b8addaabfe70c5aaa59b5f9a0f624be6de51a2374bc',
      sizeBytes: 167_454_256,
      root: 'Growlybass',
    },
    sizeBytes: 190_765_319,
    instruments: [
      {
        key: 'dirty',
        name: 'Dirty',
        entries: { default: 'growlybass_dirty.sfz', staccato: STACCATO },
      },
      {
        key: 'clean',
        name: 'Clean',
        entries: { default: 'growlybass_clean.sfz', staccato: STACCATO },
      },
      {
        key: 'vicious',
        name: 'Vicious (staccato)',
        entries: { default: 'growlybass_vicious.sfz' },
      },
      {
        key: 'angry',
        name: 'Angry',
        entries: { default: 'growlybass_angry.sfz', staccato: STACCATO },
      },
      {
        key: 'excessive',
        name: 'Excessive',
        entries: { default: 'growlybass_excessive.sfz', staccato: STACCATO },
      },
      {
        key: 'shifty',
        name: 'Shifty',
        entries: { default: 'growlybass_shifty.sfz', staccato: STACCATO },
      },
    ],
  },
  {
    schema: 1,
    id: 'qxmLveBRBWt8',
    name: 'Karoryfer Emilyguitar',
    family: 'electric-guitar',
    gmPrograms: [27, 28, 29, 30],
    format: 'sfz',
    version: '1.001',
    sourceUrl: emilyguitar.sourceUrl,
    licenseName: emilyguitar.licenseName,
    licenseUrl: emilyguitar.licenseUrl,
    directDownload: true,
    download: {
      url: emilyguitar.downloadUrl,
      sha256: 'ffef3b28972763820bee73660a25cf47ea6e13b184342fd5d325a5631598cacb',
      sizeBytes: 103_484_350,
      root: 'Emilyguitar',
    },
    sizeBytes: 125_538_629,
    instruments: [
      { key: 'basic', name: 'Basic', entries: { default: 'emily_basic.sfz' } },
      { key: 'clean', name: 'Clean', entries: { default: 'emily_clean.sfz' } },
      { key: 'three-voices', name: 'Three voices', entries: { default: 'emily_three_voice.sfz' } },
      { key: 'five-voices', name: 'Five voices', entries: { default: 'emily_five_voice.sfz' } },
    ],
  },
];

export const curatedPack = (id: string): PackManifest | undefined =>
  CURATED_PACKS.find((pack) => pack.id === id);

/** A pack of the list whose installed copy is older than the list entry. */
export const updateAvailable = (installed: { id: string; version: string }): boolean => {
  const listed = curatedPack(installed.id);
  return listed !== undefined && listed.version !== installed.version;
};
