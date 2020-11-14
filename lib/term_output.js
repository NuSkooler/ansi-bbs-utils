const Capabilities = require('./capabilities');
const {
    normalizedTermType,
} = require('./ttype_utils');
const { CSI } = require('./ansi')

const ANSI_BBS = require('./handlers/ansi_bbs');
const VTX = require('./handlers/vtx');

const ColorXTerm256 = require('./color_xterm_256');
const ColorXTerm24Bit = require('./color_xterm_24bit');

const iconv = require('iconv-lite');
const assert = require('assert');

const AsSequenceSym = Symbol('AsSeq');

module.exports = class TerminalOutput {
    constructor(output) {
        this.output = output;

        this.ttype              = 'unknown';
        this.termClient         = 'unknown';
        this.height             = 0;
        this.width              = 0;
        this.defaultTermType    = 'ansi-bbs';
        this.termTypeCaps       = Capabilities[this.defaultTermType];

        this.encoding       = 'cp437';
        assert(iconv.encodingExists(this.encoding));

        this.ansi   = new ANSI_BBS();
        this.vtx    = new VTX();

        this._addStandardMethods();

        /*
            :TODO:
            - special methods, e.g. hyperlink(url): getGenerator() -> caps -> VTX.hyperlink()
            - Stuff from here: https://github.com/NuSkooler/skull-crash/blob/master/bundles/sc-telnet-networking/lib/term_util.js
        */
    }

    static get AsSequence() {
        return AsSequenceSym;
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

    //  Output stuff...
    setOutput(output) {
        this.output = output;
    }

    cork() {
        if (this.output) {
            this.output.cork();
        }
        return this;    //  chaining
    }

    uncork() {
        if (this.output) {
            this.output.uncork();
        }
        return this;    //  chaining
    }

    write(s, cb) {
        return this.rawWrite(this.encode(s, true), cb);
    }

    rawWrite(data, cb) {
        if (this.output) {
            this.output.write(data, cb);
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

    //  :TODO: fgRGB/bgRGB -> fg/bgColor aliases

    fgColor(...args) {
        //
        //  Accept args in two major forms, with or without AsSequence:
        //  1 - (r, g, b) = '24bit-color'
        //  2 - (n) = '8bit-color' (a subset being standard 16 colors)
        //
        //  Next, try to do the best that we can:
        //  - Try to choose the right method from caps
        //  - Fall back/map from 24-bit/true > 8bit/256 -> 16c
        //  - If 8-bit and the range allows it, just use sgr(n)
        //
        //  :TODO: Amiga/C64/etc.
        switch (args.length) {
            case 1 :
                //  8-bit/256
                this.write(this._color8Bit(args[0], true));
                return this;

            case 2 :
                //  8-bit/256 (string)
                if (TerminalOutput.AsSequence === args[1]) {
                    return this._color8Bit(args[0], true);
                }
                break;

            case 3 :
                //  RGB/24-bit/true
                this.write(this._color24Bit(...args, true));
                return this;

            case 4 :
                if (TerminalOutput.AsSequence === args[1]) {
                    return this._color24Bit(...args, true);
                }
                break;

            default : break;
        }
    }

    hyperlinkURL(url) {
        const capHandler = this._getCapHandler('hyperlink');
        return capHandler ? capHandler.hyperlinkURL(url) : url;
    }

    //  Private methods...
    _color8Bit(n, foreground) {
        //  :TODO: allow n = num | name -> num (color_names.js::Names{}

        //  8bit/256 or 16c pallets
        n = parseInt(n);
        if (isNaN(n)) {
            return '';
        }

        //  If we can fit within the most basic standard, do so
        if (n >= 0 && n <= 7) {
            //  e.g. 5 -> ESC[35m
            const base = foreground ? 30 : 40;
            return this.ansi.sgr(30 + n);
        }

        if (this.termTypeCaps.capabilities.includes('8bit-color')) {
            return foreground ? ColorXTerm256.fgColor(n) : ColorXTerm256.bgColor(n);
        }

        //  :TODO: map to 16, 4bit_color.js::fgColor/bgColor(n) -> seq
    }

    _color24Bit(r, g, b, foreground) {
        r = parseInt(r);
        g = parseInt(g);
        b = parseInt(b);
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return '';
        }

        //  True color if we can
        if (this.termTypeCaps.capabilities.includes('24bit-color')) {
            return foreground ?
                ColorXTerm24Bit.fgRGB(r, g, b) :
                ColorXTerm24Bit.bgRGB(r, g, b);
        }

        //  Else if we can do 8-bit, do that.
        if (this.termTypeCaps.capabilities.includes('8bit-color')) {
            return foreground ?
                ColorXTerm256.fgRGB(r, g, b) :
                ColorXTerm256.bgRGB(r, g, b);
        }

        //  Finally, just map to 4-bit colors
        //  :TODO: map to 4-bit
        //  4bit-color -> 4bit_color.js::fg/bgRGB(r, g, b) -> seq
    }

    _getCapHandlerName(cap) {
        return this.termTypeCaps.capHandlers[cap];
    }

    _getCapHandler(cap) {

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
                this.rawWrite(this.ansi[method](...args), false);
                return this;    //  allow chaining
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
    }
};
