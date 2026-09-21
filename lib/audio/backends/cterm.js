//
//  The CTerm / SyncTERM audio back-end.
//
//  Hides the wire model (patch slots, physical channels, the client
//  side file cache) behind the AudioSession contract:
//
//  - Assets are uploaded once per BBS, not per session: the client
//    keeps its cache across connections and lists it with MD5s, so
//    the first ensureAsset() asks for the listing and only stores
//    what is missing or changed.
//  - Every play is Load (decode from cache into a fresh slot) then
//    Queue (which empties the slot) then Update (so the terminal
//    reports when the channel idles). Slots rotate; nothing is kept.
//  - Logical channels: 'music' is one reserved physical channel,
//    'sfx' rotates over the rest, a number 2..15 is used as-is.
//  - Writes are sequential and wait for the socket: a multi-megabyte
//    upload must not be overtaken by the Queue that plays it.
//  - Wait is never sent.
//

const { AsSequence } = require('../../common');
const { awaitReply } = require('../replies');
const { queryFormatSupport } = require('../probe');
const { resolveFormat, revisionAtLeast, Revisions } = require('../formats');

const ListingPrefix = 'SyncTERM:C;L\n';

const DefaultOptions = {
    musicChannel    : 2,
    sfxChannels     : [ 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 ],
    listingTimeout  : 2000,
    formatTimeout   : 2000,
};

module.exports = class CTermBackend {
    static get name() {
        return 'cterm';
    }

    constructor(terminal, options = {}) {
        this.terminal = terminal;
        this.options = Object.assign({}, DefaultOptions, options);

        this._nextSlot = 0;
        this._nextSfx = 0;
        this._stored = new Map();       //  name -> md5 known to be in the client cache
        this._synced = false;
        this._formats = new Map();      //  'major;subtype' -> true | false | undefined
    }

    get files() {
        return this.terminal.hasCapability('cterm-audio-files');
    }

    capabilities() {
        const rev = this.terminal.ctermVersion;
        return {
            files           : this.files,
            tones           : true,
            channels        : 1 + this.options.sfxChannels.length,
            musicChannel    : this.options.musicChannel,
            sfxChannels     : this.options.sfxChannels.slice(),
            //  unknown revision (IcyTerm): assume the newer verbs exist
            blobs           : !rev || revisionAtLeast(rev, Revisions.blobVerbs),
        };
    }

    physicalChannel(logical) {
        if ('music' === logical) {
            return this.options.musicChannel;
        }
        if ('sfx' === logical) {
            const channels = this.options.sfxChannels;
            const ch = channels[this._nextSfx];
            this._nextSfx = (this._nextSfx + 1) % channels.length;
            return ch;
        }
        if (Number.isInteger(logical) && logical >= 2 && logical <= 15) {
            return logical;
        }
        throw new RangeError(`channel must be 'music', 'sfx' or an integer 2..15; got ${JSON.stringify(logical)}`);
    }

    async ensureAsset(asset) {
        if (!this.files) {
            throw new Error('this terminal has no audio file decoder (libsndfile); only tones are available');
        }

        await this._syncCache();

        const md5 = await asset.md5();
        if (this._stored.get(asset.name) === md5) {
            return asset;
        }

        const cterm = this.terminal.cterm;
        await this.terminal.sendSequence(cterm.storeFile(asset.name, await asset.bytes(), AsSequence));
        this._stored.set(asset.name, md5);
        return asset;
    }

    //  Ask the client what it already has. Silence (no input wiring,
    //  a terminal without the listing) means "assume nothing".
    async _syncCache() {
        if (this._synced) {
            return;
        }
        this._synced = true;

        const listing = await awaitReply(
            this.terminal,
            'apc',
            ({ body }) => body.startsWith(ListingPrefix) ? body : undefined,
            this.options.listingTimeout,
            () => this.terminal.sendSequence(this.terminal.cterm.listFiles(AsSequence))
        );

        if (listing) {
            for (const line of listing.slice(ListingPrefix.length).split('\n')) {
                const [ name, md5 ] = line.split('\t');
                if (name && md5) {
                    this._stored.set(name, md5.trim().toLowerCase());
                }
            }
        }
    }

    //  Forget what we think the client has; the next ensureAsset() asks again.
    invalidateCache() {
        this._stored.clear();
        this._synced = false;
    }

    async play(logical, asset, opts = {}) {
        const channel = this.physicalChannel(logical);
        const slot = this._allocSlot();
        const cterm = this.terminal.cterm;

        await this.terminal.sendSequence(
            cterm.audioLoad(slot, asset.name, AsSequence) +
            cterm.audioQueue(channel, slot, queueOptions(opts), AsSequence) +
            cterm.audioUpdate(channel, AsSequence)
        );

        return { channel, slot };
    }

    //  A synthesized tone: works without a decoder.
    //  opts: shape (default SIN), hz, duration, plus the Queue options
    async playTone(logical, opts = {}) {
        const channel = this.physicalChannel(logical);
        const slot = this._allocSlot();
        const cterm = this.terminal.cterm;

        await this.terminal.sendSequence(
            cterm.audioSynth(slot, opts.shape || 'SIN', opts.hz, opts.duration, AsSequence) +
            cterm.audioQueue(channel, slot, queueOptions(opts), AsSequence) +
            cterm.audioUpdate(channel, AsSequence)
        );

        return { channel, slot };
    }

    async stop(channel, { fade } = {}) {
        const opts = undefined === fade ? {} : { fadeOut : fade };
        await this.terminal.sendSequence(this.terminal.cterm.audioFlush(channel, opts, AsSequence));
    }

    //  value: 0..100 or 'NdB'; opts: ramp, pan (-100..100)
    async volume(channel, value, { ramp, pan } = {}) {
        const opts = Object.assign(volumeOptions({ volume : value, pan }), undefined === ramp ? {} : { ramp });
        await this.terminal.sendSequence(this.terminal.cterm.audioVolume(channel, opts, AsSequence));
    }

    async formatSupported(container, codec) {
        const [ major, subtype ] = resolveFormat(container, codec);
        const key = `${major};${subtype}`;
        if (!this._formats.has(key)) {
            this._formats.set(key, await queryFormatSupport(this.terminal, major, subtype, { timeout : this.options.formatTimeout }));
        }
        return this._formats.get(key);
    }

    destroy() {
    }

    _allocSlot() {
        const slot = this._nextSlot;
        this._nextSlot = (slot + 1) & 0xff;
        return slot;
    }
};

//
//  Session-level play options -> Queue parameters.
//  pan: -100 (left) .. 0 .. +100 (right), applied as per-side volumes.
//
function queueOptions(opts) {
    const out = volumeOptions(opts);
    for (const key of [ 'fadeIn', 'fadeOut', 'crossfade', 'loop' ]) {
        if (undefined !== opts[key]) {
            out[key] = opts[key];
        }
    }
    return out;
}

function volumeOptions({ volume, pan, volumeLeft, volumeRight }) {
    const out = {};

    if (undefined !== pan) {
        if (!Number.isFinite(pan) || pan < -100 || pan > 100) {
            throw new RangeError(`pan must be -100..100, got ${pan}`);
        }
        const vol = undefined === volume ? 100 : volume;
        if ('number' !== typeof(vol)) {
            throw new RangeError('pan needs a numeric 0..100 volume');
        }
        out.volumeLeft = Math.round(pan > 0 ? vol * (100 - pan) / 100 : vol);
        out.volumeRight = Math.round(pan < 0 ? vol * (100 + pan) / 100 : vol);
    } else if (undefined !== volume) {
        out.volume = volume;
    }

    if (undefined !== volumeLeft) {
        out.volumeLeft = volumeLeft;
    }
    if (undefined !== volumeRight) {
        out.volumeRight = volumeRight;
    }

    return out;
}
