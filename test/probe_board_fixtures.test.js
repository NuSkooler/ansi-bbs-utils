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
