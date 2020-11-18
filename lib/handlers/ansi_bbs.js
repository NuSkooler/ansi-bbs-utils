const {
    CSI,
    wantAsSequence,
} = require('../common');
const Handler = require('./handler');

const OutputSequenceCodes = {
    //  Cursor Up - CSI p1 A
    //  p1 = cells, default = 1
    cuu         : 'A',
    up          : 'A',  //  Alias

    //  Cursor Down - CSI p1 B
    //  p1 = cells, default = 1
    cud         : 'B',  //  Cursor Down
    down        : 'B',  //  Alias

    //  Cursor Forward - CSI p1 C
    //  p1 = cells, default = 1
    cuf         : 'C',  //  Cursor Forward
    forward     : 'C',  //  Alias
    right       : 'C',  //  Alias

    //  Cursor Back - CSI p1 D
    //  p1 = cells, default = 1
    cub         : 'D',  //  Cursor Back
    back        : 'D',  //  Alias
    left        : 'D',  //  Alias

    cup         : 'H',  //  Cursor Position - CSI p1 ; p2 H
    goto        : 'H',  //  Alias

    //
    //  Erase In Display - CSI p1 J
    //  p1 = 0 = clear from cursor to end of screen (default)
    //  p1 = 1 = clear from cursor to beginning of screen
    //  p1 = 2 = clear entire screen
    //  p1 = 3 = clear entire screen + delete saved scrollback buffer
    //           (xterm; not widely supported in ANSI-BBS)
    //
    //  ANSI-BBS variations:
    //  - If p2 is 2, also moves cursor to 1/1 (many terms, ANSI.SYS)
    //  - Erased characters are set to the current attribute
    //
    //  Known issues:
    //  - NetRunner always clears a current screen height's
    //    worth (e.g. 25 rows) of data.
    //
    //  Additional Notes:
    //  - To fully clear an ANSI-BBS terminal's screen it is
    //    recommended to use a sequence of SGR 0 + ED 2 + CUP
    //
    ed          : 'J',  //  Erase In Display
    eraseData   : 'J',  //  Alias
    eraseInPage : 'J',  //  Alias

    //  Erase In Line - CSI p1 K
    //  p1 = 0 = clear from cursor to end of line (default)
    //  p1 = 1 = clear from cursor to beginning of line
    //  p1 = 2 = clear entire line
    //  Note: cursor position does not change
    //
    //  ANSI-BBS variations:
    //  - Most implementations clear to current attribute
    //    while VT100 for example clears to black.
    //
    el          : 'K',  //  Erase In Line
    eraseLine   : 'K',  //  Alias

};

//  see cterm.txt
const SGRAttributes = {
    reset           : 0,

    brightIntensity : 1,
    bold            : 1,    //  alias

    dimIntensity    : 2,
    dim             : 2,    //  alias

    italic          : 3,    //  Not ANSI-BBS
    underline       : 4,    //  Not ANSI-BBS

    blink           : 5,
    fastBlink       : 6,    //  Not widely supported; often a blink alias

    negative        : 7,

    conceal         : 8,
    hidden          : 8,    //  alias

    crossedOut      : 9,    //  Not ANSI-BBS

    normalIntensity : 22,
    normal          : 22,   //  alias

    notItalic       : 23,   //  Not ANSI-BBS
    italicOff       : 23,   //  alias

    notUnderline    : 24,   //  Not ANSI-BBS
    underlineOff    : 24,

    blinkOff        : 25,
    steady          : 25,   //  alias

    positive        : 27,

    reveal          : 28,   //  Not ANSI-BBS
    concealOff      : 28,   //  alias

    notCrossedOut   : 29,   //  Not ANSI-BBS

    black           : 30,
    red             : 31,
    green           : 32,
    yellow          : 33,
    blue            : 34,
    magenta         : 35,
    cyan            : 36,
    white           : 37,

    //  :TODO: Move to xterm.js - rgb256->xterm-256 cap
    setFGColor      : 38,   //  5;n - see https://jonasjacek.github.io/colors/
    extendedFG      : 38,   //  alias

    defaultFG       : 39,   //  ANSI-BBS: white

    blackBG         : 40,
    redBG           : 41,
    greenBG         : 42,
    yellowBG        : 43,
    blueBG          : 44,
    magentaBG       : 45,
    cyanBG          : 46,
    whiteBG         : 47,

    //  :TODO: Move to xterm.js - rgb(r, g, b) ->xterm-256 cap
    setBGColor      : 48,   //  256 color support - 5;n - see https://jonasjacek.github.io/colors/
    extendedBG      : 48,   //  alias

    defaultBG       : 49,   //  ANSI-BBS: black
}

//  Delegate for most of the "standard" ANSI-BBS sequences.
module.exports = class ANSI_BBS extends Handler {
    constructor(terminal) {
        super(terminal);

        //  most methods can be generated
        this._addOutputSequenceMethods(OutputSequenceCodes);
    }

    //  Select Graphic Rendition - CSI p1 m
    //  p1 = 0 = reset (default)
    //  p1;p2;...pN =
    //
    //  ANSI-BBS variations:
    //  - Reset generally means white on black
    //  - See cterm.txt for ANSI-BBS style attributes
    //  - It's generally best to try to stick with color attributes only
    //
    sgr(...args) {
        const asSequence = wantAsSequence(...args);
        if (asSequence) {
            args.pop();
        }
        const params = [];
        args.forEach(arg => {
            const t = typeof(arg);
            if ('string' === t) {
                const attr = SGRAttributes[arg];
                if (undefined !== attr) {
                    params.push(attr);
                }
            } else if ('number' === t) {
                params.push(arg);
            }
        });

        const seq = `${CSI}${params.join(';')}m`;
        return this._seqOrWrite(seq, asSequence);
    }

    //     //  :TODO: red(), white(), black(), ... methods

    //  To reset colors to their defaults, use ESC[39;49m (not supported on some terminals), or reset all attributes with
    //  :TODO: resetColors()
    //  :TODO: resetScreen() / clearScreen() ANSI-BBS variants
};
