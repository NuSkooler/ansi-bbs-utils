'use strict';

//
//  ReplyParser: a pre-filter for terminal *replies* in an input stream.
//
//  A BBS asks the terminal questions (device attributes, CTerm feature
//  and audio state queries, cache listings) and the answers arrive on
//  the same stream as keystrokes. Key parsers on both sides of this
//  library treat ESC _ as a two byte sequence and everything after it
//  as typed characters, so a SyncTERM cache listing turns into typed
//  filenames and line feeds. This parser sits in front of the key
//  parser: it reassembles replies (across TCP fragments) into events,
//  and passes every other byte through untouched, in order.
//
//  It is NOT a key parser. Keyboard sequences are never interpreted;
//  the most it does with them is deliver a CSI sequence whole rather
//  than split across two chunks.
//
//  Handled:
//  - APC strings:      ESC _ ... ESC \            -> 'apc'
//  - Private CSI:      ESC [ [=?<>] ... c         -> 'device attributes'
//                      ESC [ [=?<>] ... n         -> 'report'
//                      any other final byte       -> passed through intact
//                      (SGR mouse ESC [ < ... M is the common case)
//  - Plain CSI:        ESC [ digits ; ... R       -> 'cpr' when captureCPR,
//                      else passed through intact (default)
//
//  Everything else, including a lone ESC keypress, meta keys (ESC x),
//  SS3 keys (ESC O P) and unknown sequences, is passed through.
//
//  Holding: only ESC, ESC [ and a plain CSI in progress are ever held,
//  and only for |escapeTimeout| (default 50 ms), after which they are
//  passed through as the keystrokes they presumably were. A reply in
//  progress (private CSI or APC) is held for |replyTimeout| (default
//  2 s) and then DROPPED with a 'reply error' rather than leaked as
//  keystrokes. Both are bounded in size as well.
//
//  Events:
//  - 'data' (Buffer)                      bytes for the key parser
//  - 'apc' ({ body })                     body as a latin1 string
//  - 'device attributes' ({ prefix, params, paramString, raw,
//                            client, version, ctermVersion })
//  - 'report' ({ prefix, params, paramString, raw })
//  - 'cpr' ({ row, col, raw })            only when captureCPR
//  - 'reply error' ({ reason, dropped })  reason: overflow | timeout |
//                                         aborted | flushed
//
//  Passthrough 'data' is emitted synchronously during feed() and, for
//  bytes released by a timeout, asynchronously. Order is always the
//  stream order.
//

const EventEmitter = require('events');

const { parseDeviceAttributes } = require('../device_attrs');

const ESC         = 0x1b;
const CSI_INTRO   = 0x5b;   //  [
const APC_INTRO   = 0x5f;   //  _
const ST_FINAL    = 0x5c;   //  backslash, following ESC
const FINAL_DA    = 0x63;   //  c
const FINAL_DSR   = 0x6e;   //  n
const FINAL_CPR   = 0x52;   //  R

const isParamByte       = b => b >= 0x30 && b <= 0x3b;  //  0-9 : ;
const isPrivatePrefix   = b => b >= 0x3c && b <= 0x3f;  //  < = > ?
const isIntermediate    = b => b >= 0x20 && b <= 0x2f;  //  space ! " ... /
const isFinal           = b => b >= 0x40 && b <= 0x7e;

const State = Object.freeze({
    Ground              : 'ground',
    Escape              : 'escape',             //  ESC
    CsiEntry            : 'csi-entry',          //  ESC [
    CsiPlain            : 'csi-plain',          //  ESC [ digits...
    CsiPrivate          : 'csi-private',        //  ESC [ = ...
    Apc                 : 'apc',                //  ESC _ ...
    ApcEscape           : 'apc-escape',         //  ESC _ ... ESC
    DiscardApc          : 'discard-apc',
    DiscardApcEscape    : 'discard-apc-escape',
    DiscardCsi          : 'discard-csi',
});

//  States holding bytes that may still be keystrokes
const AmbiguousStates = new Set([ State.Escape, State.CsiEntry, State.CsiPlain ]);

const DefaultOptions = {
    escapeTimeout   : 50,
    replyTimeout    : 2000,
    maxApcLength    : 256 * 1024,
    maxCsiLength    : 64,
    captureCPR      : false,
};

const toLatin1 = bytes => Buffer.from(bytes).toString('latin1');

module.exports = class ReplyParser extends EventEmitter {
    constructor(options) {
        super();

        this.options = Object.assign({}, DefaultOptions, options);

        this.state      = State.Ground;
        this._held      = [];       //  bytes that may yet be keystrokes
        this._seq       = [];       //  bytes of a reply in progress
        this._prefix    = 0;        //  private CSI prefix byte
        this._out       = [];       //  passthrough bytes gathered during feed()
        this._timer     = null;
        this._destroyed = false;
    }

    static get State() {
        return State;
    }

    //  Anything held back right now?
    get pending() {
        return State.Ground !== this.state;
    }

    feed(chunk) {
        if (this._destroyed) {
            return this;
        }

        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'latin1');
        for (const b of buf) {
            this._byte(b);
        }

        this._emitData();
        this._armTimer();
        return this;
    }

    //  Release whatever is held: keystrokes pass through, a reply in
    //  progress is dropped with a 'reply error'.
    flush() {
        if (this._destroyed) {
            return this;
        }

        this._release('flushed');
        this._emitData();
        this._armTimer();
        return this;
    }

    destroy() {
        this._clearTimer();
        this._destroyed = true;
        this._reset();
        this._out = [];
    }

    //  Private...
    _byte(b) {
        switch (this.state) {
            case State.Ground :
                if (ESC === b) {
                    this.state = State.Escape;
                    this._held = [ ESC ];
                } else {
                    this._out.push(b);
                }
                return;

            case State.Escape :
                if (CSI_INTRO === b) {
                    this.state = State.CsiEntry;
                    this._held.push(b);
                } else if (APC_INTRO === b) {
                    this.state = State.Apc;
                    this._held = [];
                    this._seq = [];
                } else if (ESC === b) {
                    //  ESC ESC: the first was a keystroke, the second may not be
                    this._out.push(ESC);
                } else {
                    //  meta key, SS3, or something we do not know: not ours
                    this._out.push(...this._held, b);
                    this._reset();
                }
                return;

            case State.CsiEntry :
                if (isPrivatePrefix(b)) {
                    this.state = State.CsiPrivate;
                    this._prefix = b;
                    this._seq = [ ESC, CSI_INTRO, b ];
                    this._held = [];
                } else if (isParamByte(b)) {
                    //  a keyboard sequence or a CPR: hold it together
                    this.state = State.CsiPlain;
                    this._held.push(b);
                } else if (ESC === b) {
                    this._out.push(...this._held);
                    this._held = [ ESC ];
                    this.state = State.Escape;
                } else {
                    //  ESC [ A and friends: complete, not ours
                    this._out.push(...this._held, b);
                    this._reset();
                }
                return;

            case State.CsiPlain :
                if (isParamByte(b)) {
                    this._held.push(b);
                    if (this._held.length > this.options.maxCsiLength) {
                        //  too long to be a sequence; whatever it is, it is theirs
                        this._out.push(...this._held);
                        this._reset();
                    }
                } else if (isFinal(b)) {
                    if (FINAL_CPR === b && this.options.captureCPR) {
                        const params = this._params(this._held.slice(2));
                        if (2 === params.length) {
                            const raw = toLatin1(this._held.concat(b));
                            this._reset();
                            this._emitData();
                            this.emit('cpr', { row : params[0], col : params[1], raw });
                            return;
                        }
                    }
                    this._out.push(...this._held, b);
                    this._reset();
                } else if (ESC === b) {
                    this._out.push(...this._held);
                    this._held = [ ESC ];
                    this.state = State.Escape;
                } else {
                    this._out.push(...this._held, b);
                    this._reset();
                }
                return;

            case State.CsiPrivate :
                if (isParamByte(b) || isIntermediate(b)) {
                    this._seq.push(b);
                    if (this._seq.length > this.options.maxCsiLength) {
                        this._error('overflow');
                        this.state = State.DiscardCsi;
                    }
                } else if (isFinal(b)) {
                    this._seq.push(b);
                    this._finishCsi(b);
                } else if (ESC === b) {
                    this._error('aborted');
                    this.state = State.Escape;
                    this._held = [ ESC ];
                } else {
                    //  a control character inside a reply: it was not one
                    this._error('aborted');
                    this._out.push(b);
                    this._reset();
                }
                return;

            case State.Apc :
                if (ESC === b) {
                    this.state = State.ApcEscape;
                } else {
                    this._seq.push(b);
                    if (this._seq.length > this.options.maxApcLength) {
                        this._error('overflow');
                        this.state = State.DiscardApc;
                    }
                }
                return;

            case State.ApcEscape :
                if (ST_FINAL === b) {
                    const body = toLatin1(this._seq);
                    this._reset();
                    this._emitData();
                    this.emit('apc', { body });
                } else {
                    //  a new sequence began before the string terminator
                    this._error('aborted');
                    this.state = State.Escape;
                    this._held = [ ESC ];
                    this._byte(b);
                }
                return;

            case State.DiscardApc :
                if (ESC === b) {
                    this.state = State.DiscardApcEscape;
                }
                return;

            case State.DiscardApcEscape :
                if (ST_FINAL === b) {
                    this._reset();
                } else {
                    this.state = State.Escape;
                    this._held = [ ESC ];
                    this._byte(b);
                }
                return;

            case State.DiscardCsi :
                if (isFinal(b)) {
                    this._reset();
                } else if (ESC === b) {
                    this.state = State.Escape;
                    this._held = [ ESC ];
                }
                return;

            default :
                this._reset();
                return;
        }
    }

    _finishCsi(final) {
        const raw = toLatin1(this._seq);
        const prefix = String.fromCharCode(this._prefix);
        const paramBytes = this._seq.slice(3).filter(isParamByte);
        const paramString = toLatin1(paramBytes);
        const params = this._params(paramBytes);

        this._reset();

        if (FINAL_DA === final) {
            this._emitData();
            this.emit('device attributes', Object.assign(
                { prefix, params, paramString, raw },
                parseDeviceAttributes(paramString)
            ));
        } else if (FINAL_DSR === final) {
            this._emitData();
            this.emit('report', { prefix, params, paramString, raw });
        } else {
            //  mouse reports, mode reports, ...: intact, but not ours
            this._out.push(...Buffer.from(raw, 'latin1'));
        }
    }

    _params(paramBytes) {
        const s = toLatin1(paramBytes);
        if (!s.length) {
            return [];
        }
        return s.split(';').map(p => parseInt(p, 10) || 0);
    }

    _error(reason) {
        const dropped = Buffer.from(this._seq);
        this._seq = [];
        this._held = [];
        this._emitData();
        this.emit('reply error', { reason, dropped });
    }

    //  Timeout/flush: keystrokes go through, replies are dropped
    _release(reason) {
        if (AmbiguousStates.has(this.state)) {
            this._out.push(...this._held);
            this._reset();
        } else if (State.Ground !== this.state) {
            this._error(reason);
            this._reset();
        }
    }

    _reset() {
        this.state = State.Ground;
        this._held = [];
        this._seq = [];
        this._prefix = 0;
    }

    _emitData() {
        if (this._out.length) {
            const buf = Buffer.from(this._out);
            this._out = [];
            this.emit('data', buf);
        }
    }

    _armTimer() {
        this._clearTimer();

        if (State.Ground === this.state) {
            return;
        }

        const ms = AmbiguousStates.has(this.state) ?
            this.options.escapeTimeout :
            this.options.replyTimeout;

        if (!ms) {
            return;
        }

        this._timer = setTimeout(() => {
            this._timer = null;
            this._release('timeout');
            this._emitData();
        }, ms);

        if (this._timer && 'function' === typeof(this._timer.unref)) {
            this._timer.unref();
        }
    }

    _clearTimer() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
};
