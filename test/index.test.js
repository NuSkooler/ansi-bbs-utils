'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('..');

test('package exports', () => {
    assert.equal(typeof(pkg.Terminal), 'function');
    assert.equal(typeof(pkg.Common), 'object');
    assert.equal(typeof(pkg.Common.AsSequence), 'symbol');
    assert.equal(pkg.Common.CSI, '\u001b[');
    assert.equal(typeof(pkg.Common.wantAsSequence), 'function');
    assert.equal(typeof(pkg.ReplyParser), 'function');
    assert.equal(typeof(pkg.DeviceAttributes.parseDeviceAttributes), 'function');
});

test('wantAsSequence() only looks at the last argument', () => {
    const { AsSequence, wantAsSequence } = pkg.Common;

    assert.equal(wantAsSequence(1, 2, AsSequence), AsSequence);
    assert.equal(wantAsSequence(AsSequence, 1), false);
    assert.equal(wantAsSequence(), false);
});

test('README usage compiles: type, color, write', () => {
    const { Terminal } = pkg;
    const writes = [];
    const term = new Terminal({ writable : true, write : d => writes.push(d.toString('latin1')) });

    term.setTerminalType('ansi-bbs');
    term.fgColor('green').write('Hello, world!');

    assert.deepEqual(writes, [ '\u001b[32m', 'Hello, world!' ]);
});
