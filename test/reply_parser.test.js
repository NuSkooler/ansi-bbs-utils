'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ReplyParser = require('../lib/input/reply_parser');

const { ESC, CSI } = require('./helpers');

const APC = `${ESC}_`;
const ST = `${ESC}\\`;

//  Wire fixtures
const DA_CTERM      = `${CSI}=67;84;101;114;109;1;332c`;
const DA_VT100      = `${CSI}?1;2c`;
const DA_XTERM_2ND  = `${CSI}>41;372;0c`;
const REPORT_SND    = `${CSI}=7;100;1n`;
const REPORT_FMT    = `${CSI}=7;101;32;100;1n`;
const REPORT_IDLE   = `${CSI}=7n`;
const CPR           = `${CSI}12;40R`;
const MOUSE_SGR     = `${CSI}<0;10;20M`;
const MOUSE_SGR_UP  = `${CSI}<0;10;20m`;
const DECRPM        = `${CSI}?1;2$y`;
const KEY_UP        = `${CSI}A`;
const KEY_F1_XTERM  = `${ESC}OP`;
const KEY_F5        = `${CSI}15~`;
const KEY_PGUP_SYNC = `${CSI}V`;
const META_X        = `${ESC}x`;

//  SyncTERM's cache listing, framed the way term.c sends it
const LISTING_BODY  = 'SyncTERM:C;L\nlobby.ogg\t595f44fec1e92a71d3e9e77456ba80d1\nsfx/hit.wav\t0cc175b9c0f1b6a831c399e269772661\n';
const LISTING       = `${APC}${LISTING_BODY}${ST}`;

//
//  Run a parser over |chunks| and return everything it emitted, in
//  order. Consecutive passthrough data is merged so that chunking
//  differences never show up in a comparison.
//
function run(chunks, options) {
    const parser = new ReplyParser(options);
    const log = record(parser);
    for (const chunk of chunks) {
        parser.feed(chunk);
    }
    parser.destroy();
    return log;
}

function record(parser) {
    const log = [];
    parser.on('data', buf => {
        const s = buf.toString('latin1');
        const last = log[log.length - 1];
        if (last && 'data' in last) {
            last.data += s;
        } else {
            log.push({ data : s });
        }
    });
    for (const event of [ 'apc', 'report', 'device attributes', 'cpr', 'reply error' ]) {
        parser.on(event, payload => log.push({ event, payload }));
    }
    return log;
}

const dataOf = log => log.filter(e => 'data' in e).map(e => e.data).join('');
const eventsOf = log => log.filter(e => 'event' in e);

describe('passthrough', () => {
    test('exposes its states for diagnostics', () => {
        assert.equal(ReplyParser.State.Ground, 'ground');
        assert.equal(new ReplyParser().state, ReplyParser.State.Ground);
    });

    test('plain text is passed through unchanged', () => {
        const log = run([ 'hello', ' ', 'world' ]);
        assert.deepEqual(log, [ { data : 'hello world' } ]);
    });

    test('keyboard sequences pass through intact', () => {
        for (const key of [ KEY_UP, KEY_F1_XTERM, KEY_F5, KEY_PGUP_SYNC, META_X, `${ESC}${ESC}`, '\r', '\x7f', '\t' ]) {
            const log = run([ `a${key}b` ]);
            assert.deepEqual(log, [ { data : `a${key}b` } ], JSON.stringify(key));
        }
    });

    test('a lone ESC at the end of a chunk is released by the next chunk', () => {
        const log = run([ `a${ESC}`, 'b' ]);
        assert.deepEqual(log, [ { data : `a${ESC}b` } ]);
    });

    test('private CSI sequences that are not replies pass through intact', () => {
        for (const seq of [ MOUSE_SGR, MOUSE_SGR_UP, DECRPM, `${CSI}?25h` ]) {
            const log = run([ `a${seq}b` ]);
            assert.deepEqual(log, [ { data : `a${seq}b` } ], JSON.stringify(seq));
        }
    });

    test('a CPR passes through by default', () => {
        const log = run([ `a${CPR}b` ]);
        assert.deepEqual(log, [ { data : `a${CPR}b` } ]);
    });

    test('bytes above 0x7f pass through', () => {
        const chunk = Buffer.from([ 0x41, 0xb0, 0xdb, 0xff, 0x42 ]);
        const parser = new ReplyParser();
        const out = [];
        parser.on('data', b => out.push(b));
        parser.feed(chunk);
        assert.deepEqual(Buffer.concat(out), chunk);
    });
});

describe('replies', () => {
    test('CTerm device attributes', () => {
        const log = run([ DA_CTERM ]);
        assert.deepEqual(log, [ {
            event : 'device attributes',
            payload : {
                prefix : '=', params : [ 67, 84, 101, 114, 109, 1, 332 ],
                paramString : '67;84;101;114;109;1;332', raw : DA_CTERM,
                client : 'cterm', version : '1.332', ctermVersion : '1.332',
            },
        } ]);
    });

    test('other device attribute prefixes', () => {
        let [ e ] = eventsOf(run([ DA_VT100 ]));
        assert.equal(e.payload.prefix, '?');
        assert.deepEqual(e.payload.params, [ 1, 2 ]);
        assert.equal(e.payload.client, null);

        [ e ] = eventsOf(run([ DA_XTERM_2ND ]));
        assert.equal(e.payload.prefix, '>');
        assert.deepEqual(e.payload.params, [ 41, 372, 0 ]);
    });

    test('CTerm reports of any parameter count', () => {
        const log = run([ REPORT_SND, REPORT_FMT, REPORT_IDLE ]);
        assert.deepEqual(log.map(e => e.payload.params), [
            [ 7, 100, 1 ],
            [ 7, 101, 32, 100, 1 ],
            [ 7 ],
        ]);
        assert.equal(log[0].payload.prefix, '=');
        assert.equal(log[0].payload.raw, REPORT_SND);
        assert.equal(log[0].payload.paramString, '7;100;1');
    });

    test('an APC string, whole', () => {
        const log = run([ LISTING ]);
        assert.deepEqual(log, [ { event : 'apc', payload : { body : LISTING_BODY } } ]);
    });

    test('an APC string, in the pieces SyncTERM writes it', () => {
        const pieces = [
            `${APC}SyncTERM:C;L\n`,
            'lobby.ogg', '\t', '595f44fec1e92a71d3e9e77456ba80d1', '\n',
            'sfx/hit.wav', '\t', '0cc175b9c0f1b6a831c399e269772661', '\n',
            ST,
        ];
        const log = run(pieces);
        assert.deepEqual(log, [ { event : 'apc', payload : { body : LISTING_BODY } } ]);
    });

    test('an empty APC body is still a reply', () => {
        const log = run([ `${APC}${ST}` ]);
        assert.deepEqual(log, [ { event : 'apc', payload : { body : '' } } ]);
    });

    test('a CPR is captured only when asked for', () => {
        const log = run([ `a${CPR}b`, `${CSI}1;1R` ], { captureCPR : true });
        assert.deepEqual(log, [
            { data : 'a' },
            { event : 'cpr', payload : { row : 12, col : 40, raw : CPR } },
            { data : 'b' },
            { event : 'cpr', payload : { row : 1, col : 1, raw : `${CSI}1;1R` } },
        ]);

        //  a plain CSI with a different final is still a keystroke
        assert.deepEqual(run([ KEY_F5, `${CSI}5R` ], { captureCPR : true }), [ { data : `${KEY_F5}${CSI}5R` } ]);
    });

    test('replies with no parameters at all', () => {
        const log = run([ `${CSI}=c${CSI}=n` ]);
        assert.deepEqual(log.map(e => [ e.event, e.payload.params, e.payload.paramString ]), [
            [ 'device attributes', [], '' ],
            [ 'report', [], '' ],
        ]);
        assert.equal(log[0].payload.client, null);
    });

    test('a plain CSI in progress yields to a new ESC or a control character', () => {
        //  ESC [ 1 then an arrow key: both are keystrokes, in order
        assert.deepEqual(run([ `${CSI}1${KEY_UP}` ]), [ { data : `${CSI}1${KEY_UP}` } ]);
        //  ESC [ 1 then a line feed: not a sequence; all of it is theirs
        assert.deepEqual(run([ `${CSI}1\nq` ]), [ { data : `${CSI}1\nq` } ]);
    });

    test('ESC ESC before a reply: the first ESC is a keystroke', () => {
        const log = run([ `${ESC}${REPORT_IDLE}` ]);
        assert.deepEqual(log, [
            { data : ESC },
            { event : 'report', payload : { prefix : '=', params : [ 7 ], paramString : '7', raw : REPORT_IDLE } },
        ]);
    });
});

describe('ordering and fragmentation', () => {
    const stream =
        'abc' + KEY_UP + META_X + DA_CTERM + 'd' + REPORT_SND + LISTING +
        MOUSE_SGR + CPR + KEY_F5 + `${ESC}${ESC}` + REPORT_FMT + 'z';

    const expected = run([ stream ]);

    test('the reference run has the expected shape', () => {
        assert.deepEqual(expected, [
            { data : 'abc' + KEY_UP + META_X },
            { event : 'device attributes', payload : expected[1].payload },
            { data : 'd' },
            { event : 'report', payload : expected[3].payload },
            { event : 'apc', payload : { body : LISTING_BODY } },
            { data : MOUSE_SGR + CPR + KEY_F5 + `${ESC}${ESC}` },
            { event : 'report', payload : expected[6].payload },
            { data : 'z' },
        ]);
        assert.equal(expected[1].payload.ctermVersion, '1.332');
    });

    test('splitting at every byte boundary gives the same events and bytes', () => {
        for (let i = 1; i < stream.length; ++i) {
            const log = run([ stream.slice(0, i), stream.slice(i) ]);
            assert.deepEqual(log, expected, `split at ${i}`);
        }
    });

    test('feeding one byte at a time gives the same events and bytes', () => {
        const log = run(stream.split(''));
        assert.deepEqual(log, expected);
    });

    test('feeding Buffers is the same as feeding strings', () => {
        const log = run([ Buffer.from(stream, 'latin1') ]);
        assert.deepEqual(log, expected);
    });

    test('passthrough before a reply is emitted before the reply event', () => {
        const parser = new ReplyParser();
        const order = [];
        parser.on('data', () => order.push('data'));
        parser.on('report', () => order.push('report'));
        parser.feed(`x${REPORT_IDLE}y`);
        assert.deepEqual(order, [ 'data', 'report', 'data' ]);
        parser.destroy();
    });
});

describe('limits and errors', () => {
    test('an oversize APC is dropped, its remainder discarded, and the stream resumes', () => {
        const body = 'x'.repeat(40);
        const log = run([ `a${APC}${body}${ST}b` ], { maxApcLength : 16 });
        assert.deepEqual(log, [
            { data : 'a' },
            { event : 'reply error', payload : { reason : 'overflow', dropped : Buffer.from('x'.repeat(17)) } },
            { data : 'b' },
        ]);
    });

    test('an oversize private CSI is dropped up to its final byte', () => {
        const log = run([ `a${CSI}=${'1;'.repeat(40)}nb` ], { maxCsiLength : 16 });
        assert.equal(eventsOf(log)[0].payload.reason, 'overflow');
        assert.equal(dataOf(log), 'ab');
    });

    test('an APC interrupted by a new sequence is dropped and the new sequence handled', () => {
        const log = run([ `${APC}abc${REPORT_IDLE}` ]);
        assert.deepEqual(log, [
            { event : 'reply error', payload : { reason : 'aborted', dropped : Buffer.from('abc') } },
            { event : 'report', payload : { prefix : '=', params : [ 7 ], paramString : '7', raw : REPORT_IDLE } },
        ]);
    });

    test('an APC interrupted by a keystroke sequence', () => {
        const log = run([ `${APC}abc${KEY_UP}z` ]);
        assert.deepEqual(log, [
            { event : 'reply error', payload : { reason : 'aborted', dropped : Buffer.from('abc') } },
            { data : `${KEY_UP}z` },
        ]);
    });

    test('a discarded APC that is interrupted resumes on the new sequence', () => {
        const log = run([ `${APC}${'x'.repeat(20)}${KEY_UP}z` ], { maxApcLength : 8 });
        assert.equal(eventsOf(log)[0].payload.reason, 'overflow');
        assert.equal(dataOf(log), `${KEY_UP}z`);
    });

    test('a control character inside a private CSI aborts it; the character passes through', () => {
        const log = run([ `${CSI}=7\nk` ]);
        assert.deepEqual(log, [
            { event : 'reply error', payload : { reason : 'aborted', dropped : Buffer.from(`${CSI}=7`, 'latin1') } },
            { data : '\nk' },
        ]);
    });

    test('a private CSI interrupted by ESC', () => {
        const log = run([ `${CSI}=7${KEY_UP}` ]);
        assert.deepEqual(log, [
            { event : 'reply error', payload : { reason : 'aborted', dropped : Buffer.from(`${CSI}=7`, 'latin1') } },
            { data : KEY_UP },
        ]);
    });

    test('a very long plain CSI is handed over as keystrokes', () => {
        const long = `${CSI}${'1'.repeat(70)}`;
        const log = run([ `${long}~` ], { maxCsiLength : 16 });
        assert.deepEqual(log, [ { data : `${long}~` } ]);
    });
});

describe('timeouts and flushing', () => {
    test('held keystroke prefixes are released after escapeTimeout', (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const parser = new ReplyParser({ escapeTimeout : 50 });
        const log = record(parser);

        parser.feed(`a${ESC}`);
        assert.deepEqual(log, [ { data : 'a' } ], 'ESC is held');

        t.mock.timers.tick(49);
        assert.deepEqual(log, [ { data : 'a' } ]);

        t.mock.timers.tick(1);
        assert.deepEqual(log, [ { data : `a${ESC}` } ]);
        assert.equal(parser.pending, false);

        parser.feed(`${CSI}1`);
        t.mock.timers.tick(50);
        assert.deepEqual(log, [ { data : `a${ESC}${CSI}1` } ]);
        parser.destroy();
    });

    test('a reply in progress is dropped after replyTimeout, not leaked', (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const parser = new ReplyParser({ replyTimeout : 2000 });
        const log = record(parser);

        parser.feed(`${APC}SyncTERM:C;L\n`);
        t.mock.timers.tick(1999);
        assert.deepEqual(log, []);

        t.mock.timers.tick(1);
        assert.deepEqual(log, [
            { event : 'reply error', payload : { reason : 'timeout', dropped : Buffer.from('SyncTERM:C;L\n') } },
        ]);

        parser.feed(`${CSI}=7;10`);
        t.mock.timers.tick(2000);
        assert.equal(log[1].payload.reason, 'timeout');
        assert.deepEqual(log[1].payload.dropped, Buffer.from(`${CSI}=7;10`, 'latin1'));
        parser.destroy();
    });

    test('activity restarts the reply timer', (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const parser = new ReplyParser({ replyTimeout : 2000 });
        const log = record(parser);

        parser.feed(`${APC}a`);
        t.mock.timers.tick(1500);
        parser.feed('b');
        t.mock.timers.tick(1500);
        assert.deepEqual(log, [], 'not yet');
        parser.feed(ST);
        assert.deepEqual(log, [ { event : 'apc', payload : { body : 'ab' } } ]);
        parser.destroy();
    });

    test('a timeout of 0 disables holding', (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const parser = new ReplyParser({ escapeTimeout : 0, replyTimeout : 0 });
        const log = record(parser);

        parser.feed(ESC);
        t.mock.timers.tick(10000);
        assert.deepEqual(log, [], 'held indefinitely until more input');
        parser.feed('x');
        assert.deepEqual(log, [ { data : `${ESC}x` } ]);
        parser.destroy();
    });

    test('flush() releases keystrokes and drops replies', () => {
        let parser = new ReplyParser();
        let log = record(parser);
        parser.feed(`${CSI}1`);
        parser.flush();
        assert.deepEqual(log, [ { data : `${CSI}1` } ]);
        assert.equal(parser.pending, false);
        parser.destroy();

        parser = new ReplyParser();
        log = record(parser);
        parser.feed(`${APC}abc`);
        parser.flush();
        assert.deepEqual(log, [ { event : 'reply error', payload : { reason : 'flushed', dropped : Buffer.from('abc') } } ]);
        parser.destroy();
    });

    test('destroy() stops timers and ignores further input', (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const parser = new ReplyParser();
        const log = record(parser);

        parser.feed(ESC);
        parser.destroy();
        t.mock.timers.tick(1000);
        parser.feed('x');
        parser.flush();
        assert.deepEqual(log, []);
    });
});
