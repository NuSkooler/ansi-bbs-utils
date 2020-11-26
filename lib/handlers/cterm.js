const {
    CSI
} = require('../common');

const Handler = require('./handler');

const OutputSequenceCodes = {
};

module.exports = class CTerm extends Handler {
    constructor(terminal) {
        super(terminal);
    }

    //  see cterm.txt
    fnt(n, font, asSequence = false) {

    }

    //  alias for fnt
    setFont(n, font, asSequence = false) {
        return this.fnt(n, font, asSequence);
    }
};
