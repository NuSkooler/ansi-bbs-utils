'use strict';

//
//  analyze() against probe board reports recorded from real DOS terminal
//  programs (dos_terms: DOSBox Staging's softmodem dialing the board).
//  These are the clients whose replies broke ENiGMA's size detection.
//

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { analyze } = require('../tools/probe_board/analyze');

const load = name => require(path.join(__dirname, 'fixtures', 'probe_board', `${name}.json`));
const probeOf = (summary, id) => summary.probes.find(p => id === p.id);

describe('probe board reports from real DOS terminals', () => {
    test('every step ended on its own sentinel', () => {
        for (const name of [ 'pcplus', 'procomm', 'qmodem', 'telemate', 'telix', 'terminate' ]) {
            const report = load(name);
            assert.equal(report.probe.mode, 'sentinel', name);
            for (const step of report.probe.steps.slice(1)) {
                assert.equal(step.complete, true, `${name} ${step.id}`);
                assert.ok(step.rx.endsWith(report.probe.sentinel), `${name} ${step.id}`);
            }
        }
    });

    test('Procomm Plus TD: 24 rows kept, wrapped width replaced by 80', () => {
        const s = analyze(load('pcplus'));
        assert.equal(s.size['size-999'].raw, '\u001b[24;231R');
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 24, source : 'size-999' });
        assert.equal(s.identity.da1.vtClass, 'VT102');
    });

    test('Procomm 2.4.3: both coordinates wrapped; default size', () => {
        const s = analyze(load('procomm'));
        assert.ok(s.size['size-999'].flags.includes('wrapped-256'));
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 25, source : 'default' });
        assert.equal(s.identity.da1.vtClass, 'VT100');
    });

    test('Qmodem 4.6: DA printed, 999;999 ignored, every CSI ... n answered with a CPR', () => {
        const s = analyze(load('qmodem'));
        assert.equal(s.identity.da1, null);
        assert.equal(probeOf(s, 'da1').printed, true);
        assert.ok(s.size['size-999'].flags.includes('did-not-move'));
        assert.deepEqual(probeOf(s, 'dsr-status').cprs, [ 'ESC[4;1R' ]);
        assert.equal(probeOf(s, 'font-select').printedCols, 7);
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 25, source : 'default' });
    });

    test('Telemate 4.21: width 79 flagged and read as 80', () => {
        const s = analyze(load('telemate'));
        assert.ok(s.size['size-999'].flags.includes('clamped-79'));
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 24, source : 'size-999' });
    });

    test('Telix 3.51: one-row offset; 23 rows; answers every DA variant with its DA', () => {
        const s = analyze(load('telix'));
        assert.equal(s.cpr.rowOffset, 1);
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 23, source : 'size-999' });
        for (const id of [ 'da2', 'da3', 'cterm-da' ]) {
            assert.deepEqual(probeOf(s, id).replies, [ 'ESC[?1;0c' ], id);
        }
        assert.equal(probeOf(s, 'font-select').printed, false);
    });

    test('Terminate 5.00: column;row reports; 80x24 once swapped', () => {
        const s = analyze(load('terminate'));
        assert.equal(s.cpr.kind, 'transposed');
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 24, source : 'size-999' });
        assert.equal(probeOf(s, 'font-select').printed, true);
    });

    test('the private-prefix probes ENiGMA and others send are printed by most DOS clients', () => {
        //  CSI < c (CTerm DA) and CSI = Ps n print on PCPlus, Procomm and Telemate; a host
        //  that sends them must clear the screen afterwards, as ENiGMA does.
        for (const name of [ 'pcplus', 'procomm', 'telemate' ]) {
            const s = analyze(load(name));
            assert.equal(probeOf(s, 'cterm-da').printed, true, name);
            assert.equal(probeOf(s, 'cterm-6n').printed, true, name);
        }
    });
});

//
//  Modern terminals, connected straight to the board on loopback (Windows 11).
//
describe('probe board reports from modern terminals', () => {
    const NAMES = [ 'icyterm', 'netrunner', 'syncterm', 'terminator', 'telnet-exe' ];

    test('every step ended on its own sentinel', () => {
        for (const name of NAMES) {
            const report = load(name);
            assert.equal(report.probe.mode, 'sentinel', name);
            for (const step of report.probe.steps.slice(1)) {
                assert.equal(step.complete, true, `${name} ${step.id}`);
            }
        }
    });

    test('SyncTERM and TERMinator both identify as CTerm; only the version and caps differ', () => {
        const sync = analyze(load('syncterm'));
        const term = analyze(load('terminator'));
        for (const s of [ sync, term ]) {
            assert.equal(s.identity.ttype, 'syncterm');
            assert.equal(s.identity.da1.client, 'cterm');
            assert.equal(s.identity.da1.ctermClass, true);
        }
        assert.equal(sync.identity.da1.version, '1.333');
        assert.equal(term.identity.da1.version, '1.332');
        assert.deepEqual(term.identity.ctermCaps, [ 0, 1, 2, 3, 4, 6, 8 ]);
        assert.deepEqual(sync.size.recommended, { cols : 80, rows : 24, source : 'naws' });
        assert.deepEqual(probeOf(sync, 'cterm-6n').replies, [ 'ESC[=6;1n' ]);
        assert.equal(probeOf(term, 'cterm-6n').answered, false);
    });

    test('IcyTerm: identified by DA alone (TTYPE is ANSI)', () => {
        const s = analyze(load('icyterm'));
        assert.equal(s.identity.ttype, 'ANSI');
        assert.equal(s.identity.da1.client, 'icy_term');
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 25, source : 'naws' });
        assert.equal(probeOf(s, 'cterm-6n').answered, false);
    });

    test('NetRunner: malformed NAWS, no DA, and CSI 5 n / CSI 255 n answered with the cursor position', () => {
        const s = analyze(load('netrunner'));
        assert.equal(s.telnet.naws.malformed, true);
        assert.equal(s.identity.da1, null);
        assert.deepEqual(probeOf(s, 'dsr-status').cprs, [ 'ESC[4;1R' ]);
        assert.ok(s.size['size-255n'].flags.includes('did-not-move'));
        assert.deepEqual(s.size.recommended, { cols : 80, rows : 25, source : 'size-999' });
        assert.ok(s.notes.includes('NAWS was sent without WILL NAWS'));
    });

    test('Windows telnet.exe: NAWS keeps only the low byte of a 270-column width', () => {
        const s = analyze(load('telnet-exe'));
        assert.equal(s.telnet.naws.hex, '00 0e 00 48');
        assert.equal(s.telnet.naws.truncated8, true);
        assert.deepEqual(s.size.recommended, { cols : 270, rows : 72, source : 'size-999' });
        assert.deepEqual(s.telnet.ttypes, [ 'ANSI', 'VT100', 'VT52', 'VTNT' ]);
        assert.deepEqual(probeOf(s, 'dsr-status').replies, [ 'ESC[c' ]);
    });
});

describe('docs/terminal-compatibility.md', () => {
    test('its generated tables match the fixtures (npm run probe:matrix)', () => {
        const fs = require('fs');
        const { render, replaceIn, DOC } = require('../tools/probe_board/matrix');
        const doc = fs.readFileSync(DOC, 'utf8');
        assert.equal(replaceIn(doc, render()), doc);
    });
});
