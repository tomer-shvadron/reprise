# ADR-0003: Desktop only, web core, Electron shell

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The owner wants a desktop application for macOS for certain, Windows as a nice-to-have, and
prefers to stay in TypeScript and React. They raised a concern about web performance for
multi-track playback with high-quality samples, and asked why a phone or tablet would change
anything.

Phones and tablets change the layout and the input, not the audio. A tab is laid out as
systems that wrap at a width; a narrow screen needs the layout engine to re-break bars per
line on every resize, and a phone cannot show more than one or two bars legibly. The editor
relies on hover, keyboard shortcuts and precise clicks on fret numbers, none of which exist on
touch, so a touch editor is a second interaction design. iOS Safari starts audio only after a
tap, stops it when the screen locks, has tight memory limits for decoded samples, and lacks
the File System Access API.

On performance: Web Audio mixes on a native real-time audio thread, so hundreds of
simultaneous sample voices across many tracks are routine and the main thread only schedules
notes ahead of time. The real constraint is memory for decoded samples, handled in
`0005-memory-budgets-lazy-loading.md`. Nothing in a Guitar Pro clone needs native code.

## Decision

- **Computer only.** No phone, no tablet, no touch editor. The layout targets a desktop-class
  window.
- **The core is a web application** in TypeScript and React, developed and tested in the
  plain browser through Vite.
- **The shipped app is an Electron shell** around that web core, with a thin platform
  adapter for file open and save, app data directories and native menus, so the browser build
  keeps working during development.
- **macOS is required; Windows is a nice-to-have** produced by the same CI release workflow.
- **Builds are unsigned for now** (default unless revisited): the first launch on macOS needs
  right-click → Open. Code signing and notarization are deferred.

## Alternatives considered

- **PWA only**: the owner's other hobby projects are PWAs, and the web core keeps that shape,
  but a desktop app was a stated requirement.
- **Tauri**: small binaries and fast startup, but it uses the OS webview, Safari's engine on
  macOS and Edge's on Windows, so there would be two audio and rendering stacks to test,
  Safari's being the quirkier one, plus a Rust toolchain to install and learn. Rejected in
  favour of one predictable Chromium across platforms and the dev browser.
- **Native desktop (Swift, .NET)**: rejected; leaves the owner's stack and offers nothing a
  sample-playback app needs.

## Consequences

- Audio and rendering behave identically in the dev browser and in the shipped app on both
  platforms, so they are tested once.
- Electron's known costs are accepted: an idle memory baseline of roughly 150 to 250 MB
  before any score data, an installer around 150 MB, and a cold start near a second.
- The one audio feature Electron would be bad at, low-latency processing of a live guitar
  input through an amp simulator, is dropped from the product regardless.
- Every platform-specific operation goes through the adapter in the desktop package; the
  engine packages never import Electron.

## Related

- `../specs/shared-understanding.md`
- `0004-own-sampler-engine-two-loaders.md`
- `0005-memory-budgets-lazy-loading.md`
- `0009-monorepo-pnpm-workspaces.md`
