# ANSI-BBS Utilities
Utilities for ANSI-BBS and compatible terminals.

## Wait, what?
ANSI-BBS refers to a set of standards and semi standards commonly used in the BBS world. ANSI escape sequences being the main area where various "standards" have evolved over the years but have never officially been formalized. This library attempts to slightly tame the anarchy.

If you're looking for something to really rock a modern terminal, this is probably not the place. You may be interested in one of the many Blessed libraries such as [neo-blessed](https://github.com/dunstad/neo-blessed) instead.

## Standards
Some, but not all of the standards at least partially dealt with here:
* [ANSI-BBS](http://ansi-bbs.org/)
* [cterm](docs/reference/cterm.txt)
* [bansi](docs/reference/bansi.txt)
* [vtx](docs/reference/vtx.txt)

## Usage
### Basic
```
const { Terminal } = require('ansi-bbs-utils');

const term = new Terminal(socket);
term.setTerminalType('ansi-bbs');
term.fgColor('green').write('Hello, world!');
```

### Standards
```
term.ed(2)
    .cuu().up()
    .down(2)
    .back().forward()
    .left().right();
```

### Colors
```
//  nearest match colors
term.setTerminalType('xterm-truecolor');
term.rgb(255, 0, 215);  //  produces 24-bit seq
term.setTerminalType('xterm-256');
term.rgb(255, 0, 215);  //  produces 8-bit/256 near match = 200
term.setTerminalType('ansi-bbs');
term.rgb(255, 0, 215);  //  produces nearest 16c color

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

## Capabilities
const twoFiftySix = term.getCapabilities().has('8bit-color');

term.addCapability('vtx');  //  🔥
##

## License
See [LICENSE](LICENSE)
