const { CSI } = require('./common');

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

const Color256To16Table = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    0, 4, 4, 4, 12, 12, 2, 6, 4, 4, 12, 12, 2, 2, 6, 4,
    12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10,
    10, 10, 10, 14, 1, 5, 4, 4, 12, 12, 3, 8, 4, 4, 12, 12,
    2, 2, 6, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10,
    14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 5, 4, 12, 12, 1, 1,
    5, 4, 12, 12, 3, 3, 8, 4, 12, 12, 2, 2, 2, 6, 12, 12,
    10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 1, 5,
    12, 12, 1, 1, 1, 5, 12, 12, 1, 1, 1, 5, 12, 12, 3, 3,
    3, 7, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14,
    9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9,
    13, 12, 11, 11, 11, 11, 7, 12, 10, 10,
    10, 10, 10, 14, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13,
    9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9,
    9, 13, 11, 11, 11, 11, 11, 15, 0, 0, 0, 0, 0, 0, 8, 8,
    8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 15, 15, 15, 15, 15, 15
];

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

    //  nearest match RGB -> pallet index only allowing top 16c
    static rgbTo16Color(r, g, b) {
        const c256 = ColorXTerm256.rgbToColor(r, g, b);
        return Color256To16Table[c256 & 0xff];
    }

    static colorTo16Color(n) {
        return Color256To16Table[n & 0xff];
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