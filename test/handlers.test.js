'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { AsSequence } = require('../lib/common');
const ANSI_BBS = require('../lib/handlers/ansi_bbs');
const VTX = require('../lib/handlers/vtx');
const OSCHyperlink = require('../lib/handlers/osc_hyperlink');

const { ESC, CSI, makeTerminal } = require('./helpers');

describe('ansi_bbs', () => {
    test('sgr() maps names and passes numbers, ignoring unknown names', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.ansi.sgr('bold', 'red', AsSequence), `${CSI}1;31m`);
        assert.equal(term.ansi.sgr(AsSequence), `${CSI}m`);
        assert.equal(term.ansi.sgr('nope', 5, AsSequence), `${CSI}5m`);
        assert.equal(term.ansi.sgr(0, AsSequence), `${CSI}0m`);
    });

    test('generated movement and erase sequences', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.ansi.cuu(AsSequence), `${CSI}A`);
        assert.equal(term.ansi.up(2, AsSequence), `${CSI}2A`);
        assert.equal(term.ansi.down(3, AsSequence), `${CSI}3B`);
        assert.equal(term.ansi.right(AsSequence), `${CSI}C`);
        assert.equal(term.ansi.left(4, AsSequence), `${CSI}4D`);
        assert.equal(term.ansi.goto(3, 4, AsSequence), `${CSI}3;4H`);
        assert.equal(term.ansi.cup(AsSequence), `${CSI}H`);
        assert.equal(term.ansi.ed(2, AsSequence), `${CSI}2J`);
        assert.equal(term.ansi.el(AsSequence), `${CSI}K`);
        assert.equal(term.ansi.eraseLine(2, AsSequence), `${CSI}2K`);
    });

    test('without AsSequence the sequence is written and the terminal returned for chaining', () => {
        const { term, output } = makeTerminal('ansi');

        const ret = term.ansi.goto(1, 1).ed(2);
        assert.equal(ret, term);
        assert.equal(output(), `${CSI}1;1H${CSI}2J`);
    });

    test('color name shortcuts', () => {
        const { term, output } = makeTerminal('ansi');

        assert.equal(term.ansi.red(AsSequence), `${CSI}31m`);
        assert.equal(term.ansi.redBG(AsSequence), `${CSI}41m`);
        assert.equal(term.ansi.white(AsSequence), `${CSI}37m`);
        assert.equal(term.ansi.blackBG(AsSequence), `${CSI}40m`);

        term.ansi.red().whiteBG();
        assert.equal(output(), `${CSI}31m${CSI}47m`);
    });

    test('SGR attribute lookup', () => {
        assert.ok(ANSI_BBS.hasSGRAttribute('red'));
        assert.ok(ANSI_BBS.hasSGRAttribute('redBG'));
        assert.ok(ANSI_BBS.hasSGRAttribute('bold'));
        assert.ok(!ANSI_BBS.hasSGRAttribute('nope'));
        assert.ok(!ANSI_BBS.hasSGRAttribute('constructor'));
        assert.equal(ANSI_BBS.SGRAttributes.blink, 5);
    });
});

describe('ecma_048', () => {
    test('generated sequences', () => {
        const { term } = makeTerminal('xterm');

        assert.equal(term.ecma.cpr(AsSequence), `${CSI}6n`);
        assert.equal(term.ecma.cursorPositionReport(AsSequence), `${CSI}6n`);
        assert.equal(term.ecma.requestTerminalSize(AsSequence), `${CSI}255n`);
        assert.equal(term.ecma.statusReport(6, AsSequence), `${CSI}6n`);
        assert.equal(term.ecma.cha(5, AsSequence), `${CSI}5G`);
        assert.equal(term.ecma.nextLine(AsSequence), `${CSI}E`);
        assert.equal(term.ecma.prevLine(2, AsSequence), `${CSI}2F`);
    });
});

describe('control_codes', () => {
    test('pipe codes become SGR sequences', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(
            term.fromPipeCodes('|01Hi|15there|99x', AsSequence),
            `${CSI}0;34mHi${CSI}1;37mthere${CSI}22mx`
        );
        assert.equal(term.fromPipeCodes('|1a', AsSequence), `${CSI}0;34ma`);
        assert.equal(term.fromPipeCodes('|16|04!', AsSequence), `${CSI}40m${CSI}0;31m!`);
        assert.equal(term.fromPipeCodes('|24', AsSequence), `${CSI}5;40m`);
    });

    test('text without pipe codes is returned as-is', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.fromPipeCodes('plain', AsSequence), 'plain');
        assert.equal(term.fromPipeCodes('', AsSequence), '');
        assert.equal(term.fromPipeCodes('50|50', AsSequence), `50${CSI}22m`);
    });

    test('without AsSequence the result is written', () => {
        const { term, output } = makeTerminal('ansi');

        term.fromPipeCodes('|07x');
        assert.equal(output(), `${CSI}0;37mx`);
    });
});

describe('vtx', () => {
    test('hex3 encoding uses 0x30..0x3f for nibbles', () => {
        assert.equal(VTX.hex3encode('a.'), '612>');
        assert.equal(VTX.hex3encode('http://x/a.mp3'), '687474703:2?2?782?612>6=7033');
    });

    test('audio object sequences', () => {
        const { term } = makeTerminal('vtx');

        assert.equal(
            term.vtx.defineAudioObjectURL(1, 'http://x/a.mp3', AsSequence),
            `${CSI}1;0;1;1;687474703:2?2?782?612>6=7033_`
        );
        assert.equal(term.vtx.defineAudioObject(2, 0, 'http://x/b.mp3', AsSequence), `${CSI}1;0;2;0;http://x/b.mp3_`);
        assert.equal(term.vtx.clearAudioObject(3, AsSequence), `${CSI}1;0;3_`);
        assert.equal(term.vtx.clearAllAudioObjects(AsSequence), `${CSI}1;0;_`);
        assert.equal(term.vtx.selectAudioObject(2, AsSequence), `${CSI}1;1;2_`);
    });

    test('transport and volume sequences honour AsSequence', () => {
        const { term, output } = makeTerminal('vtx');

        assert.equal(term.vtx.playAudio(AsSequence), `${CSI}1;2;1_`);
        assert.equal(term.vtx.pauseAudio(AsSequence), `${CSI}1;2;2_`);
        assert.equal(term.vtx.stopAndRewindAudio(AsSequence), `${CSI}1;2;0_`);
        assert.equal(term.vtx.setAudioVolume(50, AsSequence), `${CSI}1;3;50_`);
        assert.equal(output(), '', 'nothing written when asking for sequences');

        //  writing returns the Terminal (not the handler) for chaining
        assert.equal(term.vtx.playAudio(), term);
        term.vtx.setAudioVolume(10);
        assert.equal(output(), `${CSI}1;2;1_${CSI}1;3;10_`);
    });

    test('out of range volume is a no-op that still chains', () => {
        const { term, output } = makeTerminal('vtx');

        assert.equal(term.vtx.setAudioVolume(101, AsSequence), '');
        assert.equal(term.vtx.setAudioVolume(-1), term);
        assert.equal(output(), '');
    });

    test('hyperlink degrades to text', () => {
        const { term } = makeTerminal('vtx');

        assert.equal(term.vtx.hyperlink('http://x', 'y', AsSequence), 'y');
        assert.equal(term.vtx.hyperlink('http://x', '', AsSequence), 'http://x');
    });
});

describe('osc_hyperlink', () => {
    test('OSC 8 framing with ST terminators', () => {
        const { term } = makeTerminal('xterm');
        const ST = `${ESC}\\`;

        assert.equal(
            term['osc-hyperlink'].hyperlink('http://x', 'y', AsSequence),
            `${ESC}]8;;http://x${ST}y${ESC}]8;;${ST}`
        );
        assert.equal(
            term['osc-hyperlink'].hyperlink('http://x', '', AsSequence),
            `${ESC}]8;;http://x${ST}http://x${ESC}]8;;${ST}`
        );
    });

    test('write path works when bound to a terminal', () => {
        const { term, output } = makeTerminal('xterm');

        const ret = term['osc-hyperlink'].hyperlink('http://x', 'y');
        assert.equal(ret, term);
        assert.ok(output().startsWith(`${ESC}]8;;http://x`));
    });

    test('is a Handler bound to its terminal', () => {
        const { term } = makeTerminal('xterm');
        assert.ok(term['osc-hyperlink'] instanceof OSCHyperlink);
        assert.equal(term['osc-hyperlink'].terminal, term);
    });
});
