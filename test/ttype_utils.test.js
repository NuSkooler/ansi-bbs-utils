'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizedTermType } = require('../lib/ttype_utils');

test('known aliases normalize to their capability entry', () => {
    const cases = {
        ansi                : 'ansi-bbs',
        pcansi              : 'ansi-bbs',
        syncterm            : 'cterm',
        'xterm-color'       : 'xterm',
        'xterm-16color'     : 'xterm',
        'vt100-256color'    : 'xterm-256color',
        'ansi-256color'     : 'ansi-bbs-256color',   //  NetRunner
    };

    for (const [ input, expected ] of Object.entries(cases)) {
        assert.equal(normalizedTermType(input), expected, input);
    }
});

test('truecolor and 256color variants collapse onto the xterm family', () => {
    assert.equal(normalizedTermType('foo-truecolor'), 'xterm-truecolor');
    assert.equal(normalizedTermType('xterm-truecolor'), 'xterm-truecolor');
    assert.equal(normalizedTermType('xterm-256color'), 'xterm-256color');
    assert.equal(normalizedTermType('screen-256color'), 'xterm-256color');
    assert.equal(normalizedTermType('tmux-256color'), 'xterm-256color');
});

test('any other xterm-* variant is plain xterm', () => {
    assert.equal(normalizedTermType('xterm-kitty'), 'xterm');
    assert.equal(normalizedTermType('xterm-new'), 'xterm');
});

test('unknown types pass through unchanged', () => {
    assert.equal(normalizedTermType('dumb'), 'dumb');
    assert.equal(normalizedTermType('ansi-bbs'), 'ansi-bbs');
    assert.equal(normalizedTermType('linux'), 'linux');
});
