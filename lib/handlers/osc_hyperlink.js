const {
    CSI,
    AsSequence,
} = require('../common');
const Handler = require('./handler');

module.exports = class OSCHyperlink extends Handler {
    constructor(terminal) {
        super(terminal);
    }

    //  https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
    //  supported by a number of terminals, but still an outsider
    hyperlink(url, text = '', asSequence = false) {
        const seq = `${CSI}8;;${url}${text}\u001b\\${text||url}${CSI}8;;\u001b\\`;
        return this._seqOrWrite(seq, asSequence);
    }
};