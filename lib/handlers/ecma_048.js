const {
    CSI
} = require('../common');

const Handler = require('./handler');

const OutputSequenceCodes = {
    //  Cursor Next Line - CSI p1 E
    //  Move to beginning of line p1 lines down, default = 1
    cnl         : 'E',  //  Cursor Next Line
    nextLine    : 'E',  //  Alias

    //  Cursor Previous Line - CSI p1 F
    //  Move to beginning of line p1 lines up, default = 1
    cpl         : 'F',  //  Cursor Previous Line
    prevLine    : 'F',  //  Alias

    //  Cursor Horizontal Absolute - CSI p1 G
    //  Move cursor to column p1
    cha         : 'G',  //  Cursor Horizontal Absolute



    //  Device Status Report - CSI p1 ; n
    statusReport    : 'n',  //  Device Status Report

    //
    //  Request current cursor position.
    //  A Cursor Position Report (CPR) response will
    //  be made if supported in the form of:
    //  ESC [ y ; x R - where x,y is the cursor position.
    //
    //  Notes:
    //  - While many modern terminals support this, it
    //    is NOT ANSI-BBS compatible. Many legacy and DOS
    //    terminals are not supported.
    //  - Some terminals such as mTCP's telnet have a
    //    limited buffer for the number of inflight requests
    //    they can support at a time.
    //
    cpr                     : '6n', //  Cursor Position Report
    cursorPositionReport    : '6n', //  Alias

    //
    //  Request Terminal Size
    //
    //  Replies as though a CSI 6 n was received with the cursor in
    //  the bottom right corner.  i.e.: Returns the terminal size as
    //  a position report.
    //
    //  Notes:
    //  - A non-standard (cterm.txt, bansi.txt, etc.) extension
    //    a number of BBS terminals support.
    //
    requestTerminalSize     : '255n',   //  Request Terminal Size


    //  :TODO: hvp
};

module.exports = class ECMA48 extends Handler {
    constructor(terminal) {
        super(terminal);
        this._addOutputSequenceMethods(OutputSequenceCodes);
    }
};
