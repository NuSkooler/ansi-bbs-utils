const Capabilities = require('./capabilities');

const {
    normalizedTermType,
} = require('./ttype_utils');

const {
    CSI,
    AsSequence,
    wantAsSequence,
} = require('./common')

const ANSI_BBS = require('./handlers/ansi_bbs');
const VTX = require('./handlers/vtx');
const ECMA48 = require('./handlers/ecma_048');
const OSCHyperlink = require('./handlers/osc_hyperlink');

const ColorXTerm24Bit = require('./color_xterm_24bit');
const ColorXTerm256 = require('./color_xterm_256');
const ColorTerm16 = require('./color_16')

const iconv = require('iconv-lite');
const assert = require('assert');

//
//  A class representing a remote terminal we
//  can interact with via ANSI sequences.
//
//  General ANSI resource:
//  - https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797
//  - console_codes(4) @ https://man7.org/linux/man-pages/man4/console_codes.4.html
//
module.exports = class Terminal {
    constructor(socket) {
        this.socket = socket;

        this.ttype              = 'unknown';
        this.termClient         = 'unknown';
        this.height             = 0;
        this.width              = 0;
        this.defaultTermType    = 'ansi-bbs';
        this.termTypeCaps       = Capabilities[this.defaultTermType];

        //  We want a Set...
        this.termTypeCaps.capabilities = new Set(this.termTypeCaps.capabilities);

        this.encoding = 'cp437';
        assert(iconv.encodingExists(this.encoding));

        //  member names for these should match cap handlers
        this.ansi               = new ANSI_BBS(this);
        this.vtx                = new VTX(this);
        this.ecma               = new ECMA48(this);
        this['osc-hyperlink']   = new OSCHyperlink();

        this._addStandardMethods();

        /*
            :TODO:
            - Stuff from here: https://github.com/NuSkooler/skull-crash/blob/master/bundles/sc-telnet-networking/lib/term_util.js
        */
    }

    //  Terminal stuff...
    getTerminalType() {
        return this.ttype;
    }

    setTerminalType(ttype) {
        ttype = ttype.trim().toLowerCase();
        if (!ttype) {
            return false;
        }

        this.ttype = ttype;
        this._updateCapabilities();
        return true;
    }

    getTerminalClient() {
        return this.termClient;
    }

    setTermClient(termClient) {
        this.termClient = termClient.trim().toLowerCase();
    }

    getHeight() {
        return this.height;
    }

    setHeight(height) {
        height = parseInt(height);
        if (isNaN(height)) {
            return false;
        }

        this.height = height;
        return true;
    }

    getWidth() {
        return this.width;
    }

    setWidth(width) {
        width = parseInt(width);
        if (isNaN(width)) {
            return false;
        }

        this.width = width;
        return true;
    }

    //  Output encoding...
    getEncoding() {
        return this.encoding;
    }

    setEncoding(encoding) {
        if (iconv.encodingExists(encoding)) {
            this.encoding = encoding;
            return true;
        }

        return false;
    }

    //  Socket stuff...
    setSocket(socket) {
        this.socket = socket;
    }

    cork() {
        if (this.socket) {
            this.socket.cork();
        }
        return this;    //  chaining
    }

    uncork() {
        if (this.socket) {
            this.socket.uncork();
        }
        return this;    //  chaining
    }

    write(s, cb) {
        return this.rawWrite(this.encode(s, true), cb);
    }

    rawWrite(data, cb) {
        if (this.socket && this.socket.writable) {
            this.socket.write(data, cb);
        }
        return this;    //  chaining
    }

    encode(s, convertLineFeeds=true) {
        if ('string' !== typeof(s)) {
            return s;
        }

        if (convertLineFeeds) {
            s = s.replace(/\n/g, '\r\n');
        }

        return iconv.encode(s, this.encoding);
    }

    //  Capabilities
    getCapabilities() {
        return this.termTypeCaps.capabilities;
    }

    hasCapability(cap) {
        return this.getCapabilities().has(cap);
    }

    addCapabilities(...caps) {
        caps.forEach(cap => this.getCapabilities().add(cap));
    }

    removeCapability(cap) {
        return this.getCapabilities().delete(cap);
    }

    //
    //  Foreground/Background color methods:
    //
    //  Accept args in two major forms, with or without AsSequence:
    //  1 - (r, g, b)   = 24bit color / true color
    //  2 - (n)         = '8bit-color' (a subset being standard 16 colors)
    //
    //  Next, try to do the best that we can:
    //  - Try to choose the right method from caps
    //  - Fall back/map from 24-bit/true > 8bit/256 -> 16c
    //  - If 8-bit and the range allows it, just use sgr(n)
    //
    fgColor(...args) {
        return this._color(...args, true);
    }

    bgColor(...args) {
        return this._color(...args, false);
    }

    //  Aliases to fg/bgColor() via RGB
    fgRGB(r, g, b, asSequence = false) {
        return this.fgColor(r, g, b, asSequence);
    }

    bgRGB(r, g, b, asSequence = false) {
        return this.bgColor(r, g, b, asSequence);
    }

    hyperlink(url, text = '', asSequence = false) {
        const capHandler = this._getCapHandler('hyperlink');
        const seq = capHandler ? capHandler.hyperlink(url, text) : (text || url);

        if (AsSequence === asSequence) {
            return seq;
        }

        this.write(seq);
        return this;
    }

    //  Private methods...
    _color(...args) {
        const foreground = args[args.length - 1];

        switch (args.length) {
            case 2 :
                //  3/4-bit or 8-bit/256
                this.rawWrite(this._colorIndexed(args[0], foreground));
                return this;

            case 3 :
                //  3/4-bit or 8-bit/256
                if (AsSequence === args[1]) {
                    return this._colorIndexed(args[0], foreground);
                }
                break;

            case 4 :
                //  RGB/24-bit/true color
                this.rawWrite(this._color24Bit(...args, foreground));
                return this;

            case 5 :
                if (AsSequence === args[3]) {
                    return this._color24Bit(...args, foreground);
                }
                break;

            default : break;
        }
    }

    _colorIndexed(n, foreground) {
        //  Allow |n| to be a string such as 'red'
        //  or 'magentaBG' (see ansi_bbs.js)
        if ('string' === typeof(n)) {
            return this.ansi.sgr(n, AsSequence);
        }

        n = parseInt(n);
        if (isNaN(n)) {
            return '';
        }

        //  Fit in the most basic 3/4-bit indexed palette
        //  and escape sequence if we can.
        if (n >= 0 && n <= 7) {
            //  e.g. 5 -> ESC[35m
            const base = foreground ? 30 : 40;
            return this.ansi.sgr(30 + n);
        }

        //  Can we even do 8-bit/256?
        if (this.hasCapability('8bit-color')) {
            return foreground ? ColorXTerm256.fgColor(n) : ColorXTerm256.bgColor(n);
        }

        //  Basic 16c
        return foreground ?
            ColorTerm16.fgColor(n) :
            ColorTerm16.bgColor(n);
    }

    _color24Bit(r, g, b, foreground) {
        r = parseInt(r);
        g = parseInt(g);
        b = parseInt(b);
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return '';
        }

        //  True color if we can
        if (this.hasCapability('24bit-color')) {
            return foreground ?
                ColorXTerm24Bit.fgRGB(r, g, b) :
                ColorXTerm24Bit.bgRGB(r, g, b);
        }

        //  Else if we can do 8-bit, do that.
        if (this.hasCapability('8bit-color')) {
            return foreground ?
                ColorXTerm256.fgRGB(r, g, b) :
                ColorXTerm256.bgRGB(r, g, b);
        }

        //  Finally fall back to very basic 16c
        return foreground ?
            ColorTerm16.fgRGB(r, g, b) :
            ColorTerm16.bgRGB(r, g, b);
    }

    _getCapHandler(cap) {
        let handler = this.termTypeCaps.capHandlers[cap];
        if (!handler) {
            return;
        }

        return this[handler];
    }

    _addStandardMethods() {
        //  ANSI-BBS methods are brought over directly so we have
        //  some nice shortcuts like this.cuu(), this.goto(), etc.
        //  that directly perform output
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this.ansi))
            .filter(name => {
                return 'constructor' !== name && !name.startsWith('_');
            })
            .concat(Object.getOwnPropertyNames(this.ansi));

        methods.forEach(method => {
            this[method] = (...args) => {
                return this.ansi[method](...args);
            }
        });
    }

    _updateCapabilities() {
        //  :TODO: specific client -> ttype -> first
        const termType = normalizedTermType(this.ttype);

        this.termTypeCaps =
            Capabilities[termType] ||
            Capabilities[this.defaultTermType] ||
            Capabilities['ansi-bbs'];

        //  We want a set to ensure uniqueness if callers
        //  explicitly modify caps
        this.termTypeCaps.capabilities = new Set(this.termTypeCaps.capabilities);

        this.setEncoding(this.termTypeCaps.encoding);
    }
};
