const Capabilities = require('./term_caps');
const {
    isXTermVariant,
    isXTerm256ColorVariant
} = require('./term_type');

const ANSI_BBS = require('./cap_handlers/ansi_bbs');
const VTX = require('./cap_handlers/vtx');

const iconv = require('iconv-lite');
const assert = require('assert');

module.exports = class TerminalOutput {
    constructor(output) {
        this.output = output;

        this.ttype          = 'unknown';
        this.termClient     = 'unknown';
        this.height         = 0;
        this.width          = 0;
        this.termTypeCaps   = [];   //  array of various caps we think this term can support

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
        this._termTypeChanged();
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

    hyperlink(url) {
    }

    //  Private methods...
    _addStandardMethods() {
        //  ANSI-BBS methods are brought over directly so we have
        //  some nice shortcuts like this.cuu(), this.goto(), etc.
        //  that directly perform output
        const methods = Object.getOwnPropertyNames(this.ansi);
        methods.forEach(method => {
            this[method] = (...args) => {
                this.rawWrite(this.ansi[method](...args), false);
                return this;    //  allow chaining
            }
        });
    }

    _termTypeChanged() {
        termTypeCaps = Capabilities[this.ttype];
        if (!termTypeCaps) {
            if (isXTerm256ColorVariant(this.ttype)) {
                termTypeCaps = Capabilities['xterm-256-color'];
            } else if (isXTermVariant(this.ttype)) {
                termTypeCaps = Capabilities['xterm'];
            }
        }

        this.termTypeCaps = termTypeCaps || [];
    }
};
