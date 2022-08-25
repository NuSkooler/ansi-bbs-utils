const {
    AsSequence,
} = require('./common');

const Handler = require('./handlers/handler');

const assert = require('assert');

const PipeColorCodeToSGRMap = {
    0   : [ 'reset', 'black' ],
    1   : [ 'reset', 'blue' ],
    2   : [ 'reset', 'green' ],
    3   : [ 'reset', 'cyan' ],
    4   : [ 'reset', 'red' ],
    5   : [ 'reset', 'magenta' ],
    6   : [ 'reset', 'yellow' ],
    7   : [ 'reset', 'white' ],

    8   : [ 'bold', 'black' ],
    9   : [ 'bold', 'blue' ],
    10  : [ 'bold', 'green' ],
    11  : [ 'bold', 'cyan' ],
    12  : [ 'bold', 'red' ],
    13  : [ 'bold', 'magenta' ],
    14  : [ 'bold', 'yellow' ],
    15  : [ 'bold', 'white' ],

    16  : [ 'blackBG' ],
    17  : [ 'blueBG' ],
    18  : [ 'greenBG' ],
    19  : [ 'cyanBG' ],
    20  : [ 'redBG' ],
    21  : [ 'magentaBG' ],
    22  : [ 'yellowBG' ],
    23  : [ 'whiteBG' ],

    24  : [ 'blink', 'blackBG' ],
    25  : [ 'blink', 'blueBG' ],
    26  : [ 'blink', 'greenBG' ],
    27  : [ 'blink', 'cyanBG' ],
    28  : [ 'blink', 'redBG' ],
    29  : [ 'blink', 'magentaBG' ],
    30  : [ 'blink', 'yellowBG' ],
    31  : [ 'blink', 'whiteBG' ],
};

module.exports = class ControlCodes extends Handler {
    constructor(terminal) {
        super(terminal);

        //  relies on ansi for SGR
        assert(terminal.ansi);
    }

    //  :TODO: methods for WildCat!, PCB, WWIV, etc.

    fromPipeCodes(input, asSequence = false) {
        const RE = /(\|([0-9]{1,2}))/g;

        let m;
        let output = '';
        let lastIndex = 0;

        while ((m = RE.exec(input))) {
            const cc = parseInt(m[2]);
            output += input.substr(lastIndex, m.index - lastIndex) + this._pipeColorCodeToANSI(cc);
            lastIndex = RE.lastIndex;
        }

        return this._seqOrWrite((0 === output.length ? input : output + input.substr(lastIndex)), asSequence);
    }

    _pipeColorCodeToANSI(cc) {
        return this.terminal.ansi.sgr(...(PipeColorCodeToSGRMap[cc] || [ 'normal' ]), AsSequence);
    }
};