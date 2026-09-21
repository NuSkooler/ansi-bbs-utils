# Changelog

All notable changes to this project are documented here.

## Unreleased

### Added
- **Audio.** `terminal.probeAudio()` asks a CTerm/SyncTERM-compatible terminal
  for its audio support (the libsndfile feature query; any answer means the
  audio APC exists, `1` means files decode) and sets `cterm-audio` /
  `cterm-audio-files` on that terminal. `terminal.audio` is then an
  `AudioSession`: register assets by bytes or path, `play('music' | 'sfx' | 2..15,
  asset, { loop, volume, pan, fadeIn, fadeOut, crossfade })`, `playTone()`,
  per-play handles with `volume(value, { ramp })` and `stop({ fade })`, an
  `idle` event when a channel finishes, and `formatSupported(container, codec)`
  answered by the terminal itself. Assets are uploaded once per BBS: the
  client's cache listing (with MD5s) is consulted first. Operations are
  serialized and wait for the socket. The CTerm `Wait` verb is never sent.
  Terminals without audio get a null session that accepts everything and
  plays nothing. See `docs/audio.md`.
- `handlers/cterm.js` now emits the CTerm cache, query and audio APCs
  (`storeFile`, `listFiles`, `queryLibsndfile`, `queryFormat`,
  `queryAudioState`, `audioLoad`, `audioLoadBlob`, `audioSynth`, `audioCopy`,
  `audioQueue`, `audioFlush`, `audioVolume`, `audioUpdate`), validating the
  duration and volume grammars and cache names from the spec.
- `Terminal.sendSequence(seq)`: write an escape sequence and resolve when the
  socket has taken it.
- `Testing.FakeCTerm`: a scripted CTerm-style terminal, shipped in the package
  so consumers can drive integration tests without a real client. It answers
  device attribute and feature queries, keeps a file cache with MD5s, plays
  queued buffers on a timer and reports idle channels.
- `Audio.Formats`: libsndfile container/codec ids as CTerm's format query
  wants them, and CTerm revision comparison helpers.
- **An input side.** `ReplyParser` (also exported) is a pre-filter for terminal
  *replies* in an inbound byte stream: it reassembles APC strings
  (`ESC _ … ESC \`) and private-prefix CSI replies (device attributes, CTerm
  feature/state reports) across TCP fragments into events, and passes every
  other byte through, in order, for the host's own key parser. It is not a key
  parser. Held bytes are bounded in size and time: an ambiguous prefix (`ESC`,
  `ESC [`, a plain CSI) is released as keystrokes after `escapeTimeout`
  (50 ms); a reply in progress is dropped with a `reply error` after
  `replyTimeout` (2 s) or on overflow, never leaked as keystrokes. A CPR can be
  captured with `captureCPR`.
- `Terminal` is now an `EventEmitter` with `feed(chunk)`, `flushInput()` and
  `destroy()`; it re-emits parser events (`apc`, `report`, `cpr`,
  `reply error`, and `input` for passthrough bytes) and, on a
  `device attributes` reply, sets `termClient`, `clientVersion` and
  `ctermVersion`. Construct with `new Terminal(socket, { input: { … } })` to
  pass parser options.
- `DeviceAttributes.parseDeviceAttributes()`: one home for mapping a DA reply
  to a client (`cterm`, `icy_term`, `vtx`, `arctel`) and version, ported from
  ENiGMA½ and Skull Crash.
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
- `ansi-bbs-256color`, a capability entry in its own right, was reinterpreted
  as `xterm-256color` by the `-256color` suffix rule (UTF-8, xterm caps).
  An exact entry name now always wins over the heuristics.
- Handler write paths (`fromPipeCodes()`, a handler's own `hyperlink()`)
  bypassed the terminal's encoding, so CP437 art written that way went out
  as UTF-8. They now encode for the terminal, without line feed conversion.
- `rawWrite(data, cb)` never called `cb` when the socket was missing or not
  writable, stranding sequential writers. It now reports an `Error`
  asynchronously.
- Generated sequence methods treated a trailing `false`/`undefined`
  placeholder as a parameter (`goto(2, 3, false)` gave `ESC[2;3;falseH`).
- VTX hex3 encoding produced the string `undefined` for characters above
  U+00FF; it now encodes the UTF-8 bytes, as the VTX spec describes.
- Palette indexes and RGB components are clamped to 0..255 instead of
  emitting out-of-range values.

### Changed
- `iconv-lite` bumped to `^0.7`.

## 0.1.0

Initial, experimental release.
