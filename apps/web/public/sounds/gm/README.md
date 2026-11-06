# GM tier soundfont

This directory holds the General MIDI soundfont the GM tier plays, served by the web app at
`/sounds/gm/GeneralUser-GS.sf2`, and in the packaged desktop app at
`reprise://app/sounds/gm/GeneralUser-GS.sf2`. Only this README is committed; the soundfont and its license
are fetched:

```sh
pnpm sounds:fetch
```

| Field     | Value                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Soundfont | GeneralUser GS 2.0.3, by S. Christian Collins                                                          |
| Home page | https://www.schristiancollins.com/generaluser                                                          |
| Source    | https://github.com/mrbumpy409/GeneralUser-GS, the author's repository, pinned to commit `684543d5e5ef` |
| Files     | `GeneralUser-GS.sf2` (32,319,396 bytes) and `LICENSE.txt`, both verified by SHA-256                    |
| Pins      | `scripts/sounds/gm.json` holds the commit, sizes and hashes                                            |
| License   | GeneralUser GS License v2.0, in `LICENSE.txt` once fetched                                             |

**License summary.** Free to use without restriction for music creation, private or commercial,
and free to use in software projects, modify and redistribute. The author asks that his own
download links are not hot-linked: link to his web page or ship a local copy, which is what this
bundle is. The GitHub repository the fetch reads is the channel he offers for exactly this: its
README says it exists "to host updated documentation, track issues, and offer an easier source
for automated packaging of GeneralUser GS and its support files". The license notes the origin
of a few samples cannot be fully traced; read it in full before any commercial distribution.

To move to a new release, update the commit, sizes and hashes in `scripts/sounds/gm.json`, run
`pnpm sounds:fetch`, and rerun the audio tests, whose GeneralUser GS suite checks every GM
program and the standard kit.
