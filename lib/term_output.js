const Capabilities = require('./capabilities');
const {
    normalizedTermType,
} = require('./ttype_utils');

const ANSI_BBS = require('./handlers/ansi_bbs');
const VTX = require('./handlers/vtx');

const iconv = require('iconv-lite');
const assert = require('assert');

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

    rgb(r, g, b) {
        //  :TODO: if 256 -> map 256 else true else none
    }

    hyperlinkURL(url) {
        const capHandler = this._getCapHandler('hyperlink');
        return capHandler ? capHandler.hyperlinkURL(url) : url;
    }

    //  Private methods...
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

        termTypeCaps =
            Capabilities[termType] ||
            Capabilities[this.defaultTermType] ||
            Capabilities['ansi-bbs'];
    }
};
