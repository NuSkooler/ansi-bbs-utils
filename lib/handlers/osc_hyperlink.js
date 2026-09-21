const Handler = require('./handler');

const OSC = ']';
const ST = '\\';

module.exports = class OSCHyperlink extends Handler {
    constructor(terminal) {
        super(terminal);
    }

    //  https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
    //  supported by a number of terminals, but still an outsider
    //
    //  OSC 8 ; params ; URI ST <text> OSC 8 ; ; ST
    //
    hyperlink(url, text = '', asSequence = false) {
        const seq = `${OSC}8;;${url}${ST}${text || url}${OSC}8;;${ST}`;
        return this._seqOrWrite(seq, asSequence);
    }
};
