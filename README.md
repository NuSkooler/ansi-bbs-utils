# ANSI-BBS Utilities
Utilities for ANSI-BBS and compatible terminals.

**WARNING** This is still highly experimental and incomplete. Any/everything can change at any time!

## Wait, what?
ANSI-BBS refers to a set of standards and semi standards commonly used in the BBS world. ANSI escape sequences being the main area where various "standards" have evolved over the years but have never officially been formalized. This library attempts to slightly tame the anarchy.

If you're looking for something to really rock a modern terminal, this is probably not the place. You may be interested in something like [terminal-kit](https://github.com/cronvel/terminal-kit) or [@blessed/neo-blessed](https://github.com/blessedjs/neo-blessed) instead.

## Standards
Some, but not all of the standards at least partially dealt with here:
* [ANSI-BBS](http://ansi-bbs.org/)
* [cterm](docs/reference/cterm.txt)
* [bansi](docs/reference/bansi.txt)
* [vtx](docs/reference/vtx.txt)

## Requirements
Node.js 22 or later. The only runtime dependency is `iconv-lite`.

## Usage
### Basic
```js
const { Terminal } = require('ansi-bbs-utils');

const term = new Terminal(socket);
term.setTerminalType('ansi-bbs');
term.fgColor('green').write('Hello, world!');
```

### Standards
```js
term.ed(2)
    .cuu().up()
    .down(2)
    .back().forward()
    .left().right();
```

### Colors
```js
//  true color when available
term.setTerminalType('xterm-truecolor');
term.fgRGB(255, 0, 215);  //  produces 24-bit seq

//  ...nearest match colors otherwise
term.setTerminalType('xterm-256color');
term.fgRGB(255, 0, 215);  //  produces 8-bit/256 near match = 200

term.setTerminalType('ansi-bbs');
term.fgRGB(255, 0, 215);  //  produces nearest 16c color

//  selection
term.red()              //  definitely red
    .fgColor(9)         //  red
    .fgColor(128, 0, 0) //  red
    .fgRGB(128, 0, 0)   //  alias to fgColor
    .fgColor(160)       //  "Red3"
    .sgr('red')         //  red
    .sgr(31)            //  ...still red.
    .redBG();           //  OK fine, the background. But red.
```

### Sequences without writing
Every output method takes `AsSequence` as its last argument to return the
escape sequence instead of writing it:

```js
const { Common: { AsSequence } } = require('ansi-bbs-utils');

const seq = term.goto(1, 1, AsSequence) + term.fgColor('red', AsSequence);
```

## Capabilities
```js
const twoFiftySix = term.getCapabilities().has('8bit-color');
term.hasCapability('24bit-color');
term.addCapability('vtx');  //  🔥
```

Capabilities are per `Terminal` instance: adding one after probing a remote
terminal never affects another connection of the same terminal type.

## Input: terminal replies
When you ask a terminal something (device attributes, a CTerm feature query, a
cache listing) the answer arrives mixed in with keystrokes. Feed every inbound
chunk through the terminal and it separates the two: replies become events,
everything else comes back as `input` for your own key handling, in order and
with sequences kept whole across TCP fragments.

```js
socket.on('data', chunk => term.feed(chunk));

term.on('input', bytes => keyParser.feed(bytes));      //  keystrokes etc.
term.on('device attributes', da => {
    //  also sets term.termClient / term.ctermVersion
    console.log(da.client, da.ctermVersion);           //  'cterm', '1.332'
});
term.on('report', ({ prefix, params }) => {});         //  CSI = 7 ; 100 ; 1 n
term.on('apc', ({ body }) => {});                      //  ESC _ ... ESC \
term.on('reply error', ({ reason, dropped }) => {});   //  overflow | timeout | aborted | flushed

term.ecma.cpr();  //  or any query; replies show up above
```

This is a pre-filter, not a key parser: it never interprets keyboard
sequences. A lone `ESC` (or `ESC [` with digits) is held for at most
`escapeTimeout` (50 ms) in case a reply follows in the next packet, then passed
through. A reply in progress is bounded (`maxApcLength`, `maxCsiLength`) and
timed (`replyTimeout`, 2 s); on either limit it is dropped with a `reply error`
rather than turned into keystrokes. Options go in the constructor:
`new Terminal(socket, { input: { captureCPR: true } })`. The parser is also
available standalone as `ReplyParser` for hosts with their own terminal object.

## Audio
Real audio files (Ogg Vorbis, WAV, FLAC, ...) on terminals that support the
CTerm/SyncTERM audio APC (SyncTERM master and IcyTerm 0.8.4+ at the time of
writing). Needs the input side above so the terminal's answers get back.

```js
const { backend, files } = await term.probeAudio();   //  'cterm' | 'none'

const audio = term.audio;                             //  a do-nothing session when backend is 'none'
audio.asset({ name : 'music/lobby', path : '/srv/audio/lobby.ogg' });
audio.asset({ name : 'sfx/hit', bytes : hitWav });

const music = await audio.play('music', 'music/lobby', { loop : true, volume : 60 });
await audio.play('sfx', 'sfx/hit', { pan : -30 });    //  effects rotate over their own channels
await music.volume(30, { ramp : 1000 });
await music.stop({ fade : 1000 });

audio.on('idle', ({ channel, handle }) => {});        //  a channel finished
await audio.formatSupported('ogg', 'vorbis');         //  true | false | undefined (cannot ask)
```

Assets are uploaded to the terminal's cache once per BBS, not once per
session, and Ogg Vorbis is the safe default format. Full notes, including what
the wire looks like and what to test on a real terminal, are in
[docs/audio.md](docs/audio.md). `Testing.FakeCTerm` is a scripted terminal for
your own tests.

## Development
```sh
npm install
npm test                # node:test
npm run test:coverage   # with a coverage report
```

## License
See [LICENSE](LICENSE)
