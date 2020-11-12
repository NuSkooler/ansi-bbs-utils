const Capabilities = require('./term_caps');
const {
    isXTermVariant,
    isXTerm256ColorVariant
} = require('./term_type');

const iconv = require('iconv-lite');
const assert = require('assert');

module.exports = class TerminalOutput {
    constructor(output) {
        this.output = output;

        this.ttype          = 'unknown';
        this.termClient     = 'unknown';
        this.height         = 0;
        this.width          = 0;
        this.termTypeCaps   = [];

        this.encoding       = 'cp437';
        assert(iconv.encodingExists(this.encoding));
    }

    connect(output) {
        this.output = output;
    }

    disconnect() {
        this.output = null;
    }

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

    write(s, convertLineFeeds=true, cb=null) {
        this.rawWrite(this.encode(s, convertLineFeeds), cb);
    }

    rawWrite(data, cb) {
        if (!this.output) {
            return;
        }

        this.output.write(data, cb);
    }

    encode(s, convertLineFeeds=true) {
        if (convertLineFeeds && 'string' === typeof(s)) {
            s = s.replace(/\n/g, '\r\n');
        }
        return iconv.encode(s, this.encoding);
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
