'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const FakeCTerm = require('../lib/testing/fake_cterm');

const { ESC, CSI } = require('./helpers');

const APC = `${ESC}_`;
const ST = `${ESC}\\`;
const apc = body => `${APC}${body}${ST}`;
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

const bytes = Buffer.from('not really audio, but bytes');

describe('identity', () => {
    test('answers CSI c and CSI < c as CTerm', async () => {
        const { fake, term } = FakeCTerm.connect({ ctermVersion : '1.332' });

        term.cterm.queryDeviceAttributes();
        await fake.settle();
        assert.equal(term.getTerminalClient(), 'cterm');
        assert.equal(term.ctermVersion, '1.332');

        term.rawWrite(`${CSI}<c`);
        await fake.settle();
        assert.equal(fake.log.filter(e => 'da' === e.type).length, 2);

        term.destroy();
        fake.destroy();
    });

    test('can be IcyTerm, which carries no CTerm revision', async () => {
        const { fake, term } = FakeCTerm.connect({ client : 'icy_term', ctermVersion : '0.8.4' });

        term.cterm.queryDeviceAttributes();
        await fake.settle();
        assert.equal(term.getTerminalClient(), 'icy_term');
        assert.equal(term.clientVersion, '0.8.4');
        assert.equal(term.ctermVersion, null);

        term.destroy();
        fake.destroy();
    });

    test('a client that does not answer', async () => {
        const { fake, term } = FakeCTerm.connect({ client : 'nobody' });
        term.cterm.queryDeviceAttributes();
        await fake.settle();
        assert.equal(term.getTerminalClient(), 'unknown');
        term.destroy();
        fake.destroy();
    });
});

describe('queries', () => {
    test('libsndfile and format queries', async () => {
        const { fake, term } = FakeCTerm.connect({ sndfile : true, formats : { '32;96' : true } });
        const reports = [];
        term.on('report', r => reports.push(r.params));

        term.cterm.queryLibsndfile();
        term.cterm.queryFormat(32, 96);
        term.cterm.queryFormat(32, 100);
        await fake.settle();

        assert.deepEqual(reports, [ [ 7, 100, 1 ], [ 7, 101, 32, 96, 1 ], [ 7, 101, 32, 100, 0 ] ]);
        term.destroy();
        fake.destroy();
    });

    test('an older CTerm does not answer the format query', async () => {
        const { fake, term } = FakeCTerm.connect({ ctermVersion : '1.326', formats : { '32;96' : true } });
        const reports = [];
        term.on('report', r => reports.push(r.params));

        term.cterm.queryFormat(32, 96);
        term.cterm.queryLibsndfile();
        await fake.settle();

        assert.deepEqual(reports, [ [ 7, 100, 1 ] ]);
        term.destroy();
        fake.destroy();
    });

    test('a terminal without the audio APC ignores it', async () => {
        const { fake, term } = FakeCTerm.connect({ audio : false });
        const reports = [];
        term.on('report', r => reports.push(r.params));

        term.cterm.queryLibsndfile();
        term.cterm.audioUpdate(2);
        await fake.settle();

        assert.deepEqual(reports, []);
        assert.equal(fake.apcs.length, 2, 'still seen, just ignored');
        term.destroy();
        fake.destroy();
    });
});

describe('cache', () => {
    test('store then list, delivered in pieces and reassembled', async () => {
        const { fake, term } = FakeCTerm.connect();
        const apcs = [];
        term.on('apc', a => apcs.push(a.body));

        term.cterm.storeFile('a.ogg', bytes);
        term.cterm.storeFile('sfx/hit.wav', Buffer.from('hit'));
        term.cterm.listFiles();
        await fake.settle();

        assert.equal(fake.cache.get('a.ogg').md5, md5(bytes));
        assert.deepEqual(apcs, [ `SyncTERM:C;L\na.ogg\t${md5(bytes)}\nsfx/hit.wav\t${md5(Buffer.from('hit'))}\n` ]);

        term.cterm.listFiles('sfx/*');
        await fake.settle();
        assert.equal(apcs[1], `SyncTERM:C;L\nsfx/hit.wav\t${md5(Buffer.from('hit'))}\n`);

        term.destroy();
        fake.destroy();
    });

    test('a shared cache models one BBS across sessions', async () => {
        const cache = new Map();
        const first = FakeCTerm.connect({ cache });
        first.term.cterm.storeFile('a.ogg', bytes);
        await first.fake.settle();
        first.term.destroy();
        first.fake.destroy();

        const second = FakeCTerm.connect({ cache, fragmentReplies : false });
        const apcs = [];
        second.term.on('apc', a => apcs.push(a.body));
        second.term.cterm.listFiles();
        await second.fake.settle();
        assert.equal(apcs[0], `SyncTERM:C;L\na.ogg\t${md5(bytes)}\n`);
        second.term.destroy();
        second.fake.destroy();
    });
});

describe('mixer', () => {
    test('load, queue, state, and an idle report once armed', async (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const { fake, term } = FakeCTerm.connect({ playbackMs : 100 });
        const reports = [];
        term.on('report', r => reports.push(r.params));

        term.cterm.storeFile('a.ogg', bytes);
        term.cterm.audioLoad(0, 'a.ogg');
        term.cterm.audioQueue(3, 0);
        term.cterm.audioUpdate(3);
        term.cterm.queryAudioState(3);
        term.cterm.queryAudioState();
        await fake.settle();

        assert.equal(fake.slots[0], null, 'Queue empties the slot');
        assert.equal(fake.channels.get(3).running, true);
        assert.deepEqual(reports, [ [ 7, 3, 1 ], [ 7, 3, 1 ] ]);

        t.mock.timers.tick(100);
        await fake.settle();
        assert.equal(fake.channels.get(3).running, false);
        assert.deepEqual(reports[2], [ 7, 3, 0 ], 'the armed idle report');

        term.cterm.queryAudioState();
        await fake.settle();
        assert.deepEqual(reports[3], [ 7 ], 'a fully idle terminal');

        term.destroy();
        fake.destroy();
    });

    test('a loop runs until flushed; Flush reports idle when armed', async (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const { fake, term } = FakeCTerm.connect({ playbackMs : 100 });
        const reports = [];
        term.on('report', r => reports.push(r.params));

        term.cterm.storeFile('a.ogg', bytes);
        term.cterm.audioLoad(0, 'a.ogg');
        term.cterm.audioQueue(2, 0, { loop : true });
        term.cterm.audioUpdate(2);
        await fake.settle();

        t.mock.timers.tick(1000);
        await fake.settle();
        assert.equal(fake.channels.get(2).running, true);
        assert.deepEqual(reports, []);

        term.cterm.audioFlush(2, { fadeOut : 500 });
        await fake.settle();
        assert.equal(fake.channels.get(2).running, false);
        assert.deepEqual(reports, [ [ 7, 2, 0 ] ]);

        term.destroy();
        fake.destroy();
    });

    test('terminal-owned channels, empty slots, missing decoder', async () => {
        const { fake, term } = FakeCTerm.connect({ sndfile : false });

        term.cterm.storeFile('a.ogg', bytes);
        term.cterm.audioLoad(0, 'a.ogg');           //  no decoder: ignored
        term.cterm.audioQueue(3, 0);                //  empty slot: ignored
        term.cterm.audioSynth(1, 'SIN', 440, 100);
        term.rawWrite(apc('SyncTERM:A;Queue;C=1;S=1'));  //  the terminal's channel: ignored
        await fake.settle();

        assert.equal(fake.slots[0], null);
        assert.equal(fake.channels.get(3).running, false);
        assert.equal(fake.channels.get(1).running, false);
        assert.deepEqual(fake.slots[1], { source : 'synth', shape : 'SIN', hz : '440', duration : '100' });

        term.destroy();
        fake.destroy();
    });

    test('Wait and Volume are recorded', async () => {
        const { fake, term } = FakeCTerm.connect();

        term.rawWrite(apc('SyncTERM:A;Wait;C=3'));
        term.cterm.audioVolume(3, { volume : 40, ramp : 200 });
        await fake.settle();

        assert.equal(fake.waitCalls, 1);
        assert.deepEqual(fake.channels.get(3).volume, { V : '40', VL : undefined, VR : undefined, T : '200' });

        term.destroy();
        fake.destroy();
    });

    test('output() has every byte the BBS wrote', async () => {
        const { fake, term } = FakeCTerm.connect();
        term.write('hi');
        term.cterm.audioUpdate(2);
        assert.equal(fake.output(), `hi${apc('SyncTERM:A;Update;C=2')}`);
        term.destroy();
        fake.destroy();
    });
});
