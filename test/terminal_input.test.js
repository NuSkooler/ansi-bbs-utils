'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const Terminal = require('../lib/terminal');
const ReplyParser = require('../lib/input/reply_parser');

const { ESC, CSI, makeTerminal } = require('./helpers');

const DA_CTERM  = `${CSI}=67;84;101;114;109;1;332c`;
const DA_ICY    = `${CSI}=73;99;121;84;101;114;109;0;8;4c`;
const DA_VT100  = `${CSI}?1;2c`;
const REPORT    = `${CSI}=7;100;1n`;
const APC       = `${ESC}_SyncTERM:C;L\n${ESC}\\`;

describe('Terminal input side', () => {
    test('is an EventEmitter with a ReplyParser', () => {
        const { term } = makeTerminal('syncterm');
        assert.equal(typeof(term.on), 'function');
        assert.ok(term.input instanceof ReplyParser);
    });

    test('feed() emits input for keystrokes and events for replies, in order', () => {
        const { term } = makeTerminal('syncterm');
        const log = [];

        term.on('input', buf => log.push({ input : buf.toString('latin1') }));
        term.on('report', r => log.push({ report : r.params }));
        term.on('apc', a => log.push({ apc : a.body }));

        assert.equal(term.feed(`ab${REPORT}c${APC}d`), term, 'chains');

        assert.deepEqual(log, [
            { input : 'ab' },
            { report : [ 7, 100, 1 ] },
            { input : 'c' },
            { apc : 'SyncTERM:C;L\n' },
            { input : 'd' },
        ]);
        term.destroy();
    });

    test('a device attributes reply identifies the client on the terminal', () => {
        const { term } = makeTerminal('syncterm');
        const seen = [];
        term.on('device attributes', da => seen.push(da.client));

        term.feed(DA_CTERM);
        assert.equal(term.getTerminalClient(), 'cterm');
        assert.equal(term.ctermVersion, '1.332');
        assert.equal(term.clientVersion, '1.332');
        assert.deepEqual(seen, [ 'cterm' ]);

        term.feed(DA_ICY);
        assert.equal(term.getTerminalClient(), 'icy_term');
        assert.equal(term.clientVersion, '0.8.4');
        assert.equal(term.ctermVersion, '1.332', 'an unrelated client reply does not clear a CTerm revision');
        term.destroy();
    });

    test('an unknown device attributes reply leaves the client alone but still emits', () => {
        const { term } = makeTerminal('xterm');
        let payload;
        term.on('device attributes', da => payload = da);

        term.feed(DA_VT100);
        assert.equal(term.getTerminalClient(), 'unknown');
        assert.equal(term.ctermVersion, null);
        assert.deepEqual(payload.params, [ 1, 2 ]);
        term.destroy();
    });

    test('parser options pass through the constructor', () => {
        const term = new Terminal(null, { input : { captureCPR : true } });
        let cpr;
        term.on('cpr', c => cpr = c);
        term.feed(`${CSI}5;7R`);
        assert.deepEqual(cpr, { row : 5, col : 7, raw : `${CSI}5;7R` });
        term.destroy();
    });

    test('reply errors are forwarded', () => {
        const term = new Terminal(null, { input : { maxApcLength : 4 } });
        let err;
        term.on('reply error', e => err = e);
        term.feed(`${ESC}_toolong${ESC}\\`);
        assert.equal(err.reason, 'overflow');
        term.destroy();
    });

    test('flushInput() releases held keystrokes', () => {
        const { term } = makeTerminal('ansi');
        const seen = [];
        term.on('input', buf => seen.push(buf.toString('latin1')));

        term.feed(ESC);
        assert.deepEqual(seen, []);
        assert.equal(term.flushInput(), term);
        assert.deepEqual(seen, [ ESC ]);
        term.destroy();
    });

    test('handler methods never shadow EventEmitter members', () => {
        const { term } = makeTerminal('ansi');
        for (const name of [ 'on', 'once', 'off', 'emit', 'removeAllListeners', 'listenerCount' ]) {
            assert.equal(term[name], Terminal.prototype[name], name);
        }
        term.destroy();
    });

    test('a terminal without input wiring still works for output', () => {
        const { term, output } = makeTerminal('ansi');
        term.red().write('x');
        assert.equal(output(), `${CSI}31mx`);
        term.destroy();
    });
});
