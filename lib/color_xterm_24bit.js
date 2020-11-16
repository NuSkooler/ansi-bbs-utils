const { CSI } = require('./common');

//  https://gist.github.com/XVilka/8346728
//  https://tintin.mudhalla.net/info/truecolor/

//  :TODO: detection methods -- move file from handlers

module.exports = class ColorXTerm24Bit {
    static fgRGB(r, g, b) {
        return `${CSI}38;2;${r};${g};${b}m`;
    }

    static bgRGB(r, g, b) {
        return `${CSI}48;2;${r};${g};${b}m`;
    }
};