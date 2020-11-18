const {
    CSI,
    AsSequence,
} = require('../common');

const Handler = require('./handler');

const HEX3Chars = '0123456789:;<=>?';

const hex3encode = (input) => {
    let result = '';
    for (let i = 0; i < input.length; ++i) {
        const c = input.charCodeAt(i);
        result += HEX3Chars[c >> 4];
        result += HEX3Chars[c & 0x0f];
    }

    return result;
};

module.exports = class VTX extends Handler {
    constructor(terminal) {
        super(terminal);
    }

    // AUDIO COMMANDS CSI 1 ... _
    // ==========================
    // CSI 1 ; 0 ; n ; t ; hex3 '_' : define audio object
    //     n = audio number; 1-64
    //     t = type:   0 = url : unicode encoded characters
    //                 1 = UTF8 url : hex3 encoded
    //                 2 = raw UTF8 mp3 : hex3 encoded
    //                 3 = raw UTF8 mp3 deflated : hex3 encoded
    //                 4 = raw UTF8 mp3 Base64: hex3 encoded (https://github.com/nodeca/pako/tree/master/dist)
    //     data;       (0) ascii;ascii... or hexstring where 0-9=0-9,A-F=:-? (0x30-0x3F)
    defineAudioObject(n, type, encoded, asSequence = false) {
        return this._seqOrWrite(`${CSI}1;0;${n};${type};${encoded}_`, asSequence);
    }

    defineAudioObjectURL(n, url, asSequence = false) {
        return this.defineAudioObject(n, 1, hex3encode(url), asSequence);
    }

    // CSI 1 ; 0 ; n '_' : clear audio object n
    clearAudioObject(n, asSequence = false) {
        return this._seqOrWrite(`${CSI}1;0;${n}_`, asSequence);
    }

    // CSI 1 ; 0 '_' : clear all audio objects.
    clearAllAudioObjects(asSequence = false) {
        return this._seqOrWrite(`${CSI}1;0;_`, asSequence);
    }

    // CSI 1 ; 1 ; n '_' : select audio object.
    //     n = audio number; 1-64
    selectAudioObject(n, asSequence = false) {
        return this._seqOrWrite(`${CSI}1;1;${n}_`, asSequence);
    }

    // CSI 1 ; 2 ; p '_' : play / pause / stop / rewind
    //     p : 0 = stop & rewind
    //         1 = play
    //         2 = pause
    controlAudio(control, asSequence = false) {
        return this._seqOrWrite(`${CSI}1;2;${control}_`, asSequence);
    }

    stopAndRewindAudio(asSequence = false) {
        return this.controlAudio(0);
    }

    playAudio(asSequence = false) {
        return this.controlAudio(1);
    }

    pauseAudio(asSequence = false) {
        return this.controlAudio(2);
    }

    // CSI 1 ; 3 ; v '_' : set volume (0-100)
    setAudioVolume(vol, asSequence = false) {
        if (vol < 0 || vol > 100) {
            return AsSequence === asSequence ? '' : this.terminal;  //  allow chain
        }

        return this._seqOrWrite(`${CSI}1;3;${vol}_`, asSequence);
    }

    hyperlink(url, text = '', asSequence = false) {
        //  :TODO: VTX hyperlinks
        return this._seqOrWrite(seq, asSequence);
    }
};
