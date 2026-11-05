# Bravura

The SMuFL music font the score is engraved with ([ADR-0010](../../../../../docs/decisions/0010-svg-renderer-virtualized.md)). Vendored unchanged; do not reformat or edit these files.

| File                    | What it is                                                           | Source                                                                                                    |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Bravura.woff2`         | The font the web shell loads                                         | [steinbergmedia/bravura release `bravura-1.482`](https://github.com/steinbergmedia/bravura/releases/tag/bravura-1.482) |
| `Bravura.otf`           | The same font; `scripts/layout/metrics.ts` reads its advance widths  | same release                                                                                              |
| `OFL.txt`               | The SIL Open Font License 1.1 that Bravura is released under         | same release                                                                                              |

Bravura is copyright Steinberg Media Technologies GmbH and licensed under the [SIL Open Font License 1.1](OFL.txt); the name "Bravura" is a Reserved Font Name, so a modified copy must be renamed.

The SMuFL metadata `scripts/layout/metrics.ts` reads beside the font lives in `scripts/layout/data/`, since it is a build input and nothing the web shell loads: `bravura_metadata.json` is the same release's `Bravura.json` (bounding boxes, anchors, engraving defaults) and `glyphnames.json` is [w3c/smufl tag `v1.4`](https://github.com/w3c/smufl/blob/v1.4/metadata/glyphnames.json)'s glyph names to codepoints. Update them with the fonts.

## Updating

Replace the files from a newer release, run `pnpm layout:metrics` to regenerate `packages/layout/src/metrics/bravura.json`, and review the layout snapshot changes it causes. The metrics test (`scripts/layout/metrics.test.ts`) fails until the generated table matches the fonts here.
