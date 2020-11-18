const {
    CSI,
    AsSequence,
    wantAsSequence
} = require('../common');

module.exports = class Handler {
    constructor(terminal) {
        this.terminal = terminal;
    }

    _addOutputSequenceMethods(src) {
        Object.keys(src).forEach(shortName => {
            this[shortName] = (...args) => {
                const code = src[shortName];

                const asSequence = wantAsSequence(...args);
                if (asSequence) {
                    args.pop();
                }

                const seq = `${CSI}${args.join(';')}${code}`;
                return this._seqOrWrite(seq, asSequence);
            }
        });
    };

    _seqOrWrite(seq, asSequence) {
        return AsSequence === asSequence ? seq : this.terminal.rawWrite(seq);
    }
};