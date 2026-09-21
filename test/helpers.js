'use strict';

const Terminal = require('../lib/terminal');

const ESC = '';
const CSI = `${ESC}[`;

//
//  A socket stand-in that records everything written to it.
//  Writes are kept as latin1 strings so that single bytes
//  (e.g. CP437 output) survive verbatim, and anything that is
//  not a string or Buffer is rejected the way a real socket would.
//
function fakeSocket() {
    const writes = [];
    const socket = {
        writable    : true,
        corked      : 0,
        write(data, cb) {
            if ('string' !== typeof(data) && !Buffer.isBuffer(data)) {
                throw new TypeError(`write() expects a string or Buffer, got ${typeof(data)}`);
            }
            writes.push(Buffer.isBuffer(data) ? data.toString('latin1') : data);
            if (cb) {
                cb(null);
            }
            return true;
        },
        cork() {
            this.corked++;
        },
        uncork() {
            this.corked--;
        },
    };

    return {
        socket,
        writes,
        output : () => writes.join(''),
    };
}

function makeTerminal(ttype) {
    const fake = fakeSocket();
    const term = new Terminal(fake.socket);
    if (ttype) {
        term.setTerminalType(ttype);
    }
    return Object.assign({ term }, fake);
}

module.exports = {
    ESC,
    CSI,
    fakeSocket,
    makeTerminal,
};
