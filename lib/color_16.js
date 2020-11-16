const ColorXTerm256 = require('./color_xterm_256');
const { CSI } = require('./common');

module.exports = class ColorTerm16 {
    //  nearest match -> standard 16 color value
    //  note that high 90...97 are not ANSI-BBS compatible
    static rgbToColor(r, g, b) {
        return ColorXTerm256.rgbTo16Color(r, g, b);
        // return (color16 < 8) ?
        //     30 + color16 :
        //     82 + color16;
    }

    static fgColor(n) {
        return ColorTerm16._makeSequence(ColorXTerm256.colorTo16Color(n), true);
    }

    static bgColor(n) {
        return ColorTerm16._makeSequence(ColorXTerm256.colorTo16Color(n), false);
    }

    //  nearest match -> standard 16 color ESC seq (foreground)
    static fgRGB(r, g, b) {
        return ColorTerm16.fgColor(ColorTerm16.rgbToColor(r, g, b));
    }

    //  nearest match -> standard 16 color ESC seq (background)
    static bgRGB(r, g, b) {
        return ColorTerm16.bgColor(ColorTerm16.rgbToColor(r, g, b));
    }

    //  produce a sequence for color n
    //  if n > 7 sequence include "set to bright"
    static _makeSequence(n, foreground) {
        let bright = '';
        if (n > 7) {
            bright = `${CSI}1m`;
            n -= 8;
        }
        n += foreground ? 30 : 40;
        return `${bright}${CSI}${n}m`;
    }
};
