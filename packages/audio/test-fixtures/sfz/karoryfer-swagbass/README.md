# Karoryfer Swagbass, SFZ text only

`swagbass_clean.sfz` is copied unchanged from
[sfzinstruments/karoryfer.swagbass](https://github.com/sfzinstruments/karoryfer.swagbass) at commit
`9d10fcae71af1975988ddecd5af1c95d372c7355`. The instrument is CC0 1.0 (the repository's `LICENSE`,
copied beside it, and its readme: "Royalty-free for all commercial and non-commercial use",
copyright 2014 Karoryfer Lecolds, mapped by D. Smolken).

No samples are committed. `swagbass-clean.node.test.ts` parses the file with an in-memory reader
and pins its report as a regression test against a real pack's shapes: backslash paths, keyswitch-
free round robins, velocity layers and `amp_velcurve_N`. The real pack is checked with
`pnpm sfz:check local-sounds/swagbass`.
