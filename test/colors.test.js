'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ColorXTerm256 = require('../lib/color_xterm_256');
const ColorTerm16 = require('../lib/color_16');
const ColorXTerm24Bit = require('../lib/color_xterm_24bit');

const { CSI } = require('./helpers');

//
//  Characterization values: pinned from the implementation as of
//  0.1.0 (a port of tmux's colour matching). Change deliberately.
//
test('256: RGB to nearest palette index', () => {
    const cases = [
        [ [ 0, 0, 0 ], 16 ],            //  cube black, not palette 0
        [ [ 255, 255, 255 ], 231 ],     //  cube white, not palette 15
        [ [ 255, 0, 215 ], 200 ],       //  exact cube match (README example)
        [ [ 128, 0, 0 ], 88 ],
        [ [ 0, 255, 0 ], 46 ],
        [ [ 100, 100, 100 ], 59 ],
        [ [ 250, 250, 250 ], 231 ],
        [ [ 18, 18, 18 ], 233 ],        //  greyscale ramp
        [ [ 255, 0, 0 ], 196 ],
        [ [ 0, 0, 255 ], 21 ],
    ];

    for (const [ rgb, expected ] of cases) {
        assert.equal(ColorXTerm256.rgbToColor(...rgb), expected, JSON.stringify(rgb));
    }
});

test('256: RGB to nearest 16-color index', () => {
    const cases = [
        [ [ 255, 0, 215 ], 9 ],
        [ [ 0, 0, 0 ], 0 ],
        [ [ 255, 255, 255 ], 15 ],
        [ [ 128, 0, 0 ], 1 ],
        [ [ 0, 255, 0 ], 10 ],
        [ [ 100, 100, 100 ], 8 ],
        [ [ 0, 0, 255 ], 12 ],
    ];

    for (const [ rgb, expected ] of cases) {
        assert.equal(ColorXTerm256.rgbTo16Color(...rgb), expected, JSON.stringify(rgb));
    }
});

test('256: palette index to 16-color index', () => {
    const cases = {
        0 : 0, 7 : 7, 8 : 8, 15 : 15,   //  the first 16 map onto themselves
        16 : 0, 21 : 12, 196 : 9, 200 : 9, 226 : 11, 231 : 15,
        232 : 0, 244 : 7, 255 : 15,
    };

    for (const [ n, expected ] of Object.entries(cases)) {
        assert.equal(ColorXTerm256.colorTo16Color(parseInt(n)), expected, n);
    }

    //  only the low byte is significant
    assert.equal(ColorXTerm256.colorTo16Color(256 + 21), 12);
});

test('256: sequences', () => {
    assert.equal(ColorXTerm256.fgColor(200), `${CSI}38;5;200m`);
    assert.equal(ColorXTerm256.bgColor(200), `${CSI}48;5;200m`);
    assert.equal(ColorXTerm256.fgRGB(255, 0, 215), `${CSI}38;5;200m`);
    assert.equal(ColorXTerm256.bgRGB(255, 0, 215), `${CSI}48;5;200m`);
});

test('16: sequences use bold + standard color for the bright half', () => {
    assert.equal(ColorTerm16.fgColor(1), `${CSI}31m`);
    assert.equal(ColorTerm16.fgColor(9), `${CSI}1m${CSI}31m`);
    assert.equal(ColorTerm16.bgColor(3), `${CSI}43m`);
    assert.equal(ColorTerm16.bgColor(11), `${CSI}1m${CSI}43m`);
});

test('16: palette indexes above 15 are folded down first', () => {
    assert.equal(ColorTerm16.fgColor(200), `${CSI}1m${CSI}31m`);
    assert.equal(ColorTerm16.bgColor(21), `${CSI}1m${CSI}44m`);
});

test('16: RGB goes through the 256 palette to a 16-color match', () => {
    assert.equal(ColorTerm16.rgbToColor(255, 0, 0), 9);
    assert.equal(ColorTerm16.fgRGB(255, 0, 0), `${CSI}1m${CSI}31m`);
    assert.equal(ColorTerm16.bgRGB(0, 0, 255), `${CSI}1m${CSI}44m`);
});

test('24-bit: sequences', () => {
    assert.equal(ColorXTerm24Bit.fgRGB(1, 2, 3), `${CSI}38;2;1;2;3m`);
    assert.equal(ColorXTerm24Bit.bgRGB(1, 2, 3), `${CSI}48;2;1;2;3m`);
});
