# Audio

Real audio files on BBS terminals, as opposed to "ANSI music" (`CSI M ...`).

The library implements the CTerm / SyncTERM audio APC, the only formal,
queryable protocol for this at the time of writing. It is designed so that
other protocols (TERMinator's TAP+, VTX) can be added as further back-ends
without changing what a BBS calls.

Normative reference for the wire: https://www.syncterm.net/cterm.html, the
"Audio APCs" section. Clients that speak it: SyncTERM built from master
(the feature is slated for 1.10; 1.9 does **not** have it) and IcyTerm 0.8.4
and later.

## The model the terminal exposes

- **Patch slots** (`S=0..255`): buffers of decoded PCM, filled by decoding a
  cached file (`Load`), decoding inline data (`LoadBlob`), synthesizing a tone
  (`Synth`) or copying (`Copy`).
- **Channels** (`C=0..15`): mixer streams. `0` and `1` belong to the terminal
  (ANSI music, RIP/OOII effects); a BBS queues onto `2..15`.
- `Queue` **moves** a slot's buffer onto a channel and empties the slot. Every
  play is therefore a fresh `Load` followed by a `Queue`.
- **The file cache**: `SyncTERM:C;S` stores a base64-encoded file in a
  per-BBS directory on the client that **persists across sessions**;
  `SyncTERM:C;L` lists it with MD5s.
- `Update` arms a one-shot asynchronous `CSI = 7 ; ch ; 0 n` report when a
  channel goes idle. `Wait` blocks the terminal's input processing until then
  and is deliberately not exposed.

## What the session does with it

```
probeAudio()      APC SyncTERM:Q;libsndfile ST         -> CSI = 7 ; 100 ; 0|1 n
ensureAsset()     APC SyncTERM:C;L ST                  -> APC SyncTERM:C;L LF (name TAB md5 LF)* ST   (once)
                  APC SyncTERM:C;S;name;base64 ST      (only if missing or changed)
play()            APC SyncTERM:A;Load;S=n;name ST
                  APC SyncTERM:A;Queue;C=ch;S=n[;I=][;O=][;X][;L][;V=|VL=;VR=] ST
                  APC SyncTERM:A;Update;C=ch ST
volume()          APC SyncTERM:A;Volume;C=ch;V=..[;T=ramp] ST
stop()            APC SyncTERM:A;Flush;C=ch[;O=fade] ST
idle event        <- CSI = 7 ; ch ; 0 n
formatSupported() APC SyncTERM:Q;libsndfileFormat;pm;ps ST -> CSI = 7 ; 101 ; pm ; ps ; 0|1 n   (rev >= 1.331)
```

Logical channels: `'music'` is one reserved physical channel (2 by default),
`'sfx'` rotates over the rest (3..15), and a number 2..15 is used as given.
Operations are serialized through one promise chain and each waits for the
socket to accept its bytes, so a multi-megabyte upload cannot be overtaken by
the `Queue` that plays it.

## Using it

```js
const { Terminal } = require('ansi-bbs-utils');

const term = new Terminal(socket);
socket.on('data', chunk => term.feed(chunk));          //  replies must get back
term.on('input', bytes => yourKeyParser.feed(bytes));

term.setTerminalType(ttype);
term.cterm.queryDeviceAttributes();                    //  optional: learn client + revision

const probe = await term.probeAudio({ timeout : 2000 });
//  { backend : 'cterm' | 'none', files : bool, client, ctermVersion }

const audio = term.audio;
audio.asset({ name : 'music/lobby', path : '/srv/audio/lobby.ogg' });
audio.asset({ name : 'sfx/hit', bytes : Buffer.from(...) });

const music = await audio.play('music', 'music/lobby', { loop : true, volume : 60, fadeIn : 500 });
const hit = await audio.play('sfx', 'sfx/hit', { pan : 40 });
await music.volume(30, { ramp : 2000 });
await music.stop({ fade : 1000 });
audio.on('idle', ({ channel, handle, name }) => { /* hit finished */ });
```

- `play()` and friends return promises that reject on a write failure (a
  closed socket) or an argument error. Timeouts waiting for the terminal never
  reject: silence is treated as "no" or "unknown".
- Tones (`audio.playTone('sfx', { hz : 440, duration : 250 })`) work on a
  terminal that has the audio APC but no file decoder.
- `term.audio` before a probe, or on a terminal without audio, is a null
  session: everything resolves, nothing is written. Code paths do not need to
  branch.
- `audio.formatSupported('ogg', 'vorbis')` returns `true`, `false` or
  `undefined` (no decoder, a CTerm revision without the query, or no answer).
  When it is `undefined`, use Ogg Vorbis or WAV.

## Formats

Whatever the client's libsndfile decodes. Ogg Vorbis and WAV are safe on every
build (IcyTerm decodes Vorbis natively; Opus needs its optional libopus
feature). MP3 needs libsndfile 1.1.0 or later on a SyncTERM build and is not
listed for IcyTerm. Ask rather than assume: `formatSupported()`.

Prefer small files. An upload rides the telnet session as base64 (about 1.37
times the file size) and will crawl under SyncTERM's baud-rate emulation. The
once-per-BBS cache means a returning caller pays that cost only once.

## Cache names

Names are validated to the stricter implementation's rules (IcyTerm):
segments of `[A-Za-z0-9._-]` joined by `/`, no empty, `.` or `..` segments, at
most 128 characters. Namespacing (`music/lobby`, `sfx/hit`) is encouraged.

## What to check on a real terminal

| Check | Expect |
|---|---|
| `queryDeviceAttributes()` | `term.termClient` and `term.ctermVersion` set |
| `probeAudio()` on SyncTERM 1.9 or NetRunner | `backend : 'none'`, nothing drawn, nothing typed |
| `ensureAsset()` twice, then reconnect and once more | one `C;S` in total |
| `play('music', …, { loop })`, `volume(…, { ramp })`, `stop({ fade })` | audible, smooth |
| `play('sfx', …)` while typing | an `idle` event; no stray characters in the input |
| a 3 MB Vorbis file | wall time acceptable; no interleaving glitches |
| the same with baud emulation on | still correct, just slow |
| `formatSupported()` for Vorbis, Opus, MP3 | answers match the client build |
| ANSI music alongside a looping track | both play |

## Testing without a terminal

`Testing.FakeCTerm` plays the terminal's side: give it to a `Terminal` as the
socket, feed its replies back, and it answers queries, keeps a cache with
MD5s, "plays" queued buffers on a timer and reports idle channels.

```js
const { Testing : { FakeCTerm } } = require('ansi-bbs-utils');

const { fake, term } = FakeCTerm.connect({ sndfile : true, playbackMs : 100 });
await term.probeAudio();
await term.audio.play('music', { name : 'music/lobby', bytes }, { loop : true });
assert.equal(fake.channels.get(2).running, true);
assert.ok(fake.apcs.includes('SyncTERM:A;Queue;C=2;S=0;L'));
```

Options: `client` (`cterm` | `icy_term` | anything else answers no DA),
`ctermVersion`, `audio : false` (no audio APC at all), `sndfile : false`
(tones only), `formats` (`{ '32;96' : true }`), `playbackMs`, `cache` (share
a `Map` between fakes to model one client across sessions),
`fragmentReplies`.
