# Changelog

All notable changes to this project are documented here.

## Unreleased

### Added
- A test suite (`npm test`, built on `node:test`, no test dependencies) covering
  terminal type normalization, the capability table, colour mapping, the
  ANSI-BBS / ECMA-48 / pipe-code / VTX / OSC 8 handlers and `Terminal` itself.
  `npm run test:coverage` prints a coverage report.
- `Terminal.addCapability()` (singular), as the README always documented.
- `red()`, `redBG()`, ... colour shortcuts for the 8 basic colours, as the
  README always documented. `ANSI_BBS.hasSGRAttribute()` and
  `ANSI_BBS.SGRAttributes` for callers that need the attribute table.
- The `cterm` handler is now constructed (`term.cterm`). It is still a stub.
- `engines.node >= 22` and a `files` whitelist for publishing.

### Fixed
- Capabilities leaked across `Terminal` instances: the shared table entry was
  turned into a `Set` in place, so `addCapabilities()` on one connection added
  to every connection of that terminal type. Each terminal now owns a copy.
- `xterm-256color` (and everything normalizing to it, e.g. `screen-256color`,
  `vt100-256color`) had no capability entry because the table key was spelled
  `xterm-256-color`; those terminals were treated as CP437 ANSI-BBS.
- `fgColor(n)` / `bgColor(n)` for 0..7 wrote the sequence and then handed the
  terminal object itself to the socket.
- `bgColor(n)` for 0..7 produced a foreground sequence.
- `fgRGB()` / `bgRGB()` wrote nothing at all with their default argument, and
  `bgRGB(..., AsSequence)` returned a foreground sequence.
- `bgColor('red')` produced a foreground sequence; it now uses `redBG`.
  An unknown colour name used to emit `ESC[m` (a full attribute reset); it now
  emits nothing.
- OSC 8 hyperlinks used the CSI introducer instead of OSC and mixed the link
  text into the URL. The handler was also constructed without its terminal,
  so its write path threw.
- VTX `playAudio()`, `pauseAudio()` and `stopAndRewindAudio()` ignored
  `AsSequence`; `vtx.hyperlink()` threw a `ReferenceError`. It now degrades to
  the link text (VTX has no hyperlink sequence).
- The `emca-48` capability name typo is now `ecma-48`.
- The dead `rgb` cap handler mapping on `cterm` was removed.

### Changed
- `iconv-lite` bumped to `^0.7`.

## 0.1.0

Initial, experimental release.
