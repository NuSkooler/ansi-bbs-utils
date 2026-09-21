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

                //  A trailing false/undefined is a wrapper's
                //  "not AsSequence" default parameter riding along,
                //  not a parameter of the sequence.
                const last = args[args.length - 1];
                if (args.length && (false === last || undefined === last)) {
                    args.pop();
                }

                const seq = `${CSI}${args.join(';')}${code}`;
                return this._seqOrWrite(seq, asSequence);
            }
        });
    };

    _seqOrWrite(seq, asSequence) {
        if (AsSequence === asSequence) {
            return seq;
        }

        //  Sequences themselves are ASCII, but text can ride along
        //  with them (pipe code output, link text): encode for the
        //  terminal, minus the line feed conversion write() applies
        //  to prose.
        return this.terminal.rawWrite(this.terminal.encode(seq, false));
    }
};
