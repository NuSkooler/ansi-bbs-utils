'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Terminal = require('../lib/terminal');
const FakeCTerm = require('../lib/testing/fake_cterm');
const { probeAudio, queryFormatSupport } = require('../lib/audio/probe');
const { AudioSession, Asset, Handle } = require('../lib/audio/session');
const Formats = require('../lib/audio/formats');

const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const bytes = Buffer.from('OggS not really audio');
const other = Buffer.from('OggS something else');

//  A connected fake + terminal, probed
async function probed(options = {}) {
    const { fake, term } = FakeCTerm.connect(options);
    const result = await term.probeAudio();
    return { fake, term, result, done : () => { term.destroy(); fake.destroy(); } };
}

describe('probe', () => {
    test('a CTerm with a decoder: files and tones, on this terminal only', async () => {
        const { term, result, done } = await probed({ sndfile : true });

        assert.deepEqual(result, { backend : 'cterm', files : true, client : 'unknown', ctermVersion : null });
        assert.ok(term.hasCapability('cterm-audio'));
        assert.ok(term.hasCapability('cterm-audio-files'));

        const another = new Terminal(null);
        another.setTerminalType('syncterm');
        assert.ok(!another.hasCapability('cterm-audio'), 'capabilities are per instance');
        another.destroy();
        done();
    });

    test('a CTerm without a decoder: tones only', async () => {
        const { term, result, done } = await probed({ sndfile : false });
        assert.equal(result.backend, 'cterm');
        assert.equal(result.files, false);
        assert.ok(term.hasCapability('cterm-audio'));
        assert.ok(!term.hasCapability('cterm-audio-files'));
        done();
    });

    test('silence means no audio', async (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const { fake, term } = FakeCTerm.connect({ audio : false });

        const pending = term.probeAudio({ timeout : 2000 });
        await fake.settle();
        t.mock.timers.tick(2000);
        const result = await pending;

        assert.equal(result.backend, 'none');
        assert.ok(!term.hasCapability('cterm-audio'));
        assert.equal(term.audio.backendName, 'null');
        term.destroy();
        fake.destroy();
    });

    test('a known non-CTerm client is not asked unless forced', async () => {
        const { fake, term } = FakeCTerm.connect();
        term.setTermClient('vtx');

        const result = await probeAudio(term);
        assert.equal(result.backend, 'none');
        assert.equal(result.client, 'vtx');
        assert.deepEqual(fake.apcs, [], 'nothing sent');

        const forced = await probeAudio(term, { force : true });
        assert.equal(forced.backend, 'cterm');
        assert.deepEqual(fake.apcs, [ 'SyncTERM:Q;libsndfile' ]);
        term.destroy();
        fake.destroy();
    });

    test('the terminal picks up its identity from a DA reply and the probe reports it', async () => {
        const { fake, term } = FakeCTerm.connect({ ctermVersion : '1.332' });
        term.cterm.queryDeviceAttributes();
        await fake.settle();

        const result = await term.probeAudio();
        assert.equal(result.client, 'cterm');
        assert.equal(result.ctermVersion, '1.332');
        term.destroy();
        fake.destroy();
    });
});

describe('format support', () => {
    test('asks the terminal, by name or by id', async () => {
        const { fake, term, done } = await probed({ formats : { '32;96' : true } });

        assert.equal(await queryFormatSupport(term, 'ogg', 'vorbis'), true);
        assert.equal(await queryFormatSupport(term, 'ogg/opus'), false);
        assert.equal(await queryFormatSupport(term, 32, 96), true);
        assert.equal(fake.apcs.filter(a => a.startsWith('SyncTERM:Q;libsndfileFormat')).length, 3);
        done();
    });

    test('cannot ask: no decoder, or a CTerm revision without the query', async () => {
        let { fake, term, done } = await probed({ sndfile : false });
        assert.equal(await queryFormatSupport(term, 'ogg', 'vorbis'), undefined);
        assert.ok(!fake.apcs.some(a => a.includes('libsndfileFormat')));
        done();

        ({ fake, term, done } = await probed({ ctermVersion : '1.326', formats : { '32;96' : true } }));
        term.ctermVersion = '1.326';
        assert.equal(await queryFormatSupport(term, 'ogg', 'vorbis'), undefined);
        assert.ok(!fake.apcs.some(a => a.includes('libsndfileFormat')), 'not even sent');
        done();
    });

    test('the session caches answers', async () => {
        const { fake, term, done } = await probed({ formats : { '32;96' : true } });
        assert.equal(await term.audio.formatSupported('ogg', 'vorbis'), true);
        assert.equal(await term.audio.formatSupported('ogg', 'vorbis'), true);
        assert.equal(fake.apcs.filter(a => a.includes('libsndfileFormat')).length, 1);
        done();
    });

    test('format tables', () => {
        assert.deepEqual(Formats.resolveFormat('ogg', 'vorbis'), [ 32, 96 ]);
        assert.deepEqual(Formats.resolveFormat('OGG/Opus'), [ 32, 100 ]);
        assert.deepEqual(Formats.resolveFormat('wav', 2), [ 1, 2 ]);
        assert.deepEqual(Formats.resolveFormat(35, 130), [ 35, 130 ]);
        assert.throws(() => Formats.resolveFormat('tape', 'vorbis'), RangeError);
        assert.throws(() => Formats.resolveFormat('ogg', 'aac'), RangeError);
        assert.equal(Formats.compareRevisions('1.332', '1.331'), 1);
        assert.equal(Formats.compareRevisions('1.331', '1.331'), 0);
        assert.equal(Formats.compareRevisions('1.9', '1.331'), -1);
        assert.equal(Formats.compareRevisions('2', '1.999'), 1);
        assert.ok(Formats.revisionAtLeast('1.331', Formats.Revisions.formatQuery));
        assert.ok(!Formats.revisionAtLeast('1.326', Formats.Revisions.blobVerbs));
    });
});

describe('session', () => {
    test('the null session stands in until a probe says otherwise', async () => {
        const { term, done } = await probed();
        const fresh = new Terminal(null);
        assert.equal(fresh.audio.backendName, 'null');
        assert.equal(fresh.audio, fresh.audio, 'memoized');
        fresh.destroy();

        assert.equal(term.audio.backendName, 'cterm');
        assert.equal(term.audio.capabilities().backend, 'cterm');
        assert.equal(term.audio.capabilities().files, true);
        done();
    });

    test('ensureAsset uploads once per BBS, not per session', async () => {
        const cache = new Map();

        let { fake, term, done } = await probed({ cache });
        const audio = term.audio;
        audio.asset({ name : 'music/lobby', bytes });

        const asset = await audio.ensureAsset('music/lobby');
        assert.ok(asset instanceof Asset);
        assert.equal(fake.cache.get('music/lobby').md5, md5(bytes));
        assert.deepEqual(fake.apcs, [
            'SyncTERM:Q;libsndfile',
            'SyncTERM:C;L',
            'SyncTERM:C;L;music/*',     //  unknown after the root listing: ask the directory
            `SyncTERM:C;S;music/lobby;${bytes.toString('base64')}`,
        ]);

        await audio.ensureAsset('music/lobby');
        assert.equal(fake.apcs.length, 4, 'already there');
        done();

        //  a new session against the same client cache
        ({ fake, term, done } = await probed({ cache }));
        await term.audio.ensureAsset({ name : 'music/lobby', bytes });
        assert.deepEqual(fake.apcs, [ 'SyncTERM:Q;libsndfile', 'SyncTERM:C;L' ], 'the listing said it was there');

        //  ...but changed bytes are re-sent
        await term.audio.ensureAsset({ name : 'music/lobby', bytes : other });
        assert.equal(fake.apcs.length, 3);
        assert.equal(fake.cache.get('music/lobby').md5, md5(other));
        done();
    });

    test('upload-once against a SyncTERM-style flat listing', async () => {
        const cache = new Map();

        let { fake, term, done } = await probed({ cache, listing : 'flat' });
        await term.audio.ensureAsset({ name : 'live/music', bytes });
        await term.audio.ensureAsset({ name : 'intro', bytes : other });
        assert.deepEqual(fake.apcs.filter(a => !a.startsWith('SyncTERM:C;S;')), [
            'SyncTERM:Q;libsndfile',
            'SyncTERM:C;L',             //  root: empty
            'SyncTERM:C;L;live/*',      //  the subdirectory: empty too
        ]);
        assert.equal(fake.apcs.filter(a => a.startsWith('SyncTERM:C;S;')).length, 2);
        done();

        //  a new session: the root listing shows 'intro' and a blank
        //  line for 'live/'; the subdirectory listing shows a basename
        ({ fake, term, done } = await probed({ cache, listing : 'flat' }));
        await term.audio.ensureAsset({ name : 'live/music', bytes });
        await term.audio.ensureAsset({ name : 'intro', bytes : other });
        assert.deepEqual(fake.apcs, [
            'SyncTERM:Q;libsndfile',
            'SyncTERM:C;L',
            'SyncTERM:C;L;live/*',
        ], 'listed, never re-uploaded');

        await term.audio.ensureAsset({ name : 'live/music', bytes : other });
        assert.equal(fake.apcs.filter(a => a.startsWith('SyncTERM:C;S;live/music;')).length, 1, 'changed bytes are re-sent');
        done();
    });

    test('an idle report after a stop still names what stopped', async () => {
        const { fake, term, done } = await probed();
        const idle = [];
        term.audio.on('idle', e => idle.push(e));

        const h = await term.audio.play('music', { name : 'music/lobby', bytes }, { loop : true });
        await fake.settle();
        await h.stop({ fade : 100 });
        await fake.settle();

        assert.equal(idle.length, 1);
        assert.equal(idle[0].handle, h);
        assert.equal(idle[0].name, 'music/lobby');
        done();
    });

    test('music: load, queue looping, adjust, stop with a fade', async () => {
        const { fake, term, done } = await probed();
        const audio = term.audio;

        const music = await audio.play('music', { name : 'music/lobby', bytes }, { loop : true, volume : 80 });
        assert.ok(music instanceof Handle);
        assert.equal(music.channel, 2);
        assert.equal(music.logical, 'music');
        assert.equal(music.name, 'music/lobby');
        assert.deepEqual(fake.apcs.slice(-3), [
            'SyncTERM:A;Load;S=0;music/lobby',
            'SyncTERM:A;Queue;C=2;S=0;L;V=80',
            'SyncTERM:A;Update;C=2',
        ]);
        await fake.settle();
        assert.equal(fake.channels.get(2).running, true);

        await music.volume(50, { ramp : 1000 });
        assert.equal(fake.apcs.at(-1), 'SyncTERM:A;Volume;C=2;V=50;T=1000');

        await music.stop({ fade : 500 });
        assert.equal(fake.apcs.at(-1), 'SyncTERM:A;Flush;C=2;O=500');
        await fake.settle();
        assert.equal(fake.channels.get(2).running, false);

        //  'music' can also be addressed without a handle
        await audio.volume('music', 10);
        await audio.stop('music');
        assert.deepEqual(fake.apcs.slice(-2), [ 'SyncTERM:A;Volume;C=2;V=10', 'SyncTERM:A;Flush;C=2' ]);

        assert.equal(fake.waitCalls, 0);
        done();
    });

    test('effects rotate channels and slots; idle events carry the handle', async (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const { fake, term, done } = await probed({ playbackMs : 100 });
        const audio = term.audio;
        const idle = [];
        audio.on('idle', e => idle.push(e));

        audio.asset({ name : 'sfx/hit', bytes });
        const h1 = await audio.play('sfx', 'sfx/hit');
        const h2 = await audio.play('sfx', 'sfx/hit');
        assert.equal(h1.channel, 3);
        assert.equal(h2.channel, 4);
        assert.ok(fake.apcs.includes('SyncTERM:A;Load;S=0;sfx/hit'));
        assert.ok(fake.apcs.includes('SyncTERM:A;Load;S=1;sfx/hit'));
        assert.ok(fake.apcs.includes('SyncTERM:A;Queue;C=4;S=1'));
        await fake.settle();

        t.mock.timers.tick(100);
        await fake.settle();

        assert.equal(idle.length, 2);
        assert.equal(idle[0].channel, 3);
        assert.equal(idle[0].handle, h1);
        assert.equal(idle[0].name, 'sfx/hit');
        assert.equal(idle[1].handle, h2);
        done();
    });

    test('pan becomes per-side volumes', async () => {
        const { fake, term, done } = await probed();
        const audio = term.audio;
        audio.asset({ name : 'sfx/hit', bytes });

        await audio.play('sfx', 'sfx/hit', { volume : 80, pan : 50 });
        assert.equal(fake.apcs.at(-2), 'SyncTERM:A;Queue;C=3;S=0;VL=40;VR=80');
        await audio.play('sfx', 'sfx/hit', { pan : -50 });
        assert.equal(fake.apcs.at(-2), 'SyncTERM:A;Queue;C=4;S=1;VL=100;VR=50');
        await audio.play(7, 'sfx/hit', { fadeIn : 100, crossfade : true });
        assert.equal(fake.apcs.at(-2), 'SyncTERM:A;Queue;C=7;S=2;I=100;X');

        await assert.rejects(audio.play('sfx', 'sfx/hit', { pan : 200 }), RangeError);
        done();
    });

    test('tones work without a decoder; files do not', async () => {
        const { fake, term, done } = await probed({ sndfile : false });
        const audio = term.audio;

        const tone = await audio.playTone('sfx', { hz : 440, duration : 250, volume : 50 });
        assert.equal(tone.channel, 3);
        assert.equal(tone.name, null);
        assert.deepEqual(fake.apcs.slice(-3), [
            'SyncTERM:A;Synth;S=0;W=SIN;F=440;T=250',
            'SyncTERM:A;Queue;C=3;S=0;V=50',
            'SyncTERM:A;Update;C=3',
        ]);

        await assert.rejects(audio.play('music', { name : 'x', bytes }), /decoder/);
        assert.equal(audio.capabilities().files, false);
        assert.equal(audio.capabilities().tones, true);
        done();
    });

    test('assets can come from a file path, read on first use', async () => {
        const { fake, term, done } = await probed();
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'abu-'));
        const file = path.join(dir, 'lobby.ogg');
        await fs.promises.writeFile(file, bytes);

        try {
            const music = await term.audio.play('music', { name : 'music/lobby', path : file });
            assert.equal(music.channel, 2);
            assert.equal(fake.cache.get('music/lobby').md5, md5(bytes));
        } finally {
            await fs.promises.rm(dir, { recursive : true, force : true });
            done();
        }
    });

    test('a write failure rejects without poisoning later calls', async () => {
        const { fake, term, done } = await probed();
        term.audio.asset({ name : 'sfx/hit', bytes });

        fake.socket.writable = false;
        await assert.rejects(term.audio.play('sfx', 'sfx/hit'), /not writable/);

        fake.socket.writable = true;
        const h = await term.audio.play('sfx', 'sfx/hit');
        assert.equal(h.channel, 3, 'the failed play never reached channel allocation');
        assert.ok(fake.apcs.includes('SyncTERM:A;Queue;C=3;S=0'));
        done();
    });

    test('a client that never answers the listing is treated as empty', async (t) => {
        t.mock.timers.enable({ apis : [ 'setTimeout' ] });
        const fake = new FakeCTerm();
        const term = new Terminal(fake.socket);       //  replies deliberately not fed back
        term.setTerminalType('syncterm');
        term.addCapabilities('cterm-audio', 'cterm-audio-files');

        const pending = term.audio.ensureAsset({ name : 'a', bytes });
        await fake.settle();
        t.mock.timers.tick(2000);
        await pending;

        assert.ok(fake.apcs.some(a => a.startsWith('SyncTERM:C;S;a;')), 'uploaded anyway');
        term.destroy();
        fake.destroy();
    });

    test('the null back-end accepts everything and records it', async () => {
        const term = new Terminal(null);
        const audio = term.audio;

        const h = await audio.play('music', { name : 'x', bytes }, { loop : true });
        assert.equal(h.channel, null);
        await h.volume(50);
        await h.stop();
        await audio.playTone('sfx', { hz : 100, duration : 10 });
        assert.equal(await audio.formatSupported('ogg', 'vorbis'), undefined);
        assert.deepEqual(audio.backend.calls.map(c => c[0]), [ 'ensureAsset', 'play', 'volume', 'stop', 'playTone' ]);
        term.destroy();
    });

    test('argument checking', async () => {
        const { term, done } = await probed();
        const audio = term.audio;

        assert.throws(() => audio.asset('nope'), RangeError);
        assert.throws(() => audio.asset({ name : '../x', bytes }), RangeError);
        assert.throws(() => audio.asset({ name : 'x' }), TypeError);
        assert.throws(() => audio.asset({ name : 'x', bytes : 42 }), TypeError);
        assert.throws(() => audio.stop('sfx'), RangeError);
        assert.throws(() => audio.stop('drums'), RangeError);
        assert.throws(() => new AudioSession(term, { backend : 'tape' }), RangeError);
        done();
    });

    test('explicit per-side volumes and blob capability', async () => {
        const { fake, term, done } = await probed({ ctermVersion : '1.332' });
        term.audio.asset({ name : 'sfx/hit', bytes });

        await term.audio.play('sfx', 'sfx/hit', { volumeLeft : 10, volumeRight : '-3dB', fadeOut : 250 });
        assert.equal(fake.apcs.at(-2), 'SyncTERM:A;Queue;C=3;S=0;O=250;VL=10;VR=-3dB');

        assert.equal(term.audio.capabilities().blobs, true, 'unknown revision: assume the newer verbs');
        term.ctermVersion = '1.326';
        assert.equal(term.audio.capabilities().blobs, false);
        term.ctermVersion = '1.329';
        assert.equal(term.audio.capabilities().blobs, true);
        done();
    });

    test('assets register by instance and re-register by name', async () => {
        const { fake, term, done } = await probed();
        const audio = term.audio;

        const a = new Asset({ name : 'sfx/hit', bytes });
        assert.equal(audio.asset(a), a);
        assert.equal(audio.asset({ name : 'sfx/hit', bytes }), a, 'same name and bytes: the known one');
        const b = audio.asset({ name : 'sfx/hit', bytes : other });
        assert.notEqual(b, a, 'new bytes: a new asset');

        await audio.ensureAsset('sfx/hit');
        assert.equal(fake.cache.get('sfx/hit').md5, md5(other));

        audio.backend.invalidateCache();
        await audio.ensureAsset('sfx/hit');
        assert.equal(fake.apcs.filter(x => x === 'SyncTERM:C;L').length, 2, 'asked again after invalidation');
        assert.equal(fake.apcs.filter(x => x.startsWith('SyncTERM:C;S;')).length, 1, 'but the listing knew it');
        done();
    });

    test('destroy() detaches from the terminal', async () => {
        const { fake, term, done } = await probed();
        const audio = term.audio;
        const idle = [];
        audio.on('idle', e => idle.push(e));
        audio.destroy();

        term.feed(`${String.fromCharCode(0x1b)}[=7;3;0n`);
        assert.deepEqual(idle, []);
        fake.destroy();
        term.destroy();
        void done;
    });
});
