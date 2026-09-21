'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const Terminal = require('../lib/terminal');
const Capabilities = require('../lib/capabilities');
const { AsSequence } = require('../lib/common');

const { ESC, CSI, makeTerminal, fakeSocket } = require('./helpers');

describe('terminal type and capabilities', () => {
    test('defaults before any type is known', () => {
        const { term } = makeTerminal();

        assert.equal(term.getTerminalType(), 'unknown');
        assert.equal(term.getTerminalClient(), 'unknown');
        assert.equal(term.getEncoding(), 'cp437');
        assert.ok(term.hasCapability('ansi-bbs'));
        assert.ok(!term.hasCapability('8bit-color'));
        assert.equal(term.getWidth(), 0);
        assert.equal(term.getHeight(), 0);
    });

    test('setTerminalType() trims, lowercases and rejects empty', () => {
        const { term } = makeTerminal();

        assert.equal(term.setTerminalType(''), false);
        assert.equal(term.getTerminalType(), 'unknown');

        assert.equal(term.setTerminalType('  '), false);

        assert.equal(term.setTerminalType(' ANSI '), true);
        assert.equal(term.getTerminalType(), 'ansi');
        assert.ok(term.hasCapability('ansi-bbs'));
        assert.equal(term.getEncoding(), 'cp437');
    });

    test('xterm-256color resolves to its own entry: UTF-8 and 8-bit color', () => {
        const { term } = makeTerminal('xterm-256color');

        assert.equal(term.getEncoding(), 'utf8');
        assert.ok(term.hasCapability('8bit-color'));
        assert.ok(term.hasCapability('ecma-48'));
        assert.ok(!term.hasCapability('24bit-color'));
    });

    test('other well known types', () => {
        let { term } = makeTerminal('xterm-truecolor');
        assert.ok(term.hasCapability('24bit-color'));
        assert.equal(term.getEncoding(), 'utf8');

        ({ term } = makeTerminal('syncterm'));
        assert.ok(term.hasCapability('cterm'));
        assert.equal(term.getEncoding(), 'cp437');

        ({ term } = makeTerminal('vtx'));
        assert.ok(term.hasCapability('vtx'));

        ({ term } = makeTerminal('ansi-256color'));
        assert.ok(term.hasCapability('8bit-color'));
        assert.equal(term.getEncoding(), 'cp437');

        //  the literal entry name, which also ends in -256color
        ({ term } = makeTerminal('ansi-bbs-256color'));
        assert.ok(term.hasCapability('8bit-color'));
        assert.ok(!term.hasCapability('24bit-color'));
        assert.ok(!term.hasCapability('xterm'));
        assert.equal(term.getEncoding(), 'cp437');
    });

    test('unknown types fall back to ansi-bbs', () => {
        const { term } = makeTerminal('dumb');

        assert.equal(term.getTerminalType(), 'dumb');
        assert.ok(term.hasCapability('ansi-bbs'));
        assert.equal(term.getEncoding(), 'cp437');
    });

    test('capabilities are per instance and never touch the table', () => {
        const a = makeTerminal('syncterm').term;
        const b = makeTerminal('syncterm').term;

        a.addCapabilities('cterm-audio', 'cterm-audio-files');

        assert.ok(a.hasCapability('cterm-audio'));
        assert.ok(!b.hasCapability('cterm-audio'), 'must not leak to another terminal');
        assert.ok(Array.isArray(Capabilities.cterm.capabilities), 'table entry left as a plain array');
        assert.ok(!Capabilities.cterm.capabilities.includes('cterm-audio'));

        //  a fresh terminal of the same type starts clean
        const c = makeTerminal('syncterm').term;
        assert.ok(!c.hasCapability('cterm-audio'));
    });

    test('capabilities survive re-setting the same type only if re-added', () => {
        const { term } = makeTerminal('syncterm');
        term.addCapability('cterm-audio');
        assert.ok(term.hasCapability('cterm-audio'));

        term.setTerminalType('syncterm');
        assert.ok(!term.hasCapability('cterm-audio'), 'a type change rebuilds the set');
    });

    test('add/remove capability API', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.addCapability('foo'), term, 'chains');
        assert.ok(term.hasCapability('foo'));
        assert.equal(term.removeCapability('foo'), true);
        assert.equal(term.removeCapability('foo'), false);
        assert.ok(term.getCapabilities() instanceof Set);
    });

    test('width, height and client setters', () => {
        const { term } = makeTerminal();

        assert.equal(term.setWidth('80'), true);
        assert.equal(term.getWidth(), 80);
        assert.equal(term.setHeight(25), true);
        assert.equal(term.getHeight(), 25);
        assert.equal(term.setWidth('x'), false);
        assert.equal(term.getWidth(), 80);
        assert.equal(term.setHeight('y'), false);
        assert.equal(term.getHeight(), 25);

        term.setTermClient(' CTerm ');
        assert.equal(term.getTerminalClient(), 'cterm');
    });
});

describe('encoding and output', () => {
    test('encode() converts line feeds by default and honours the encoding', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.encode('a\nb').toString('latin1'), 'a\r\nb');
        assert.equal(term.encode('a\nb', false).toString('latin1'), 'a\nb');

        //  U+2588 FULL BLOCK is 0xDB in CP437
        assert.equal(term.encode('█').toString('latin1'), 'Û');

        term.setTerminalType('xterm');
        assert.deepEqual([ ...term.encode('█') ], [ 0xe2, 0x96, 0x88 ]);
    });

    test('encode() passes non-strings through', () => {
        const { term } = makeTerminal('ansi');
        const buf = Buffer.from([ 1, 2, 3 ]);

        assert.equal(term.encode(buf), buf);
        assert.equal(term.encode(undefined), undefined);
    });

    test('setEncoding() validates', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.setEncoding('utf8'), true);
        assert.equal(term.getEncoding(), 'utf8');
        assert.equal(term.setEncoding('not-an-encoding'), false);
        assert.equal(term.getEncoding(), 'utf8');
    });

    test('write() encodes, rawWrite() does not, both chain', () => {
        const { term, writes } = makeTerminal('ansi');

        assert.equal(term.write('a\n'), term);
        assert.equal(term.rawWrite('b\n'), term);
        assert.deepEqual(writes, [ 'a\r\n', 'b\n' ]);
    });

    test('write callbacks are forwarded', (t, done) => {
        const { term } = makeTerminal('ansi');
        term.write('x', err => {
            assert.equal(err, null);
            done();
        });
    });

    test('nothing is written to a missing or unwritable socket', () => {
        const none = new Terminal(null);
        assert.equal(none.write('x'), none);

        const { term, socket, writes } = makeTerminal('ansi');
        socket.writable = false;
        term.write('x');
        assert.deepEqual(writes, []);
    });

    test('a write that cannot happen still reports to its callback', (t, done) => {
        const { term, socket } = makeTerminal('ansi');
        socket.writable = false;

        let sync = true;
        term.rawWrite('x', err => {
            assert.ok(err instanceof Error);
            assert.ok(!sync, 'callback is asynchronous like a real socket write');
            done();
        });
        sync = false;
    });

    test('handler write paths encode for the terminal without line feed conversion', () => {
        //  U+2591 LIGHT SHADE is 0xB0 in CP437
        let { term, writes } = makeTerminal('ansi');
        term.fromPipeCodes('|04░\nx');
        assert.equal(Buffer.from(writes.join(''), 'latin1').toString('hex'), '1b5b303b33316d' + 'b0' + '0a' + '78');

        ({ term, writes } = makeTerminal('xterm'));
        term.fromPipeCodes('░');
        assert.equal(Buffer.from(writes.join(''), 'latin1').toString('hex'), 'e29691');
    });

    test('cork()/uncork() reach the socket and chain', () => {
        const { term, socket } = makeTerminal('ansi');

        assert.equal(term.cork(), term);
        assert.equal(socket.corked, 1);
        assert.equal(term.uncork(), term);
        assert.equal(socket.corked, 0);

        const none = new Terminal(null);
        assert.equal(none.cork().uncork(), none);
    });

    test('setSocket() swaps the output', () => {
        const { term } = makeTerminal('ansi');
        const other = fakeSocket();

        term.setSocket(other.socket);
        term.rawWrite('z');
        assert.deepEqual(other.writes, [ 'z' ]);
    });
});

describe('colors on a 16-color terminal', () => {
    test('indexed 0..7 use plain SGR for both foreground and background', () => {
        const { term, output } = makeTerminal('ansi');

        assert.equal(term.fgColor(3, AsSequence), `${CSI}33m`);
        assert.equal(term.bgColor(3, AsSequence), `${CSI}43m`);
        assert.equal(term.fgColor('3', AsSequence), `${CSI}33m`);

        assert.equal(term.fgColor(3), term, 'chains');
        assert.equal(output(), `${CSI}33m`, 'written exactly once');
    });

    test('indexed 8..255 fold down to bold + standard', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.fgColor(9, AsSequence), `${CSI}1m${CSI}31m`);
        assert.equal(term.bgColor(9, AsSequence), `${CSI}1m${CSI}41m`);
        assert.equal(term.fgColor(200, AsSequence), `${CSI}1m${CSI}31m`);
    });

    test('names map to SGR, with background names derived when needed', () => {
        const { term } = makeTerminal('ansi');

        assert.equal(term.fgColor('red', AsSequence), `${CSI}31m`);
        assert.equal(term.bgColor('red', AsSequence), `${CSI}41m`);
        assert.equal(term.bgColor('redBG', AsSequence), `${CSI}41m`);
        assert.equal(term.fgColor('magentaBG', AsSequence), `${CSI}45m`, 'an explicit BG name is honoured as given');
    });

    test('unknown names and NaN produce nothing', () => {
        const { term, output } = makeTerminal('ansi');

        assert.equal(term.fgColor('nope', AsSequence), '');
        assert.equal(term.fgColor(NaN, AsSequence), '');
        assert.equal(term.fgColor('x', 'y', AsSequence), '', 'two args is not a valid shape');

        assert.equal(term.fgColor('nope'), term);
        assert.equal(output(), '');
    });

    test('RGB falls back to the nearest 16-color match', () => {
        const { term, output } = makeTerminal('ansi');

        assert.equal(term.fgColor(255, 0, 215, AsSequence), `${CSI}1m${CSI}31m`);
        assert.equal(term.bgColor(255, 0, 215, AsSequence), `${CSI}1m${CSI}41m`);

        term.fgColor(255, 0, 215);
        assert.equal(output(), `${CSI}1m${CSI}31m`);
    });

    test('fgRGB()/bgRGB() aliases write by default and honour AsSequence', () => {
        const { term, output } = makeTerminal('ansi');

        assert.equal(term.fgRGB(255, 0, 215), term);
        assert.equal(output(), `${CSI}1m${CSI}31m`);

        assert.equal(term.bgRGB(255, 0, 215, AsSequence), `${CSI}1m${CSI}41m`);
        assert.equal(term.fgRGB(255, 0, 215, AsSequence), `${CSI}1m${CSI}31m`);
    });
});

describe('colors by capability', () => {
    test('8-bit terminals use 38;5 / 48;5 above the basic 8', () => {
        const { term } = makeTerminal('xterm-256color');

        assert.equal(term.fgColor(3, AsSequence), `${CSI}33m`);
        assert.equal(term.fgColor(200, AsSequence), `${CSI}38;5;200m`);
        assert.equal(term.bgColor(200, AsSequence), `${CSI}48;5;200m`);
        assert.equal(term.fgColor(255, 0, 215, AsSequence), `${CSI}38;5;200m`, 'RGB nearest 256 match');
        assert.equal(term.bgRGB(255, 0, 215, AsSequence), `${CSI}48;5;200m`);
    });

    test('truecolor terminals get 38;2 / 48;2 for RGB and 38;5 for indexes', () => {
        const { term } = makeTerminal('xterm-truecolor');

        assert.equal(term.fgColor(255, 0, 215, AsSequence), `${CSI}38;2;255;0;215m`);
        assert.equal(term.bgRGB(1, 2, 3, AsSequence), `${CSI}48;2;1;2;3m`);
        assert.equal(term.fgColor(200, AsSequence), `${CSI}38;5;200m`);
    });

    test('string RGB components are parsed', () => {
        const { term } = makeTerminal('xterm-truecolor');
        assert.equal(term.fgColor('1', '2', '3', AsSequence), `${CSI}38;2;1;2;3m`);
        assert.equal(term.fgColor('1', 'x', '3', AsSequence), '');
    });

    test('indexes and components are clamped to bytes', () => {
        const { term } = makeTerminal('xterm-truecolor');
        assert.equal(term.fgColor(300, AsSequence), `${CSI}38;5;255m`);
        assert.equal(term.fgColor(-4, AsSequence), `${CSI}30m`);
        assert.equal(term.fgRGB(999, -5, 2.9, AsSequence), `${CSI}38;2;255;0;2m`);

        const ansi = makeTerminal('ansi').term;
        assert.equal(ansi.fgColor(300, AsSequence), `${CSI}1m${CSI}37m`);
    });
});

describe('hyperlinks', () => {
    test('degrade to text where no handler is mapped', () => {
        const { term, output } = makeTerminal('ansi');

        assert.equal(term.hyperlink('http://x', 'y', AsSequence), 'y');
        assert.equal(term.hyperlink('http://x', '', AsSequence), 'http://x');

        assert.equal(term.hyperlink('http://x', 'y'), term);
        assert.equal(output(), 'y');
    });

    test('xterm currently has no hyperlink handler mapped', () => {
        const { term } = makeTerminal('xterm');
        assert.equal(term.hyperlink('http://x', 'y', AsSequence), 'y');
    });

    test('vtx maps hyperlink to its handler, which degrades to text', () => {
        const { term } = makeTerminal('vtx');
        assert.equal(term.hyperlink('http://x', 'y', AsSequence), 'y');
    });
});

describe('standard method proxies', () => {
    test('ansi and control code methods are reachable on the terminal', () => {
        const { term, output } = makeTerminal('ansi');

        for (const name of [ 'cuu', 'up', 'goto', 'ed', 'el', 'sgr', 'red', 'redBG', 'fromPipeCodes' ]) {
            assert.equal(typeof(term[name]), 'function', name);
        }

        term.goto(2, 3).red().fromPipeCodes('|15x');
        assert.equal(output(), `${CSI}2;3H${CSI}31m${CSI}1;37mx`);
    });

    test('handlers are constructed and bound', () => {
        const { term } = makeTerminal('ansi');

        for (const name of [ 'ansi', 'vtx', 'ecma', 'cterm', 'osc-hyperlink', 'controlCodes' ]) {
            assert.ok(term[name], name);
            assert.equal(term[name].terminal, term, `${name} bound`);
        }
    });

    test('non-function members of handlers are not proxied', () => {
        const { term } = makeTerminal('ansi');
        assert.notEqual(typeof(term.terminal), 'function');
    });

    test('ESC is what we think it is', () => {
        assert.equal(ESC, '\x1b');
    });
});
