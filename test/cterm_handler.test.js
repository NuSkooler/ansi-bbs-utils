'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { AsSequence } = require('../lib/common');
const CTerm = require('../lib/handlers/cterm');

const { ESC, CSI, makeTerminal } = require('./helpers');

const APC = `${ESC}_`;
const ST = `${ESC}\\`;
const apc = body => `${APC}${body}${ST}`;

describe('queries', () => {
    test('device attributes, features, formats', () => {
        const { term } = makeTerminal('syncterm');
        const c = term.cterm;

        assert.equal(c.queryDeviceAttributes(AsSequence), `${CSI}c`);
        assert.equal(c.queryLibsndfile(AsSequence), apc('SyncTERM:Q;libsndfile'));
        assert.equal(c.queryFeature('JXL', AsSequence), apc('SyncTERM:Q;JXL'));
        assert.equal(c.queryFormat(32, 100, AsSequence), apc('SyncTERM:Q;libsndfileFormat;32;100'));
        assert.throws(() => c.queryFormat(-1, 0, AsSequence), RangeError);
        assert.throws(() => c.queryFormat(1.5, 0, AsSequence), RangeError);
    });

    test('audio state', () => {
        const { term } = makeTerminal('syncterm');
        const c = term.cterm;

        assert.equal(c.queryAudioState(AsSequence), `${CSI}=7n`);
        assert.equal(c.queryAudioState(3, AsSequence), `${CSI}=7;3n`);
        assert.equal(c.queryAudioState(0, AsSequence), `${CSI}=7;0n`);
        assert.throws(() => c.queryAudioState(16, AsSequence), RangeError);
    });
});

describe('client file cache', () => {
    test('storeFile base64 encodes the bytes', () => {
        const { term } = makeTerminal('syncterm');

        assert.equal(term.cterm.storeFile('sfx/hit.wav', Buffer.from('abc'), AsSequence), apc('SyncTERM:C;S;sfx/hit.wav;YWJj'));
        assert.equal(term.cterm.storeFile('a.ogg', 'abc', AsSequence), apc('SyncTERM:C;S;a.ogg;YWJj'), 'a binary string works too');
        assert.equal(term.cterm.storeFile('b', Buffer.from([ 0xff, 0x00 ]), AsSequence), apc('SyncTERM:C;S;b;/wA='));
    });

    test('cache names follow the stricter (IcyTerm) rules', () => {
        for (const ok of [ 'a', 'lobby.ogg', 'sfx/hit.wav', 'a-b_c.d', 'x/y/z', '1' ]) {
            assert.ok(CTerm.isValidCacheName(ok), ok);
        }
        for (const bad of [ '', '../x', 'a/../b', './a', 'a b', 'x/', '/x', 'a//b', 'a\\b', 'a;b', 'ä', 'a'.repeat(129), 42, null ]) {
            assert.ok(!CTerm.isValidCacheName(bad), JSON.stringify(bad));
        }

        const { term } = makeTerminal('syncterm');
        assert.throws(() => term.cterm.storeFile('../x', 'a', AsSequence), RangeError);
        assert.throws(() => term.cterm.audioLoad(0, 'a b', AsSequence), RangeError);
    });

    test('listFiles with and without a glob', () => {
        const { term } = makeTerminal('syncterm');

        assert.equal(term.cterm.listFiles(AsSequence), apc('SyncTERM:C;L'));
        assert.equal(term.cterm.listFiles('*', AsSequence), apc('SyncTERM:C;L'));
        assert.equal(term.cterm.listFiles('sfx/*', AsSequence), apc('SyncTERM:C;L;sfx/*'));
    });
});

describe('audio verbs', () => {
    test('Load, LoadBlob, Synth, Copy', () => {
        const { term } = makeTerminal('syncterm');
        const c = term.cterm;

        assert.equal(c.audioLoad(5, 'lobby.ogg', AsSequence), apc('SyncTERM:A;Load;S=5;lobby.ogg'));
        assert.equal(c.audioLoadBlob(0, Buffer.from('abc'), AsSequence), apc('SyncTERM:A;LoadBlob;S=0;YWJj'));
        assert.equal(c.audioSynth(1, 'sin', 440, 500, AsSequence), apc('SyncTERM:A;Synth;S=1;W=SIN;F=440;T=500'));
        assert.equal(c.audioSynth(1, 'SQ', 440.4, '4p', AsSequence), apc('SyncTERM:A;Synth;S=1;W=SQ;F=440;T=4p'));
        assert.equal(c.audioSynth(2, 'silence', 0, '22050f', AsSequence), apc('SyncTERM:A;Synth;S=2;W=SILENCE;F=0;T=22050f'));
        assert.equal(c.audioCopy(1, 2, AsSequence), apc('SyncTERM:A;Copy;S=1;D=2'));

        assert.throws(() => c.audioLoad(256, 'x', AsSequence), RangeError);
        assert.throws(() => c.audioLoad(-1, 'x', AsSequence), RangeError);
        assert.throws(() => c.audioLoad('0', 'x', AsSequence), RangeError);
        assert.throws(() => c.audioSynth(1, 'tri', 440, 500, AsSequence), RangeError);
        assert.throws(() => c.audioSynth(1, 'SIN', -1, 500, AsSequence), RangeError);
        assert.throws(() => c.audioCopy(0, 300, AsSequence), RangeError);
    });

    test('Queue with every option', () => {
        const { term } = makeTerminal('syncterm');
        const c = term.cterm;

        assert.equal(c.audioQueue(2, 0, AsSequence), apc('SyncTERM:A;Queue;C=2;S=0'));
        assert.equal(c.audioQueue(2, 0, {}, AsSequence), apc('SyncTERM:A;Queue;C=2;S=0'));
        assert.equal(
            c.audioQueue(3, 7, { fadeIn : 500, fadeOut : '22050f', crossfade : true, loop : true, volume : 80 }, AsSequence),
            apc('SyncTERM:A;Queue;C=3;S=7;I=500;O=22050f;X;L;V=80')
        );
        assert.equal(
            c.audioQueue(15, 255, { volumeLeft : 10, volumeRight : '-6.5dB' }, AsSequence),
            apc('SyncTERM:A;Queue;C=15;S=255;VL=10;VR=-6.5dB')
        );

        assert.throws(() => c.audioQueue(1, 0, AsSequence), RangeError, 'channels 0 and 1 are the terminal\'s');
        assert.throws(() => c.audioQueue(0, 0, AsSequence), RangeError);
        assert.throws(() => c.audioQueue(2, 0, { fadeIn : '4p' }, AsSequence), RangeError, 'periods are Synth only');
        assert.throws(() => c.audioQueue(2, 0, { volume : 101 }, AsSequence), RangeError);
    });

    test('Flush, Volume, Update', () => {
        const { term } = makeTerminal('syncterm');
        const c = term.cterm;

        assert.equal(c.audioFlush(2, AsSequence), apc('SyncTERM:A;Flush;C=2'));
        assert.equal(c.audioFlush(0, { fadeOut : 1000 }, AsSequence), apc('SyncTERM:A;Flush;C=0;O=1000'));

        assert.equal(c.audioVolume(2, { volume : 50 }, AsSequence), apc('SyncTERM:A;Volume;C=2;V=50'));
        assert.equal(
            c.audioVolume(2, { volumeLeft : 10, volumeRight : 90, ramp : 1000 }, AsSequence),
            apc('SyncTERM:A;Volume;C=2;VL=10;VR=90;T=1000')
        );
        assert.equal(c.audioVolume(1, { volume : '-3dB', ramp : '44100f' }, AsSequence), apc('SyncTERM:A;Volume;C=1;V=-3dB;T=44100f'));
        assert.throws(() => c.audioVolume(2, {}, AsSequence), RangeError, 'needs a volume');
        assert.throws(() => c.audioVolume(2, { volume : 50, ramp : '2p' }, AsSequence), RangeError);

        assert.equal(c.audioUpdate(4, AsSequence), apc('SyncTERM:A;Update;C=4'));
        assert.throws(() => c.audioUpdate(16, AsSequence), RangeError);
    });

    test('Wait is not offered', () => {
        const { term } = makeTerminal('syncterm');
        assert.equal(term.cterm.audioWait, undefined);
    });

    test('the write path writes the framed sequence and chains', () => {
        const { term, output } = makeTerminal('syncterm');
        assert.equal(term.cterm.audioUpdate(2), term);
        assert.equal(output(), apc('SyncTERM:A;Update;C=2'));
    });
});

describe('grammars', () => {
    test('durations', () => {
        assert.equal(CTerm.formatDuration(500), '500');
        assert.equal(CTerm.formatDuration(500.4), '500');
        assert.equal(CTerm.formatDuration(0), '0');
        assert.equal(CTerm.formatDuration('500'), '500');
        assert.equal(CTerm.formatDuration(' 500ms '), '500ms');
        assert.equal(CTerm.formatDuration('22050f'), '22050f');
        assert.equal(CTerm.formatDuration('4p', { allowPeriods : true }), '4p');

        for (const bad of [ '4p', -1, NaN, Infinity, 'abc', '1.5', '', null, undefined, {} ]) {
            assert.throws(() => CTerm.formatDuration(bad), RangeError, JSON.stringify(bad));
        }
    });

    test('volumes', () => {
        assert.equal(CTerm.formatVolume(50), '50');
        assert.equal(CTerm.formatVolume(100.4), '100');
        assert.equal(CTerm.formatVolume(0), '0');
        assert.equal(CTerm.formatVolume('75'), '75');
        assert.equal(CTerm.formatVolume('-6.5dB'), '-6.5dB');
        assert.equal(CTerm.formatVolume('3DB'), '3DB');

        for (const bad of [ 101, -1, '101', 'x', '6.5', NaN, null ]) {
            assert.throws(() => CTerm.formatVolume(bad), RangeError, JSON.stringify(bad));
        }
    });

    test('constants', () => {
        assert.equal(CTerm.MaxSlot, 255);
        assert.equal(CTerm.MaxChannel, 15);
        assert.equal(CTerm.MinBBSChannel, 2);
        assert.ok(CTerm.SynthShapes.includes('SINE_SAW_CHORD'));
    });
});
