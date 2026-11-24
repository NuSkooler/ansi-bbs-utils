'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { probeSession } = require('../tools/probe_board');
const { FakeTerminal, Profiles } = require('../tools/probe_board/fake_terminal');
const { parseEnviron } = require('../tools/probe_board/telnet');
const { Probes } = require('../tools/probe_board/probes');

const Fast = {
    noPrompt : true, out : null,
    timeoutMs : 400, quietMs : 100, graceMs : 10, gapMs : 0,
    negotiateMs : 400, negotiateQuietMs : 100,
};

//  Run one scripted terminal against the board over loopback.
function probe(profile, options = {}) {
    return new Promise((resolve, reject) => {
        const fake = new FakeTerminal(profile);
        const server = net.createServer(socket => {
            probeSession(socket, { ...Fast, ...options }).then(r => {
                server.close();
                fake.close();
                resolve(r);
            }, reject);
        });
        server.listen(0, '127.0.0.1', () => fake.connect(server.address().port).catch(reject));
    });
}

//  Each test is its own loopback session, so they can run side by side.
describe('probe board against recorded terminal quirks', { concurrency : true }, () => {
    test('Terminate: column;row reports are detected and swapped', async () => {
        const { summary } = await probe(Profiles.terminate);
        assert.equal(summary.cpr.kind, 'transposed');
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 24, source : 'size-999' });
        assert.equal(summary.identity.da1.vtClass, 'VT102');
    });

    test('Telix: a one-row offset is measured and taken off the size', async () => {
        const { summary } = await probe(Profiles.telix);
        assert.equal(summary.cpr.kind, 'normal');
        assert.equal(summary.cpr.rowOffset, 1);
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 23, source : 'size-999' });
    });

    test('Procomm 2.4.3: 999 wrapped to 231 is rejected; default size', async () => {
        const { summary } = await probe(Profiles.procomm);
        assert.ok(summary.size['size-999'].flags.includes('wrapped-256'));
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 25, source : 'default' });
    });

    test('Procomm Plus: good rows are kept when only the width wrapped', async () => {
        const { summary } = await probe(Profiles.pcplus);
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 24, source : 'size-999' });
    });

    test('Telemate: width 79 is flagged as a clamp and read as 80', async () => {
        const { summary } = await probe(Profiles.telemate);
        assert.equal(summary.size['size-999'].cols, 79);
        assert.ok(summary.size['size-999'].flags.includes('clamped-79'));
        assert.equal(summary.size.recommended.cols, 80);
    });

    test('Qmodem: an ignored 999;999 move is not taken for a size; DA is printed, not answered', async () => {
        const { summary } = await probe(Profiles.qmodem);
        assert.equal(summary.cpr.kind, 'normal');
        assert.ok(summary.size['size-999'].flags.includes('did-not-move'));
        assert.ok(summary.size['size-255n'].flags.includes('did-not-move'));
        assert.equal(summary.identity.da1, null);
        assert.equal(summary.probes.find(p => 'da1' === p.id).printed, true);
        assert.equal(summary.probes.find(p => 'font-select' === p.id).printedCols, 7);
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 25, source : 'default' });
    });

    test('extra cursor reports and one-byte packets do not shift replies into the next step', async () => {
        //  Terminate answers CSI = 6 n with a CPR. Counting reports ended that step
        //  early and its sentinel showed up as the next probe's reply.
        const { report } = await probe(Profiles.terminate);
        assert.equal(report.probe.mode, 'sentinel');
        assert.equal(report.probe.sentinel, '\u001b[7;2R');
        for (const step of report.probe.steps.slice(1)) {
            assert.equal(step.complete, true, step.id);
            assert.ok(step.rx.endsWith(report.probe.sentinel), step.id);
            assert.equal(step.rx.indexOf(report.probe.sentinel), step.rx.length - report.probe.sentinel.length, step.id);
        }
        const c6n = report.probe.steps.find(s => 'cterm-6n' === s.id);
        assert.equal(c6n.rx, '\u001b[1;4R\u001b[1;4R\u001b[7;2R');
    });

    test('a probe that goes unanswered costs no timeout once the sentinel is known', async () => {
        const { report } = await probe(Profiles.telemate);
        const s255 = report.probe.steps.find(s => 'size-255n' === s.id);
        assert.equal(s255.complete, true);
        assert.ok(s255.ms < 300, `${s255.ms} ms`);
    });

    test('NetRunner: six-byte NAWS is flagged and not used; NUL stripped from TTYPE', async () => {
        const { summary, report } = await probe(Profiles.netrunner);
        assert.equal(report.telnet.naws[0].hex, '00 00 50 00 19 00');
        assert.equal(summary.telnet.naws.malformed, true);
        assert.deepEqual(summary.telnet.ttypes, [ 'ANSI-256COLOR-RGB' ]);
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 25, source : 'size-255n' });
    });

    test('SyncTERM: CTerm identity, capabilities, XTVERSION; NAWS size', async () => {
        const { summary } = await probe(Profiles.syncterm);
        assert.equal(summary.identity.da1.client, 'cterm');
        assert.equal(summary.identity.da1.version, '1.333');
        assert.equal(summary.identity.da1.ctermClass, true);
        assert.deepEqual(summary.identity.ctermCaps, [ 0, 1, 2, 3, 4, 5, 6, 7, 8 ]);
        assert.equal(summary.identity.xtversion, 'SyncTERM 1.333');
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 24, source : 'naws' });
        assert.equal(summary.probes.find(p => 'font-select' === p.id).printed, false);
    });

    test('a terminal that answers nothing still gets a report and the default size', async () => {
        const { summary, report } = await probe(Profiles.silent);
        assert.equal(summary.cpr.kind, 'none');
        assert.equal(report.probe.steps.length, Probes.length);
        assert.deepEqual(summary.size.recommended, { cols : 80, rows : 25, source : 'default' });
    });

    test('a probe printed as text is detected by the moved cursor', async () => {
        const { summary } = await probe({ rows : 24, cols : 80, prints : { '\u001b[0;0 D' : 6 } });
        const font = summary.probes.find(p => 'font-select' === p.id);
        assert.equal(font.printed, true);
        assert.equal(font.printedCols, 6);
        assert.equal(summary.probes.find(p => 'da1' === p.id).printed, false);
    });

    test('replies arriving one byte per packet are still assigned to the right probe', async () => {
        const { report } = await probe(Profiles.terminate);
        const da1 = report.probe.steps.find(s => 'da1' === s.id);
        assert.ok(da1.rx.startsWith('\u001b[?6c'));
        assert.ok(da1.chunks.length > 5);
        assert.equal(da1.complete, true);
    });

    test('--safe skips the probes some terminals print', async () => {
        const { report } = await probe(Profiles.syncterm, { safe : true });
        const ids = report.probe.steps.map(s => s.id);
        assert.ok(!ids.includes('enq'));
        assert.ok(!ids.includes('apc-empty'));
        assert.ok(ids.includes('size-255n'));
    });
});

describe('NEW-ENVIRON parsing', () => {
    test('VAR / USERVAR with and without values, and ESC-quoted bytes', () => {
        //  VAR "TERM" VALUE "ansi"  USERVAR "ROWS"  USERVAR "X" VALUE ESC 0x01 "y"
        const bytes = [ 0, ...Buffer.from('TERM'), 1, ...Buffer.from('ansi'), 3, ...Buffer.from('ROWS'),
            3, 0x58, 1, 2, 1, 0x79 ];
        assert.deepEqual(parseEnviron(bytes), [
            { kind : 'VAR', name : 'TERM', value : 'ansi' },
            { kind : 'USERVAR', name : 'ROWS', value : null },
            { kind : 'USERVAR', name : 'X', value : '\u0001y' },
        ]);
    });
});
