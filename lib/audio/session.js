//
//  AudioSession: the facade a BBS or door talks to.
//
//      const audio = terminal.audio;          //  after terminal.probeAudio()
//      const music = await audio.play('music', { name : 'music/lobby', path : '/srv/audio/lobby.ogg' }, { loop : true });
//      await music.volume(50, { ramp : 1000 });
//      await audio.play('sfx', 'sfx/hit');    //  a registered asset, by name
//      await music.stop({ fade : 1000 });
//      audio.on('idle', ({ channel, handle }) => {});
//
//  Assets are registered once (bytes or a path) and uploaded by the
//  back-end when first needed. Operations are serialized: one write
//  finishes before the next starts. The back-end decides what the
//  wire looks like; the session never mentions slots.
//

const EventEmitter = require('events');
const fs = require('fs');
const crypto = require('crypto');

const CTerm = require('../handlers/cterm');
const CTermBackend = require('./backends/cterm');
const NullBackend = require('./backends/null');
const { isCTermReport } = require('./replies');

const Backends = {
    [CTermBackend.name]     : CTermBackend,
    [NullBackend.name]      : NullBackend,
};

class Asset {
    //  { name, bytes } or { name, path }
    constructor({ name, bytes, path }) {
        CTerm.assertCacheName(name);

        this.name = name;
        this.path = path || null;
        this._bytes = undefined === bytes || null === bytes ? null : toBuffer(bytes);
        this._md5 = null;

        if (!this._bytes && !this.path) {
            throw new TypeError(`asset ${JSON.stringify(name)} needs bytes or a path`);
        }
    }

    async bytes() {
        if (!this._bytes) {
            this._bytes = await fs.promises.readFile(this.path);
        }
        return this._bytes;
    }

    async md5() {
        if (!this._md5) {
            this._md5 = crypto.createHash('md5').update(await this.bytes()).digest('hex');
        }
        return this._md5;
    }
}

class Handle {
    constructor(session, logical, channel, asset) {
        this.session = session;
        this.logical = logical;
        this.channel = channel;     //  physical
        this.asset = asset || null;
    }

    get name() {
        return this.asset ? this.asset.name : null;
    }

    volume(value, opts) {
        return this.session.volume(this, value, opts);
    }

    stop(opts) {
        return this.session.stop(this, opts);
    }
}

class AudioSession extends EventEmitter {
    constructor(terminal, options = {}) {
        super();

        const { backend = NullBackend.name } = options;
        const Backend = Backends[backend];
        if (!Backend) {
            throw new RangeError(`unknown audio backend ${JSON.stringify(backend)}; have ${Object.keys(Backends).join(', ')}`);
        }

        this.terminal = terminal;
        this.backend = new Backend(terminal, options);
        this.assets = new Map();
        this.handles = new Map();   //  physical channel -> Handle
        this._chain = Promise.resolve();

        //  CSI = 7 ; ch ; 0 n : a channel we armed with Update went idle
        this._onReport = payload => {
            if (isCTermReport(payload) && 3 === payload.params.length && 0 === payload.params[2]) {
                const channel = payload.params[1];
                const handle = this.handles.get(channel) || null;
                this.handles.delete(channel);
                this.emit('idle', { channel, handle, name : handle ? handle.name : null });
            }
        };
        terminal.on('report', this._onReport);
    }

    static get Backends() {
        return Backends;
    }

    static get Asset() {
        return Asset;
    }

    get backendName() {
        return this.backend.constructor.name;
    }

    capabilities() {
        return Object.assign({ backend : this.backendName }, this.backend.capabilities());
    }

    //  Register without uploading. Returns the Asset.
    asset(descriptor) {
        if (descriptor instanceof Asset) {
            this.assets.set(descriptor.name, descriptor);
            return descriptor;
        }

        if ('string' === typeof(descriptor)) {
            const known = this.assets.get(descriptor);
            if (!known) {
                throw new RangeError(`unknown asset ${JSON.stringify(descriptor)}; register it with asset({ name, bytes | path }) first`);
            }
            return known;
        }

        const known = this.assets.get(descriptor.name);
        if (known && known.path === (descriptor.path || null) && (!descriptor.bytes || known._bytes === descriptor.bytes)) {
            return known;
        }

        const asset = new Asset(descriptor);
        this.assets.set(asset.name, asset);
        return asset;
    }

    //  Make sure the terminal has it (upload once). Returns the Asset.
    ensureAsset(descriptor) {
        const asset = this.asset(descriptor);
        return this._serial(() => this.backend.ensureAsset(asset));
    }

    //  opts: loop, fadeIn, fadeOut, crossfade, volume, pan, volumeLeft, volumeRight
    async play(logical, descriptor, opts = {}) {
        const asset = await this.ensureAsset(descriptor);
        const { channel } = await this._serial(() => this.backend.play(logical, asset, opts));
        return this._track(new Handle(this, logical, channel, asset));
    }

    //  opts: shape, hz, duration, plus the play options
    async playTone(logical, opts = {}) {
        const { channel } = await this._serial(() => this.backend.playTone(logical, opts));
        return this._track(new Handle(this, logical, channel, null));
    }

    //  target: a Handle, 'music', or a physical channel number
    stop(target, opts = {}) {
        const channel = this._channelOf(target);
        this.handles.delete(channel);
        return this._serial(() => this.backend.stop(channel, opts));
    }

    //  value: 0..100 or 'NdB'; opts: ramp, pan
    volume(target, value, opts = {}) {
        const channel = this._channelOf(target);
        return this._serial(() => this.backend.volume(channel, value, opts));
    }

    //  -> true | false | undefined (cannot ask)
    formatSupported(container, codec) {
        return this._serial(() => this.backend.formatSupported(container, codec));
    }

    destroy() {
        this.terminal.removeListener('report', this._onReport);
        this.backend.destroy();
        this.handles.clear();
        this.removeAllListeners();
    }

    //  Private...
    _track(handle) {
        if (null !== handle.channel) {
            this.handles.set(handle.channel, handle);
        }
        return handle;
    }

    _channelOf(target) {
        if (target instanceof Handle) {
            return target.channel;
        }
        if ('sfx' === target) {
            throw new RangeError("'sfx' rotates per play; stop or adjust it through the Handle play() returned");
        }
        return this.backend.physicalChannel(target);
    }

    //  One operation at a time, in call order; a failure does not
    //  poison the chain for the next caller.
    _serial(fn) {
        const p = this._chain.then(fn);
        this._chain = p.then(() => {}, () => {});
        return p;
    }
}

function toBuffer(bytes) {
    if (Buffer.isBuffer(bytes)) {
        return bytes;
    }
    if (bytes instanceof Uint8Array) {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    if ('string' === typeof(bytes)) {
        return Buffer.from(bytes, 'latin1');
    }
    throw new TypeError('asset bytes must be a Buffer, Uint8Array or binary string');
}

module.exports = {
    AudioSession,
    Asset,
    Handle,
    Backends,
};
