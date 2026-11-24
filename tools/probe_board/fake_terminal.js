'use strict';

//
//  A scripted terminal for the probe board's tests and --selftest.
//
//  It connects to the board like a real client: answers telnet
//  negotiation, keeps a cursor, and answers the queries its profile
//  knows. The DOS profiles reproduce the probe board's own reports from
//  the real clients under dos_terms (2026-11-24); the others come from
//  manual sessions. What each one does:
//
//  - terminate:  CPR as column;row; replies one byte per packet; answers
//                CSI = c with its DA and CSI = 6 n with a CPR; prints the
//                final byte of CSI > c and CSI < c
//  - telix:      CPR one row lower (its menu bar takes the top line);
//                answers CSI > c, = c and < c with its DA, and CSI = 6 n
//                with a CPR; prints CSI 18 t and CSI ? 6 n
//  - procomm:    coordinates kept in one byte: 999 comes back as 231
//  - pcplus:     rows clamp, columns wrap: 999;999 -> 24;231
//  - telemate:   cursor clamps at column 79 (draws 80)
//                (these three print the final byte of CSI > c, = c, < c,
//                and two bytes of CSI = Ps n, CSI > 0 q and CSI 0;0 SP D)
//  - qmodem:     ignores an out-of-range cursor move (999;999 leaves the
//                cursor where it was); answers EVERY CSI ... n with a CPR;
//                prints DA queries, CSI 18 t, CSI 0;0 SP D, CSI > 0 q
//  - netrunner:  NAWS with six data bytes; TTYPE ends in NUL; no DA
//  - syncterm:   CTerm DA, CSI < c, 255n, font state; NAWS 80x24
//  - silent:     answers nothing at all
//

const net = require('net');

const IAC = 0xff, SE = 0xf0, SB = 0xfa, WILL = 0xfb, WONT = 0xfc, DO = 0xfd, DONT = 0xfe;
const TTYPE = 24, NAWS = 31, NEW_ENVIRON = 39;

const ESC = '\u001b';
const CSI = `${ESC}[`;

const nawsBytes = (w, h) => [ w >> 8, w & 0xff, h >> 8, h & 0xff ];
const da = reply => ({ [`${CSI}c`] : reply, [`${CSI}0c`] : reply });

//  What PCPlus, Procomm 2.4.3 and Telemate print.
const DOS_PRINTS = {
    [`${CSI}>c`] : 1, [`${CSI}=c`] : 1, [`${CSI}<c`] : 1,
    [`${CSI}=1n`] : 2, [`${CSI}=2n`] : 2, [`${CSI}=3n`] : 2, [`${CSI}=6n`] : 2,
    [`${CSI}>0q`] : 2, [`${CSI}0;0 D`] : 1,
};

const Profiles = {
    terminate : {
        rows : 24, cols : 80, transposed : true, onePerPacket : true,
        answers : { ...da(`${CSI}?6c`), [`${CSI}=c`] : `${CSI}?6c` },
        cprOn : [ `${CSI}=6n` ],
        prints : { [`${CSI}>c`] : 1, [`${CSI}<c`] : 1 },
    },
    telix : {
        rows : 23, cols : 80, rowOffset : 1,
        answers : { ...da(`${CSI}?1;0c`), [`${CSI}>c`] : `${CSI}?1;0c`, [`${CSI}=c`] : `${CSI}?1;0c`, [`${CSI}<c`] : `${CSI}?1;0c`, [`${CSI}5n`] : `${CSI}0n` },
        cprOn : [ `${CSI}=6n` ],
        prints : { [`${CSI}18t`] : 3, [`${CSI}?6n`] : 2 },
    },
    procomm : {
        rows : 24, cols : 80, rowMode : 'wrap', colMode : 'wrap',
        answers : { ...da(`${CSI}?1;2c`), [`${CSI}5n`] : `${CSI}0n` },
        cprOn : [ `${CSI}?6n` ],
        prints : DOS_PRINTS,
    },
    pcplus : {
        rows : 24, cols : 80, colMode : 'wrap',
        answers : { ...da(`${CSI}?6c`), [`${CSI}5n`] : `${CSI}0n` },
        cprOn : [ `${CSI}?6n` ],
        prints : DOS_PRINTS,
    },
    telemate : {
        rows : 24, cols : 80, maxCol : 79,
        answers : { ...da(`${CSI}?6c`), [`${CSI}5n`] : `${CSI}0n` },
        prints : DOS_PRINTS,
    },
    qmodem : {
        rows : 24, cols : 80, ignoreOutOfRange : true, anyNIsCpr : true,
        prints : {
            [`${CSI}c`] : 3, [`${CSI}0c`] : 4, [`${CSI}>c`] : 4, [`${CSI}=c`] : 4, [`${CSI}<c`] : 4,
            [`${CSI}18t`] : 5, [`${CSI}0;0 D`] : 7, [`${CSI}>0q`] : 5,
        },
    },
    netrunner : {
        rows : 25, cols : 80, bbs255n : true,
        naws : [ 0x00, 0x00, 0x50, 0x00, 0x19, 0x00 ],
        ttype : [ 'ANSI-256COLOR-RGB\0' ],
    },
    syncterm : {
        rows : 24, cols : 80, bbs255n : true,
        naws : nawsBytes(80, 24),
        ttype : [ 'syncterm' ],
        answers : {
            ...da(`${CSI}=67;84;101;114;109;1;333c`),
            [`${CSI}<c`]    : `${CSI}<0;1;2;3;4;5;6;7;8c`,
            [`${CSI}5n`]    : `${CSI}0n`,
            [`${CSI}=1n`]   : `${CSI}=1;43;99;0;0;0;0n`,
            [`${CSI}=6n`]   : `${CSI}=6;1n`,
            [`${CSI}>0q`]   : `${ESC}P>|SyncTERM 1.333${ESC}\\`,
        },
    },
    silent : {
        rows : 24, cols : 80, silent : true,
    },
};

class FakeTerminal {
    constructor(profile) {
        this.p = Object.assign({ rowOffset : 0, rowMode : 'clamp', colMode : 'clamp', answers : {}, prints : {}, cprOn : [] }, profile);
        this.row = 1;
        this.col = 1;
        this.tState = 'data';
        this.escState = null;   //  null | 'esc' | 'csi' | 'string' | 'string-esc'
        this.esc = '';          //  CSI being collected
        this.ttypeIndex = 0;
        this.socket = null;
        this.queue = [];
    }

    connect(port, host = '127.0.0.1') {
        return new Promise((resolve, reject) => {
            this.socket = net.connect({ port, host }, () => resolve(this));
            this.socket.setNoDelay(true);
            this.socket.on('error', reject);
            this.socket.on('data', d => this._inbound(d));
        });
    }

    close() {
        if (this.socket) {
            this.socket.destroy();
        }
    }

    _send(bytes) {
        if (this.p.silent || !this.socket || this.socket.destroyed) {
            return;
        }
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'latin1');
        if (!this.p.onePerPacket) {
            this.socket.write(buf);
            return;
        }
        //  One write per byte, in order, a turn of the event loop apart: Terminate's packets.
        const wasIdle = !this.queue.length;
        this.queue.push(...buf);
        const drain = () => {
            if (this.socket.destroyed || !this.queue.length) {
                return;
            }
            this.socket.write(Buffer.from([ this.queue.shift() ]));
            setImmediate(drain);
        };
        if (wasIdle) {
            setImmediate(drain);
        }
    }

    _telnet(...bytes) {
        if (!this.socket.destroyed) {
            this.socket.write(Buffer.from(bytes));      //  negotiation even when "silent"
        }
    }

    _inbound(buf) {
        for (const b of buf) {
            switch (this.tState) {
                case 'data' :
                    if (IAC === b) {
                        this.tState = 'iac';
                    } else {
                        this._byte(b);
                    }
                    break;
                case 'iac' :
                    if (IAC === b) {
                        this._byte(b);
                        this.tState = 'data';
                    } else if (SB === b) {
                        this.sb = [];
                        this.tState = 'sb';
                    } else if (b >= WILL && b <= DONT) {
                        this.cmd = b;
                        this.tState = 'opt';
                    } else {
                        this.tState = 'data';
                    }
                    break;
                case 'opt' :
                    this.tState = 'data';
                    this._option(this.cmd, b);
                    break;
                case 'sb' :
                    if (IAC === b) {
                        this.tState = 'sb-iac';
                    } else {
                        this.sb.push(b);
                    }
                    break;
                case 'sb-iac' :
                    this.tState = SE === b ? 'data' : 'sb';
                    if (SE === b) {
                        this._subneg(this.sb);
                    }
                    break;
            }
        }
    }

    _option(cmd, opt) {
        if (DO !== cmd) {
            return;
        }
        if (TTYPE === opt && this.p.ttype) {
            this._telnet(IAC, WILL, TTYPE);
        } else if (NAWS === opt && this.p.naws) {
            this._telnet(IAC, WILL, NAWS);
            this._telnet(IAC, SB, NAWS, ...this.p.naws, IAC, SE);
        } else if (TTYPE === opt || NAWS === opt || NEW_ENVIRON === opt) {
            this._telnet(IAC, WONT, opt);
        }
    }

    _subneg(sb) {
        if (TTYPE === sb[0] && 1 === sb[1] && this.p.ttype) {
            const list = this.p.ttype;
            const name = list[Math.min(this.ttypeIndex++, list.length - 1)];
            this._telnet(IAC, SB, TTYPE, 0, ...Buffer.from(name, 'latin1'), IAC, SE);
        }
    }

    _byte(b) {
        const c = String.fromCharCode(b);
        switch (this.escState) {
            case 'esc' :            //  after ESC
                if ('[' === c) {
                    this.esc = `${ESC}[`;
                    this.escState = 'csi';
                } else if ('_' === c || ']' === c || 'P' === c) {
                    this.escState = 'string';       //  APC, OSC, DCS: swallowed until ST or BEL
                } else {
                    this.escState = null;           //  any other two-byte escape: ignored
                }
                return;
            case 'csi' :
                this.esc += c;
                if (b >= 0x40 && b <= 0x7e) {
                    this.escState = null;
                    this._csi(this.esc);
                }
                return;
            case 'string' :
                if (0x07 === b) {
                    this.escState = null;
                } else if (0x1b === b) {
                    this.escState = 'string-esc';
                }
                return;
            case 'string-esc' :
                this.escState = '\\' === c ? null : 'string';
                return;
        }
        if (0x1b === b) {
            this.escState = 'esc';
            return;
        }
        if (0x0d === b) {
            this.col = 1;
        } else if (0x0a === b) {
            this.row = Math.min(this.row + 1, this.p.rows);
        } else if (b >= 0x20) {
            this.col = Math.min(this.col + 1, this.p.maxCol || this.p.cols);
        }
    }

    _axis(v, max, mode) {
        if ('wrap' === mode) {
            return v & 0xff;            //  no clamp: Procomm reports 231
        }
        return Math.max(1, Math.min(v, max));
    }

    _csi(seq) {
        const answer = this.p.answers[seq];
        if (undefined !== answer) {
            this._send(answer);
            return;
        }
        if (this.p.prints[seq]) {
            this.col = Math.min(this.col + this.p.prints[seq], this.p.maxCol || this.p.cols);
            return;
        }
        const body = seq.slice(2, -1);
        const final = seq[seq.length - 1];
        if ('H' === final && /^[0-9;]*$/.test(body)) {
            const [ r, c ] = body.split(';').map(n => parseInt(n || '1', 10));
            const maxCol = this.p.maxCol || this.p.cols;
            if (this.p.ignoreOutOfRange && ((r || 1) > this.p.rows || (c || 1) > maxCol)) {
                return;
            }
            this.row = this._axis(r || 1, this.p.rows, this.p.rowMode);
            this.col = this._axis(c || 1, maxCol, this.p.colMode);
        } else if ('n' === final && '255' === body && this.p.bbs255n) {
            this._cpr(this.p.rows, this.p.cols);
        } else if ('n' === final && ('6' === body || this.p.anyNIsCpr || this.p.cprOn.includes(seq))) {
            this._cpr(this.row, this.col);
        } else if (this.p.cprOn.includes(seq)) {
            this._cpr(this.row, this.col);
        }
    }

    _cpr(row, col) {
        const r = row + this.p.rowOffset;
        this._send(this.p.transposed ? `${CSI}${col};${r}R` : `${CSI}${r};${col}R`);
    }
}

module.exports = {
    FakeTerminal,
    Profiles,
};
