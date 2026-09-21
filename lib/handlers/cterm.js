//
//  CTerm / SyncTERM extensions.
//
//  Normative reference: https://www.syncterm.net/cterm.html
//  (the cterm.txt in docs/reference is an older copy without the
//  audio and cache sections).
//
//  Everything here emits; replies come back through the terminal's
//  input side (see lib/input/reply_parser.js):
//
//  - CSI c                          -> CSI = 67;84;101;114;109;<rev> c
//  - APC SyncTERM:Q;libsndfile ST   -> CSI = 7 ; 100 ; 0|1 n
//  - APC SyncTERM:Q;libsndfileFormat;pm;ps ST
//                                   -> CSI = 7 ; 101 ; pm ; ps ; 0|1 n   (rev >= 1.331)
//  - APC SyncTERM:C;L ST            -> APC SyncTERM:C;L LF (<name> TAB <md5> LF)* ST
//  - CSI = 7 [; ch] n               -> CSI = 7 [; ch ; state]* n
//  - APC SyncTERM:A;Update;C=# ST   -> CSI = 7 ; ch ; 0 n   (later, once)
//
//  The audio model: 256 patch slots of decoded PCM (S=0..255) and 16
//  mixer channels (C=0..15). Channels 0 and 1 belong to the terminal
//  (ANSI music, RIP/OOII effects); a BBS queues onto 2..15 only.
//  Queue MOVES a slot's buffer onto the channel, emptying the slot.
//
//  APC SyncTERM:A;Wait is deliberately not offered: it stalls the
//  terminal's input processing until the channel idles. Use Update
//  and the asynchronous report instead.
//

const {
    CSI,
    AsSequence,
} = require('../common');

const Handler = require('./handler');

const ESC = String.fromCharCode(0x1b);
const APC = `${ESC}_`;
const ST = `${ESC}\\`;

const SynthShapes = [
    'SIN', 'SAW', 'SQ', 'SINE_HARM', 'SINE_SAW', 'SINE_SAW_CHORD', 'SINE_SAW_HARM', 'SILENCE',
];

const MaxSlot           = 255;
const MaxChannel        = 15;
const MinBBSChannel     = 2;    //  0 and 1 are the terminal's own
const MaxCacheNameLen   = 128;

const isInt = n => Number.isInteger(n);

const assertSlot = (slot, what = 'slot') => {
    if (!isInt(slot) || slot < 0 || slot > MaxSlot) {
        throw new RangeError(`${what} must be an integer 0..${MaxSlot}, got ${slot}`);
    }
};

const assertChannel = (channel, min) => {
    if (!isInt(channel) || channel < min || channel > MaxChannel) {
        throw new RangeError(`channel must be an integer ${min}..${MaxChannel}, got ${channel}`);
    }
};

//
//  Duration grammar for T, I, O:
//  - number            -> milliseconds
//  - 'N' / 'Nms'       -> milliseconds
//  - 'Nf'              -> frames, sample exact (44.1 kHz)
//  - 'Np'              -> full periods of F; Synth only
//
const formatDuration = (value, { allowPeriods = false, what = 'duration' } = {}) => {
    if ('number' === typeof(value)) {
        if (Number.isFinite(value) && value >= 0) {
            return String(Math.round(value));
        }
    } else if ('string' === typeof(value)) {
        const m = /^(\d+)(ms|f|p)?$/.exec(value.trim());
        if (m && ('p' !== m[2] || allowPeriods)) {
            return `${m[1]}${m[2] || ''}`;
        }
    }

    throw new RangeError(
        `${what} must be a non-negative number of milliseconds or a string like ` +
        `'500', '500ms', '22050f'${allowPeriods ? " or '4p'" : ''}; got ${JSON.stringify(value)}`
    );
};

//
//  Volume grammar for V, VL, VR:
//  - number 0..100     -> linear percentage (100 = 0 dB, 0 = silence)
//  - '<float>dB'       -> explicit dB, any sign
//
const formatVolume = (value, what = 'volume') => {
    if ('number' === typeof(value)) {
        const n = Math.round(value);
        if (Number.isFinite(n) && n >= 0 && n <= 100) {
            return String(n);
        }
    } else if ('string' === typeof(value)) {
        const s = value.trim();
        if (/^-?\d+(\.\d+)?dB$/i.test(s)) {
            return s;
        }
        if (/^\d+$/.test(s) && parseInt(s, 10) <= 100) {
            return String(parseInt(s, 10));
        }
    }

    throw new RangeError(`${what} must be 0..100 or a string like '-6.5dB'; got ${JSON.stringify(value)}`);
};

//
//  Cache names, per the stricter implementation (IcyTerm): segments of
//  [A-Za-z0-9._-] joined by '/', no empty, '.' or '..' segments.
//
const CacheNameSegment = /^[A-Za-z0-9._-]+$/;

const isValidCacheName = (name) => {
    if ('string' !== typeof(name) || !name.length || name.length > MaxCacheNameLen) {
        return false;
    }
    return name.split('/').every(segment => {
        return segment.length && '.' !== segment && '..' !== segment && CacheNameSegment.test(segment);
    });
};

const assertCacheName = (name) => {
    if (!isValidCacheName(name)) {
        throw new RangeError(
            `invalid cache name ${JSON.stringify(name)}: segments of [A-Za-z0-9._-] joined by '/', ` +
            `no '.' or '..', at most ${MaxCacheNameLen} characters`
        );
    }
};

const toBase64 = (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
    return buf.toString('base64');
};

//  (opts, asSequence) where either may be omitted
const optsAndFlag = (opts, asSequence) => {
    if (AsSequence === opts) {
        return [ {}, AsSequence ];
    }
    return [ opts || {}, asSequence ];
};

module.exports = class CTerm extends Handler {
    constructor(terminal) {
        super(terminal);
    }

    static get SynthShapes() {
        return SynthShapes;
    }

    static get MaxSlot() {
        return MaxSlot;
    }

    static get MaxChannel() {
        return MaxChannel;
    }

    static get MinBBSChannel() {
        return MinBBSChannel;
    }

    static formatDuration(value, options) {
        return formatDuration(value, options);
    }

    static formatVolume(value) {
        return formatVolume(value);
    }

    static isValidCacheName(name) {
        return isValidCacheName(name);
    }

    static assertCacheName(name) {
        return assertCacheName(name);
    }

    //  see cterm.txt -- :TODO: font selection
    fnt(n, font, asSequence = false) {
        return AsSequence === asSequence ? '' : this.terminal;
    }

    //  alias for fnt
    setFont(n, font, asSequence = false) {
        return this.fnt(n, font, asSequence);
    }

    //  APC SyncTERM:<body> ST
    apc(body, asSequence = false) {
        return this._seqOrWrite(`${APC}${body}${ST}`, asSequence);
    }

    //
    //  Queries
    //
    queryDeviceAttributes(asSequence = false) {
        return this._seqOrWrite(`${CSI}c`, asSequence);
    }

    queryFeature(name, asSequence = false) {
        return this.apc(`SyncTERM:Q;${name}`, asSequence);
    }

    queryLibsndfile(asSequence = false) {
        return this.queryFeature('libsndfile', asSequence);
    }

    queryFormat(major, subtype, asSequence = false) {
        if (!isInt(major) || major < 0 || !isInt(subtype) || subtype < 0) {
            throw new RangeError(`format major and subtype must be non-negative integers, got ${major}, ${subtype}`);
        }
        return this.apc(`SyncTERM:Q;libsndfileFormat;${major};${subtype}`, asSequence);
    }

    //  CSI = 7 n (all running channels) or CSI = 7 ; ch n (one channel)
    queryAudioState(channel, asSequence = false) {
        if (AsSequence === channel) {
            asSequence = AsSequence;
            channel = undefined;
        }
        if (undefined !== channel) {
            assertChannel(channel, 0);
        }
        return this._seqOrWrite(`${CSI}=7${undefined === channel ? '' : `;${channel}`}n`, asSequence);
    }

    //
    //  Client-side file cache
    //
    storeFile(name, data, asSequence = false) {
        assertCacheName(name);
        return this.apc(`SyncTERM:C;S;${name};${toBase64(data)}`, asSequence);
    }

    listFiles(glob, asSequence = false) {
        if (AsSequence === glob) {
            asSequence = AsSequence;
            glob = undefined;
        }
        const body = glob && '*' !== glob ? `SyncTERM:C;L;${glob}` : 'SyncTERM:C;L';
        return this.apc(body, asSequence);
    }

    //
    //  Audio
    //
    audioLoad(slot, name, asSequence = false) {
        assertSlot(slot);
        assertCacheName(name);
        return this.apc(`SyncTERM:A;Load;S=${slot};${name}`, asSequence);
    }

    audioLoadBlob(slot, data, asSequence = false) {
        assertSlot(slot);
        return this.apc(`SyncTERM:A;LoadBlob;S=${slot};${toBase64(data)}`, asSequence);
    }

    audioSynth(slot, shape, hz, duration, asSequence = false) {
        assertSlot(slot);
        shape = String(shape).toUpperCase();
        if (!SynthShapes.includes(shape)) {
            throw new RangeError(`shape must be one of ${SynthShapes.join(', ')}; got ${JSON.stringify(shape)}`);
        }
        if (!Number.isFinite(hz) || hz < 0) {
            throw new RangeError(`frequency must be a non-negative number of Hz, got ${hz}`);
        }
        const t = formatDuration(duration, { allowPeriods : true });
        return this.apc(`SyncTERM:A;Synth;S=${slot};W=${shape};F=${Math.round(hz)};T=${t}`, asSequence);
    }

    audioCopy(source, destination, asSequence = false) {
        assertSlot(source, 'source slot');
        assertSlot(destination, 'destination slot');
        return this.apc(`SyncTERM:A;Copy;S=${source};D=${destination}`, asSequence);
    }

    //
    //  opts: fadeIn, fadeOut (durations), crossfade, loop (flags),
    //  volume, volumeLeft, volumeRight (volumes)
    //
    audioQueue(channel, slot, opts, asSequence = false) {
        [ opts, asSequence ] = optsAndFlag(opts, asSequence);
        assertChannel(channel, MinBBSChannel);
        assertSlot(slot);

        const parts = [ `C=${channel}`, `S=${slot}` ];
        if (undefined !== opts.fadeIn) {
            parts.push(`I=${formatDuration(opts.fadeIn, { what : 'fadeIn' })}`);
        }
        if (undefined !== opts.fadeOut) {
            parts.push(`O=${formatDuration(opts.fadeOut, { what : 'fadeOut' })}`);
        }
        if (opts.crossfade) {
            parts.push('X');
        }
        if (opts.loop) {
            parts.push('L');
        }
        parts.push(...volumeParts(opts));

        return this.apc(`SyncTERM:A;Queue;${parts.join(';')}`, asSequence);
    }

    //  opts: fadeOut
    audioFlush(channel, opts, asSequence = false) {
        [ opts, asSequence ] = optsAndFlag(opts, asSequence);
        assertChannel(channel, 0);

        const parts = [ `C=${channel}` ];
        if (undefined !== opts.fadeOut) {
            parts.push(`O=${formatDuration(opts.fadeOut, { what : 'fadeOut' })}`);
        }

        return this.apc(`SyncTERM:A;Flush;${parts.join(';')}`, asSequence);
    }

    //  opts: volume, volumeLeft, volumeRight (at least one), ramp (duration)
    audioVolume(channel, opts, asSequence = false) {
        [ opts, asSequence ] = optsAndFlag(opts, asSequence);
        assertChannel(channel, 0);

        const parts = [ `C=${channel}`, ...volumeParts(opts) ];
        if (1 === parts.length) {
            throw new RangeError('audioVolume needs volume, volumeLeft and/or volumeRight');
        }
        if (undefined !== opts.ramp) {
            parts.push(`T=${formatDuration(opts.ramp, { what : 'ramp' })}`);
        }

        return this.apc(`SyncTERM:A;Volume;${parts.join(';')}`, asSequence);
    }

    //  Arm a one-shot CSI = 7 ; ch ; 0 n when the channel next goes idle
    audioUpdate(channel, asSequence = false) {
        assertChannel(channel, 0);
        return this.apc(`SyncTERM:A;Update;C=${channel}`, asSequence);
    }
};

function volumeParts(opts) {
    const parts = [];
    if (undefined !== opts.volume) {
        parts.push(`V=${formatVolume(opts.volume, 'volume')}`);
    }
    if (undefined !== opts.volumeLeft) {
        parts.push(`VL=${formatVolume(opts.volumeLeft, 'volumeLeft')}`);
    }
    if (undefined !== opts.volumeRight) {
        parts.push(`VR=${formatVolume(opts.volumeRight, 'volumeRight')}`);
    }
    return parts;
}
