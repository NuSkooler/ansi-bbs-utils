'use strict';

//
//  The probe board's telnet layer.
//
//  Unlike the live audio harness's TelnetLite, this one asks for and
//  RECORDS what the terminal says about itself: every TTYPE it cycles
//  through, NAWS byte for byte (NetRunner sends six data bytes, not
//  four), and NEW-ENVIRON variables. Option negotiation is logged too.
//  Everything else passes through as 'data' with IAC IAC unescaped.
//

const EventEmitter = require('events');

const IAC = 0xff, SE = 0xf0, SB = 0xfa, WILL = 0xfb, WONT = 0xfc, DO = 0xfd, DONT = 0xfe;
const Opt = Object.freeze({ ECHO : 1, SGA : 3, TTYPE : 24, NAWS : 31, NEW_ENVIRON : 39 });
const IS = 0, SEND = 1, INFO = 2;
const ENV_VAR = 0, ENV_VALUE = 1, ENV_ESC = 2, ENV_USERVAR = 3;

const CmdName = { [WILL] : 'WILL', [WONT] : 'WONT', [DO] : 'DO', [DONT] : 'DONT' };
const OptName = Object.fromEntries(Object.entries(Opt).map(([ k, v ]) => [ v, k ]));

const MaxTtypes = 8;
const EnvAsk = [
    [ ENV_VAR, 'TERM' ], [ ENV_VAR, 'COLUMNS' ], [ ENV_VAR, 'ROWS' ],
    [ ENV_USERVAR, 'TERM' ], [ ENV_USERVAR, 'COLUMNS' ], [ ENV_USERVAR, 'ROWS' ],
    [ ENV_USERVAR, 'TERM_PROGRAM' ], [ ENV_USERVAR, 'TERM_PROGRAM_VERSION' ],
    [ ENV_USERVAR, 'COLORTERM' ], [ ENV_USERVAR, 'LANG' ],
];

const hex = buf => Buffer.from(buf).toString('hex').replace(/(..)(?=.)/g, '$1 ');

class ProbeTelnet extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.writable = true;
        this.t0 = Date.now();

        this.negotiation = [];          //  { t, dir: 'in'|'out', cmd, opt }
        this.ttypes = [];               //  names in the order received
        this.naws = [];                 //  { t, hex, width, height, length }
        this.environ = [];              //  { t, hex, vars: [{ kind, name, value }] }
        this.subnegotiations = [];      //  any other SB: { t, opt, hex }
        this.refused = new Set();       //  options the terminal said WONT to

        this._state = 'data';
        this._sb = [];
        this._ttypeDone = false;

        socket.on('data', d => this._inbound(d));
        socket.on('close', () => {
            this.writable = false;
            this.emit('close');
        });
        socket.on('error', e => this.emit('error', e));
    }

    //  Ask for everything the board records.
    start() {
        this._cmd(WILL, Opt.ECHO);
        this._cmd(WILL, Opt.SGA);
        this._cmd(DO, Opt.SGA);
        this._cmd(DO, Opt.TTYPE);
        this._cmd(DO, Opt.NAWS);
        this._cmd(DO, Opt.NEW_ENVIRON);
    }

    //  Resolves once TTYPE cycling and NAWS have settled, or after |maxMs|.
    settled(maxMs = 2500, quietMs = 400) {
        return new Promise(resolve => {
            const start = Date.now();
            let last = Date.now();
            const bump = () => {
                last = Date.now();
            };
            this.on('negotiation', bump);
            const timer = setInterval(() => {
                const ttypeDone = this._ttypeDone || this.refused.has(Opt.TTYPE);
                const nawsDone = this.naws.length > 0 || this.refused.has(Opt.NAWS);
                const quiet = Date.now() - last >= quietMs;
                if ((ttypeDone && nawsDone && quiet) || Date.now() - start >= maxMs || !this.writable) {
                    clearInterval(timer);
                    this.removeListener('negotiation', bump);
                    resolve();
                }
            }, 50);
        });
    }

    write(data, cb) {
        if (!this.writable) {
            return false;
        }
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
        let out = buf;
        if (buf.includes(IAC)) {
            const bytes = [];
            for (const b of buf) {
                bytes.push(b);
                if (IAC === b) {
                    bytes.push(IAC);
                }
            }
            out = Buffer.from(bytes);
        }
        return this.socket.write(out, cb);
    }

    end() {
        this.writable = false;
        this.socket.end();
    }

    record() {
        return {
            negotiation     : this.negotiation,
            ttypes          : this.ttypes,
            naws            : this.naws,
            environ         : this.environ,
            subnegotiations : this.subnegotiations,
        };
    }

    _t() {
        return Date.now() - this.t0;
    }

    _cmd(cmd, opt) {
        this.negotiation.push({ t : this._t(), dir : 'out', cmd : CmdName[cmd], opt : OptName[opt] || opt });
        this.socket.write(Buffer.from([ IAC, cmd, opt ]));
    }

    _sbSend(opt, payload) {
        const body = [];
        for (const b of payload) {
            body.push(b);
            if (IAC === b) {
                body.push(IAC);
            }
        }
        this.socket.write(Buffer.from([ IAC, SB, opt, ...body, IAC, SE ]));
    }

    _inbound(buf) {
        const out = [];
        for (const b of buf) {
            switch (this._state) {
                case 'data' :
                    if (IAC === b) {
                        this._state = 'iac';
                    } else {
                        out.push(b);
                    }
                    break;
                case 'iac' :
                    if (IAC === b) {
                        out.push(IAC);
                        this._state = 'data';
                    } else if (SB === b) {
                        this._sb = [];
                        this._state = 'sb';
                    } else if (b >= WILL && b <= DONT) {
                        this._pendingCmd = b;
                        this._state = 'opt';
                    } else {
                        this._state = 'data';       //  NOP, GA, etc.
                    }
                    break;
                case 'opt' :
                    this._state = 'data';
                    this._onCommand(this._pendingCmd, b);
                    break;
                case 'sb' :
                    if (IAC === b) {
                        this._state = 'sb-iac';
                    } else {
                        this._sb.push(b);
                    }
                    break;
                case 'sb-iac' :
                    if (IAC === b) {
                        this._sb.push(IAC);
                        this._state = 'sb';
                    } else if (SE === b) {
                        this._state = 'data';
                        this._onSubnegotiation(this._sb);
                    } else {
                        //  Malformed: IAC <x> inside SB. Keep both bytes, carry on.
                        this._sb.push(IAC, b);
                        this._state = 'sb';
                    }
                    break;
            }
        }
        if (out.length) {
            this.emit('data', Buffer.from(out));
        }
    }

    _onCommand(cmd, opt) {
        this.negotiation.push({ t : this._t(), dir : 'in', cmd : CmdName[cmd], opt : OptName[opt] || opt });
        if (WONT === cmd || DONT === cmd) {
            this.refused.add(opt);
        }
        if (WILL === cmd && Opt.TTYPE === opt) {
            this._sbSend(Opt.TTYPE, [ SEND ]);
        } else if (WILL === cmd && Opt.NEW_ENVIRON === opt) {
            const ask = [ SEND ];
            for (const [ kind, name ] of EnvAsk) {
                ask.push(kind, ...Buffer.from(name, 'latin1'));
            }
            this._sbSend(Opt.NEW_ENVIRON, ask);
        }
        this.emit('negotiation');
    }

    _onSubnegotiation(sb) {
        const opt = sb[0];
        const data = sb.slice(1);
        const t = this._t();
        if (Opt.TTYPE === opt && IS === data[0]) {
            const name = Buffer.from(data.slice(1)).toString('latin1');
            const repeat = this.ttypes.includes(name);
            this.ttypes.push(name);
            if (repeat || this.ttypes.length >= MaxTtypes) {
                this._ttypeDone = true;
            } else {
                this._sbSend(Opt.TTYPE, [ SEND ]);
            }
        } else if (Opt.NAWS === opt) {
            const entry = { t, hex : hex(data), length : data.length, width : null, height : null };
            if (data.length >= 4) {
                entry.width = (data[0] << 8) | data[1];
                entry.height = (data[2] << 8) | data[3];
            }
            this.naws.push(entry);
        } else if (Opt.NEW_ENVIRON === opt && (IS === data[0] || INFO === data[0])) {
            this.environ.push({ t, hex : hex(data), vars : parseEnviron(data.slice(1)) });
        } else {
            this.subnegotiations.push({ t, opt : OptName[opt] || opt, hex : hex(sb) });
        }
        this.emit('negotiation');
    }
}

function parseEnviron(bytes) {
    const vars = [];
    let cur = null;
    let field = null;
    for (let i = 0; i < bytes.length; ++i) {
        let b = bytes[i];
        if (ENV_VAR === b || ENV_USERVAR === b) {
            cur = { kind : ENV_VAR === b ? 'VAR' : 'USERVAR', name : '', value : null };
            vars.push(cur);
            field = 'name';
            continue;
        }
        if (ENV_VALUE === b && cur) {
            cur.value = '';
            field = 'value';
            continue;
        }
        if (ENV_ESC === b && i + 1 < bytes.length) {
            b = bytes[++i];
        }
        if (cur && field) {
            cur[field] += String.fromCharCode(b);
        }
    }
    return vars;
}

module.exports = {
    ProbeTelnet,
    parseEnviron,
    Opt,
};
