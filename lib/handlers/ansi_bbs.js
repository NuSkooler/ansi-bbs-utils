const { CSI } = require('../ansi');

const OutputSequenceCodes = {
    cuu         : 'A',  //  Cursor Up - CSI p1 A
    up          : 'A',  //  Alias

    cud         : 'B',  //  Cursor Down - CSI p1 B
    down        : 'B',  //  Alias

    cuf         : 'C',  //  Cursor Forward - CSI p1 C
    forward     : 'C',  //  Alias
    right       : 'C',  //  Alias

    cub         : 'D',  //  Cursor Back - CSI p1 D
    back        : 'D',  //  Alias
    left        : 'D',  //  Alias

    cnl         : 'E',  //  Cursor Next Line - CSI p1 E
    nextLine    : 'E',  //  Alias

    cpl         : 'F',  //  Cursor Previous Line - CSI p1 F
    prevLine    : 'F',  //  Alias

    cha         : 'G',  //  Cursor Horizontal Absolute - CSI p1 G

    cup         : 'H',  //  Cursor Position - CSI p1 ; p2 H
    goto        : 'H',  //  Alias

    //
    //  Erase In Display - CSI p1 J
    //
    //  ANSI-BBS variations:
    //  - If p2 is 2, also moves cursor to 1/1
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
};

//  Delegate for most of the "standard" ANSI-BBS sequences.
module.exports = class ANSI_BBS {
    constructor() {
        //  most methods can be generated
        this._generateMethods();
    }

    _generateMethods() {
        Object.keys(OutputSequenceCodes).forEach(shortName => {
            this[shortName] = (...args) => {
                const code = OutputSequenceCodes[shortName];
                return `${CSI}${args.join(';')}${code}`;
            }
        });
    }
};
