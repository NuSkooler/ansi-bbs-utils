'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');

const Capabilities = require('../lib/capabilities');
const { normalizedTermType } = require('../lib/ttype_utils');

//  Handler member names a Terminal constructs; capHandlers may only refer to these.
const KnownHandlers = new Set([ 'ansi', 'vtx', 'ecma', 'cterm', 'osc-hyperlink' ]);

test('every entry has a known encoding, a capability list and a handler map', () => {
    for (const [ ttype, entry ] of Object.entries(Capabilities)) {
        assert.ok(iconv.encodingExists(entry.encoding), `${ttype}: encoding ${entry.encoding}`);
        assert.ok(Array.isArray(entry.capabilities), `${ttype}: capabilities is an array`);
        assert.ok(entry.capabilities.length > 0, `${ttype}: has capabilities`);
        assert.equal(typeof(entry.capHandlers), 'object', `${ttype}: capHandlers`);
    }
});

test('cap handlers only name handlers a Terminal actually has', () => {
    for (const [ ttype, entry ] of Object.entries(Capabilities)) {
        for (const [ cap, handler ] of Object.entries(entry.capHandlers)) {
            assert.ok(KnownHandlers.has(handler), `${ttype}: ${cap} -> ${handler}`);
        }
    }
});

test('every alias the normalizer produces has an entry', () => {
    const ttypes = [
        'ansi', 'pcansi', 'ansi-bbs', 'syncterm', 'cterm', 'vtx',
        'xterm', 'xterm-color', 'xterm-256color', 'vt100-256color',
        'screen-256color', 'ansi-256color', 'foo-truecolor', 'xterm-kitty',
    ];

    for (const ttype of ttypes) {
        const normalized = normalizedTermType(ttype);
        assert.ok(Capabilities[normalized], `${ttype} -> ${normalized}`);
    }
});

test('every table key normalizes to itself', () => {
    for (const key of Object.keys(Capabilities)) {
        assert.equal(normalizedTermType(key), key, key);
    }
});

test('capability names are spelled consistently', () => {
    for (const [ ttype, entry ] of Object.entries(Capabilities)) {
        assert.ok(!entry.capabilities.includes('emca-48'), `${ttype}: emca-48 typo`);
    }

    for (const ttype of [ 'xterm', 'xterm-256color', 'xterm-truecolor', 'vtx' ]) {
        assert.ok(Capabilities[ttype].capabilities.includes('ecma-48'), ttype);
    }
});

test('BBS terminal types are CP437 and xterm types are UTF-8', () => {
    for (const ttype of [ 'ansi-bbs', 'ansi-bbs-256color', 'cterm', 'vtx' ]) {
        assert.equal(Capabilities[ttype].encoding, 'cp437', ttype);
    }
    for (const ttype of [ 'xterm', 'xterm-256color', 'xterm-truecolor' ]) {
        assert.equal(Capabilities[ttype].encoding, 'utf8', ttype);
    }
});

test('color depth per entry', () => {
    const has = (ttype, cap) => Capabilities[ttype].capabilities.includes(cap);

    assert.ok(!has('ansi-bbs', '8bit-color'));
    assert.ok(has('ansi-bbs-256color', '8bit-color'));
    assert.ok(!has('ansi-bbs-256color', '24bit-color'));
    assert.ok(has('xterm-256color', '8bit-color'));
    assert.ok(!has('xterm-256color', '24bit-color'));
    assert.ok(has('xterm-truecolor', '24bit-color'));
    assert.ok(has('cterm', '24bit-color'));
});
