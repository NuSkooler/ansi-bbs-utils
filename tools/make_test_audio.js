#!/usr/bin/env node
'use strict';

//
//  Generate WAV samples for the live audio checklist, with no external
//  tools: a short melody for 'music', a blip for 'sfx', and a large
//  file for upload timing.
//
//      node tools/make_test_audio.js [outDir]        (default tools/samples)
//
//  WAV is decoded by every client build (libsndfile and IcyTerm's
//  Symphonia). Vorbis/Opus/MP3 files must come from elsewhere; pass
//  them to the harness with --music/--sfx/--big.
//

const fs = require('fs');
const path = require('path');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, 'samples'));
fs.mkdirSync(outDir, { recursive : true });

//  16-bit PCM WAV from a sample function (t seconds, channel) -> -1..1
function wav(file, seconds, rate, channels, sample) {
    const frames = Math.floor(seconds * rate);
    const data = Buffer.alloc(frames * channels * 2);
    for (let i = 0; i < frames; ++i) {
        const t = i / rate;
        for (let c = 0; c < channels; ++c) {
            const v = Math.max(-1, Math.min(1, sample(t, c)));
            data.writeInt16LE(Math.round(v * 32767), (i * channels + c) * 2);
        }
    }

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);               //  PCM chunk size
    header.writeUInt16LE(1, 20);                //  PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);

    fs.writeFileSync(file, Buffer.concat([ header, data ]));
    console.log(`${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  ${seconds}s ${rate}Hz x${channels}`);
}

const TAU = Math.PI * 2;

//  music: eight seconds of a four-note loop with a soft envelope, mono 22.05 kHz
const notes = [ 261.63, 329.63, 392.0, 523.25 ];
wav(path.join(outDir, 'music.wav'), 8, 22050, 1, t => {
    const step = 0.5;
    const n = Math.floor(t / step) % notes.length;
    const local = (t % step) / step;
    const env = Math.min(1, local * 8) * (1 - local) ** 0.6;
    const f = notes[n];
    return env * (0.5 * Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2 * t) + 0.1 * Math.sin(TAU * f * 3 * t));
});

//  sfx: a quarter second decaying blip, mono 44.1 kHz
wav(path.join(outDir, 'sfx.wav'), 0.25, 44100, 1, t => {
    const env = Math.exp(-t * 18);
    return env * Math.sin(TAU * (880 - 400 * t) * t);
});

//  big: twenty seconds stereo 44.1 kHz (about 3.5 MB) for upload timing
wav(path.join(outDir, 'big.wav'), 20, 44100, 2, (t, c) => {
    const f = 110 * (1 + (Math.floor(t) % 4));
    const tone = 0.3 * Math.sin(TAU * f * t + (c ? 0.5 : 0));
    const noise = 0.05 * (Math.random() * 2 - 1);
    return tone + noise;
});

console.log(`written to ${outDir}`);
