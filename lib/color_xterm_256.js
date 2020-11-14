const { CSI } = require('./ansi');

const rgbTo6Cube = (v) => {
    if (v < 48) {
        return 0;
    }

    if (v < 114) {
        return 1;
    }

    return Math.floor((v - 35) / 40);
}

const colorDistSq = (r1, b1, g1, r2, b2, g2) => {
    return (
        (r1 - r2) * (r1 - r2) +
        (g1 - g2) * (g1 - g2) +
        (b1 - b2) * (b1 - b2)
    );
}

const Q2C = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

//  Utilities for xterm 256 color palette
module.exports = class ColorXTerm256 {

    //  nearest match RGB -> palette index
    static rgbToColor(r, g, b) {
        const qr = rgbTo6Cube(r);
        const cr = Q2C[qr];
        const qg = rgbTo6Cube(g);
        const cg = Q2C[qg];
        const qb = rgbTo6Cube(b);
        const cb = Q2C[qb];

        //  use exact match if we have one
        if (cr === r && cg === g && cb === b) {
            return (16 + (36 * qr) + (6 * qg) + qb);
        }

        // find closest grey
        const greyAvg = (r + g + b) / 3;
        const greyIndex = greyAvg > 238 ?
            23 :
            (greyAvg - 3) / 10;
        const grey = 8 + (10 * greyIndex);

        // find closest grey or 6x6x6 match
        const d = colorDistSq(cr, cg, cb, r, g, b);
        let colorIndex;
        if (colorDistSq(grey, grey, grey, r, g, b) < d) {
            colorIndex = 232 + greyIndex;
        } else {
            colorIndex = 16 + (36 * qr) + (6 * qg) + qb;
        }

        return Math.floor(colorIndex);
    }

    static fgColor(n) {
        return `${CSI}38;5;${n}m`;
    }

    static bgColor(n) {
        return `${CSI}48;5;${n}m`;
    }

    //  nearest match -> xterm-256 style ESC seq (foreground)
    static fgRGB(r, g, b) {
        return ColorXTerm256.fgColor(ColorXTerm256.rgbToColor(r, g, b));
    }

    //  nearest match -> xterm-256 style ESC seq (background)
    static bgRGB(r, g, b) {
        return ColorXTerm256.bgColor(ColorXTerm256.rgbToColor(r, g, b));
    }
};