//
//  The back-end for terminals without audio: accepts everything,
//  writes nothing, remembers what it was asked (handy in tests).
//

module.exports = class NullBackend {
    static get name() {
        return 'null';
    }

    constructor(terminal) {
        this.terminal = terminal;
        this.calls = [];
    }

    capabilities() {
        return { files : false, tones : false, channels : 0 };
    }

    physicalChannel(logical) {
        return 'number' === typeof(logical) ? logical : null;
    }

    async ensureAsset(asset) {
        this.calls.push([ 'ensureAsset', asset.name ]);
        return asset;
    }

    async play(logical, asset, opts = {}) {
        this.calls.push([ 'play', logical, asset.name, opts ]);
        return { channel : this.physicalChannel(logical), slot : null };
    }

    async playTone(logical, opts = {}) {
        this.calls.push([ 'playTone', logical, opts ]);
        return { channel : this.physicalChannel(logical), slot : null };
    }

    async stop(channel, opts = {}) {
        this.calls.push([ 'stop', channel, opts ]);
    }

    async volume(channel, opts = {}) {
        this.calls.push([ 'volume', channel, opts ]);
    }

    async formatSupported() {
        return undefined;
    }

    destroy() {
    }
};
