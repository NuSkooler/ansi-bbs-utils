//
//  FakeCTerm: a scripted CTerm/SyncTERM-style terminal for tests.
//
//  It plays the terminal's side of the wire: give it to a Terminal as
//  its socket, feed its replies back into the Terminal, and it will
//  answer device attribute and feature queries, keep a file cache with
//  MD5s, decode "files" into slots, "play" queued buffers on a timer
//  and report idle channels the way the real thing does. Everything
//  it saw is in |log| for assertions.
//
//      const { fake, term } = FakeCTerm.connect({ sndfile : true });
//      await term.probeAudio();
//      await term.audio.play('music', { name : 'lobby', bytes }, { loop : true });
//      assert.equal(fake.channels.get(2).running, true);
//
//  Shipped in the package (not just in test/) so consumers can drive
//  their own integration tests with it.
//

const EventEmitter = require('events');
const crypto = require('crypto');

const ReplyParser = require('../input/reply_parser');
const { revisionAtLeast, Revisions } = require('../audio/formats');

const ESC = String.fromCharCode(0x1b);
const CSI = `${ESC}[`;
const APC = `${ESC}_`;
const ST = `${ESC}\\`;

const DA_QUERY = Buffer.from([ 0x1b, 0x5b, 0x63 ]);    //  ESC [ c

const ClientDA = {
    cterm       : '67;84;101;114;109',
    icy_term    : '73;99;121;84;101;114;109',
};

const DefaultOptions = {
    client          : 'cterm',
    ctermVersion    : '1.332',
    audio           : true,         //  false: a terminal without the audio APC (ignores Q and A)
    sndfile         : true,
    formats         : {},           //  'major;subtype' -> true
    playbackMs      : 100,          //  how long a queued buffer "plays"
    fragmentReplies : true,         //  send the listing in pieces like term.c
    //  'recursive': every entry, names relative to the root (IcyTerm)
    //  'flat': glob(3) at one level, basenames only, subdirectories as
    //          blank lines (SyncTERM)
    listing         : 'recursive',
    cache           : null,         //  Map name -> { bytes, md5 }; share it to model a persistent cache
};

const md5 = bytes => crypto.createHash('md5').update(bytes).digest('hex');

class FakeCTerm extends EventEmitter {
    constructor(options = {}) {
        super();

        this.options = Object.assign({}, DefaultOptions, options);
        this.cache = this.options.cache || new Map();
        this.slots = new Array(256).fill(null);
        this.channels = new Map();
        this.log = [];
        this.replies = [];
        this.waitCalls = 0;
        this.written = [];

        //  The "socket" a Terminal writes to
        this.socket = {
            writable    : true,
            write       : (data, cb) => {
                this.written.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1'));
                this._ingest(data);
                if (cb) {
                    process.nextTick(cb, null);
                }
                return true;
            },
            cork        : () => {},
            uncork      : () => {},
        };

        //  The BBS's output stream, tokenized with the same parser the
        //  BBS uses for input: APCs, private CSI, and the rest as data.
        //  Uploads are legitimately huge; the BBS-side default cap is
        //  for replies, not for what a terminal receives.
        this._parser = new ReplyParser({ escapeTimeout : 0, replyTimeout : 0, maxApcLength : 64 * 1024 * 1024 });
        this._parser.on('apc', ({ body }) => this._apc(body));
        this._parser.on('report', payload => this._csiQuery(payload));
        this._parser.on('device attributes', payload => {
            //  CSI < c: CTerm's own DA
            if ('<' === payload.prefix) {
                this._answerDA();
            } else {
                this.log.push({ type : 'csi', raw : payload.raw });
            }
        });
        this._parser.on('data', buf => this._data(buf));

        for (let ch = 0; ch <= 15; ++ch) {
            this.channels.set(ch, { queue : [], running : false, armed : false, volume : null, timer : null });
        }
    }

    //  A Terminal wired both ways to a fresh fake
    static connect(options = {}) {
        const Terminal = require('../terminal');
        const fake = new FakeCTerm(options);
        const term = new Terminal(fake.socket, { input : options.input });
        term.setTerminalType(options.ttype || 'syncterm');
        fake.on('reply', bytes => term.feed(bytes));
        return { fake, term };
    }

    //  Let queued replies and their feeds happen
    settle() {
        return new Promise(resolve => setImmediate(() => setImmediate(resolve)));
    }

    //  Bytes the BBS wrote, as one latin1 string
    output() {
        return Buffer.concat(this.written).toString('latin1');
    }

    //  APC bodies seen, in order
    get apcs() {
        return this.log.filter(e => 'apc' === e.type).map(e => e.body);
    }

    destroy() {
        for (const channel of this.channels.values()) {
            if (channel.timer) {
                clearTimeout(channel.timer);
                channel.timer = null;
            }
        }
        this._parser.destroy();
        this.removeAllListeners();
    }

    //  Private...
    _ingest(data) {
        this._parser.feed(data);
    }

    _data(buf) {
        //  plain DA query: ESC [ c
        let from = 0;
        let at;
        while (-1 !== (at = buf.indexOf(DA_QUERY, from))) {
            this._answerDA();
            from = at + DA_QUERY.length;
        }
        this.log.push({ type : 'data', text : buf.toString('latin1') });
    }

    _reply(text, pieces = [ text ]) {
        this.replies.push(text);
        for (const piece of pieces) {
            setImmediate(() => this.emit('reply', Buffer.from(piece, 'latin1')));
        }
    }

    _answerDA() {
        this.log.push({ type : 'da' });
        const prefix = ClientDA[this.options.client];
        if (!prefix) {
            return;     //  a client that does not answer
        }
        const version = this.options.ctermVersion ? `;${this.options.ctermVersion.split('.').join(';')}` : '';
        this._reply(`${CSI}=${prefix}${version}c`);
    }

    _csiQuery(payload) {
        this.log.push({ type : 'csi', raw : payload.raw });

        if ('=' !== payload.prefix || 7 !== payload.params[0]) {
            return;
        }

        if (1 === payload.params.length) {
            //  all running channels
            let s = `${CSI}=7`;
            for (const [ ch, channel ] of this.channels) {
                if (channel.running) {
                    s += `;${ch};1`;
                }
            }
            this._reply(`${s}n`);
        } else {
            const ch = payload.params[1];
            const channel = this.channels.get(ch);
            this._reply(`${CSI}=7;${ch};${channel && channel.running ? 1 : 0}n`);
        }
    }

    _apc(body) {
        this.log.push({ type : 'apc', body });

        if (!body.startsWith('SyncTERM:')) {
            return;
        }

        const rest = body.slice('SyncTERM:'.length);
        const group = rest[0];
        const args = rest.slice(2);     //  past 'X;'

        switch (group) {
            case 'Q' : return this.options.audio ? this._query(args) : undefined;
            case 'C' : return this._cache(args);
            case 'A' : return this.options.audio ? this._audio(args) : undefined;
            default  : return;
        }
    }

    _query(args) {
        const [ feature, pm, ps ] = args.split(';');

        if ('libsndfile' === feature) {
            return this._reply(`${CSI}=7;100;${this.options.sndfile ? 1 : 0}n`);
        }

        if ('libsndfileFormat' === feature) {
            if (!revisionAtLeast(this.options.ctermVersion || '0', Revisions.formatQuery)) {
                return;     //  an older CTerm does not know this query
            }
            const supported = this.options.sndfile && true === this.options.formats[`${parseInt(pm, 10)};${parseInt(ps, 10)}`];
            return this._reply(`${CSI}=7;101;${parseInt(pm, 10)};${parseInt(ps, 10)};${supported ? 1 : 0}n`);
        }
    }

    _cache(args) {
        if (args.startsWith('S;')) {
            const at = args.indexOf(';', 2);
            if (-1 === at) {
                return;
            }
            const name = args.slice(2, at);
            const bytes = Buffer.from(args.slice(at + 1), 'base64');
            this.cache.set(name, { bytes, md5 : md5(bytes) });
            return;
        }

        if ('L' === args[0]) {
            const glob = args.startsWith('L;') ? args.slice(2) : '*';
            const header = `${APC}SyncTERM:C;L\n`;
            const lines = 'flat' === this.options.listing ? this._flatListing(glob) : this._recursiveListing(glob);
            const text = `${header}${lines.join('')}${ST}`;

            return this._reply(text, this.options.fragmentReplies ? [ header, ...lines, ST ] : [ text ]);
        }
    }

    //  IcyTerm: the pattern matches names relative to the root
    _recursiveListing(glob) {
        const re = globToRegExp(glob);
        return [ ...this.cache.entries() ]
            .filter(([ name ]) => re.test(name))
            .sort(([ a ], [ b ]) => a.localeCompare(b))
            .map(([ name, entry ]) => `${name}\t${entry.md5}\n`);
    }

    //  SyncTERM: glob(3) of <cache>/<pattern>; the directory part is
    //  literal, the last segment matches basenames at that level,
    //  entries print as basenames, and a matched directory prints as
    //  a blank name with no md5 (getfname() of a path ending in '/').
    _flatListing(glob) {
        const slash = glob.lastIndexOf('/');
        const dir = -1 === slash ? '' : glob.slice(0, slash);
        const re = globToRegExp(-1 === slash ? glob : glob.slice(slash + 1));

        const files = [];
        const dirs = new Set();
        for (const [ name, entry ] of this.cache) {
            const nSlash = name.lastIndexOf('/');
            const nDir = -1 === nSlash ? '' : name.slice(0, nSlash);
            const base = -1 === nSlash ? name : name.slice(nSlash + 1);

            if (nDir === dir) {
                if (re.test(base)) {
                    files.push(`${base}\t${entry.md5}\n`);
                }
            } else if (!dir || nDir.startsWith(`${dir}/`)) {
                const first = (dir ? nDir.slice(dir.length + 1) : nDir).split('/')[0];
                if (re.test(first)) {
                    dirs.add(first);
                }
            }
        }
        return [ ...files.sort(), ...[ ...dirs ].map(() => '\t\n') ];
    }

    _audio(args) {
        const at = args.indexOf(';');
        const verb = -1 === at ? args : args.slice(0, at);
        const params = parseParams(-1 === at ? '' : args.slice(at + 1));

        switch (verb) {
            case 'Load' : {
                const name = params.rest;
                if (!this.options.sndfile || !this.cache.has(name)) {
                    return;     //  silently ignored, as specified
                }
                this.slots[params.S] = { source : name, length : this.cache.get(name).bytes.length };
                return;
            }
            case 'LoadBlob' : {
                if (!this.options.sndfile) {
                    return;
                }
                this.slots[params.S] = { source : 'blob', length : Buffer.from(params.rest || '', 'base64').length };
                return;
            }
            case 'Synth' :
                this.slots[params.S] = { source : 'synth', shape : params.W, hz : params.F, duration : params.T };
                return;
            case 'Copy' :
                this.slots[params.D] = this.slots[params.S] ? Object.assign({}, this.slots[params.S]) : null;
                return;
            case 'Queue' : {
                const ch = params.C;
                const channel = this.channels.get(ch);
                if (!channel || ch < 2 || !this.slots[params.S]) {
                    return;     //  rejected: terminal-owned channel or empty slot
                }
                const buf = Object.assign({ loop : params.L, crossfade : params.X, fadeIn : params.I, fadeOut : params.O,
                    volume : params.V, volumeLeft : params.VL, volumeRight : params.VR }, this.slots[params.S]);
                this.slots[params.S] = null;
                //  a new Queue ends a loop
                if (channel.running && channel.queue.length && channel.queue[0].loop) {
                    channel.queue[0].loop = false;
                }
                channel.queue.push(buf);
                this._pump(ch);
                return;
            }
            case 'Flush' : {
                const channel = this.channels.get(params.C);
                if (!channel) {
                    return;
                }
                channel.queue = [];
                if (channel.timer) {
                    clearTimeout(channel.timer);
                    channel.timer = null;
                }
                if (channel.running) {
                    channel.running = false;
                    this._idle(params.C);
                }
                return;
            }
            case 'Volume' : {
                const channel = this.channels.get(params.C);
                if (channel) {
                    channel.volume = { V : params.V, VL : params.VL, VR : params.VR, T : params.T };
                }
                return;
            }
            case 'Update' : {
                const channel = this.channels.get(params.C);
                if (channel) {
                    channel.armed = true;
                }
                return;
            }
            case 'Wait' :
                this.waitCalls++;
                return;
            default :
                return;
        }
    }

    //  Start the head buffer if the channel is not already playing
    _pump(ch) {
        const channel = this.channels.get(ch);
        if (channel.running || !channel.queue.length) {
            return;
        }
        channel.running = true;
        this._playHead(ch);
    }

    _playHead(ch) {
        const channel = this.channels.get(ch);
        channel.timer = setTimeout(() => {
            channel.timer = null;
            const head = channel.queue[0];
            if (head && head.loop) {
                //  wraps forever until Flush or another Queue
                return this._playHead(ch);
            }
            channel.queue.shift();
            if (channel.queue.length) {
                return this._playHead(ch);
            }
            channel.running = false;
            this._idle(ch);
        }, this.options.playbackMs);
        if ('function' === typeof(channel.timer.unref)) {
            channel.timer.unref();
        }
    }

    //  running -> stopped: report once if armed
    _idle(ch) {
        const channel = this.channels.get(ch);
        if (channel.armed) {
            channel.armed = false;
            this._reply(`${CSI}=7;${ch};0n`);
        }
    }
}

function globToRegExp(glob) {
    return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

//  'C=3;S=0;I=500;X;L;V=80;name' -> { C : 3, S : 0, I : '500', X : true, L : true, V : '80', rest : 'name' }
function parseParams(s) {
    const out = { X : false, L : false, rest : null };
    if (!s.length) {
        return out;
    }
    for (const token of s.split(';')) {
        const eq = token.indexOf('=');
        if (-1 === eq) {
            if ('X' === token || 'L' === token) {
                out[token] = true;
            } else {
                //  a bare value (Load's filename): everything from here on
                out.rest = null === out.rest ? token : `${out.rest};${token}`;
            }
            continue;
        }
        const key = token.slice(0, eq);
        const value = token.slice(eq + 1);
        out[key] = [ 'S', 'D', 'C' ].includes(key) ? parseInt(value, 10) : value;
    }
    return out;
}

module.exports = FakeCTerm;
