#!/usr/bin/env node
'use strict';

//
//  Live audio checklist harness.
//
//  Listens for one telnet connection from a real terminal (IcyTerm,
//  SyncTERM) and walks the checklist in docs/audio.md interactively:
//  identifies the client, probes for audio, asks about formats, then
//  takes single keys to play, adjust, stop and inspect. Everything the
//  BBS sends and the terminal answers is logged on this console, and
//  any keystroke that is not a menu key is reported as "stray input":
//  that is the leak detector.
//
//      node tools/make_test_audio.js
//      node tools/live_audio.js [--port 4040] [--music f] [--sfx f] [--big f]
//
//  Then connect the terminal to this host, port 4040, telnet.
//
//      node tools/live_audio.js --selftest
//
//  drives the same flow with the FakeCTerm over a loopback socket.
//  --once exits after the first session ends (handy when the console
//  log is captured for review).
//

const net = require('net');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const Terminal = require('../lib/terminal');
const { AsSequence } = require('../lib/common');
const { awaitReply } = require('../lib/audio/replies');
const FakeCTerm = require('../lib/testing/fake_cterm');

const ESC = String.fromCharCode(0x1b);

//  --- arguments ---------------------------------------------------------

const args = { port : 4040, selftest : false, once : false };
{
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; ++i) {
        const a = argv[i];
        if ('--selftest' === a) {
            args.selftest = true;
        } else if ('--once' === a) {
            args.once = true;
        } else if (a.startsWith('--') && i + 1 < argv.length) {
            args[a.slice(2)] = argv[++i];
        }
    }
    args.port = parseInt(args.port, 10);
    const samples = path.join(__dirname, 'samples');
    args.music = args.music || path.join(samples, 'music.wav');
    args.sfx = args.sfx || path.join(samples, 'sfx.wav');
    args.big = args.big || path.join(samples, 'big.wav');
}

//  --- a minimal telnet layer ---------------------------------------------
//
//  Strips IAC commands from what the terminal sends (its negotiation
//  replies) and escapes 0xFF on the way out. Nothing else.

const IAC = 0xff, SE = 0xf0, SB = 0xfa, WILL = 0xfb, WONT = 0xfc, DO = 0xfd, DONT = 0xfe;
const ECHO = 1, SGA = 3;

class TelnetLite extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.writable = true;
        this._state = 0;

        socket.on('data', d => this._inbound(d));
        socket.on('close', () => {
            this.writable = false;
            this.emit('close');
        });
        socket.on('error', e => this.emit('error', e));
    }

    write(data, cb) {
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

    cork() {
        this.socket.cork();
    }

    uncork() {
        this.socket.uncork();
    }

    command(...bytes) {
        this.socket.write(Buffer.from([ IAC, ...bytes ]));
    }

    _inbound(buf) {
        const out = [];
        for (const b of buf) {
            switch (this._state) {
                case 0 :
                    if (IAC === b) {
                        this._state = 1;
                    } else {
                        out.push(b);
                    }
                    break;
                case 1 :    //  after IAC
                    if (IAC === b) {
                        out.push(IAC);
                        this._state = 0;
                    } else if (SB === b) {
                        this._state = 3;
                    } else if (b >= WILL && b <= DONT) {
                        this._state = 2;
                    } else {
                        this._state = 0;
                    }
                    break;
                case 2 :    //  option byte of WILL/WONT/DO/DONT
                    this._state = 0;
                    break;
                case 3 :    //  inside SB ... IAC SE
                    if (IAC === b) {
                        this._state = 4;
                    }
                    break;
                case 4 :
                    this._state = SE === b ? 0 : 3;
                    break;
                default :
                    this._state = 0;
            }
        }
        if (out.length) {
            this.emit('data', Buffer.from(out));
        }
    }
}

//  --- logging ------------------------------------------------------------

const printable = s => s.replace(/[\x00-\x1f\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
const head = (s, n = 90) => s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s;

function describeOutbound(buf) {
    const s = buf.toString('latin1');
    const apcs = s.split(`${ESC}_`).slice(1).map(x => x.split(`${ESC}\\`)[0]);
    if (apcs.length) {
        return apcs.map(a => `-> APC ${head(a)}`);
    }
    if (s.startsWith(`${ESC}[`) && s.length < 40) {
        return [ `-> ${printable(s)}` ];
    }
    return [];
}

//  --- one terminal session -----------------------------------------------

const MENU = [
    'm  play music (loop)          s  play an effect (alternating pan)',
    '-  music volume down (ramp)   +  music volume up (ramp)',
    'f  stop music with a fade     x  stop music now',
    't  synthesized tone           l  list the client cache',
    'a  audio state query          b  upload the big file (timing)',
    'r  re-check cache, re-ensure  ?  this menu                q  quit',
];

async function session(socket, { onDone } = {}) {
    const telnet = new TelnetLite(socket);
    telnet.command(WILL, ECHO);
    telnet.command(WILL, SGA);
    telnet.command(DO, SGA);

    const term = new Terminal(telnet);
    telnet.on('data', d => term.feed(d));

    let sentApcs = 0;
    const origWrite = telnet.write.bind(telnet);
    telnet.write = (data, cb) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
        for (const line of describeOutbound(buf)) {
            console.log(line);
            if (line.startsWith('-> APC')) {
                sentApcs++;
            }
        }
        return origWrite(buf, cb);
    };

    const say = (s) => {
        console.log(s);
        if (telnet.writable) {
            term.write(`${s}\n`);
        }
    };

    term.on('device attributes', da => console.log(`<- DA ${printable(da.raw)}  client=${da.client} version=${da.version}`));
    term.on('report', r => console.log(`<- report ${printable(r.raw)}`));
    term.on('apc', a => console.log(`<- APC ${head(printable(a.body))}`));
    term.on('reply error', e => say(`!! reply error: ${e.reason} (${e.dropped.length} bytes dropped)`));
    telnet.on('error', e => console.log(`!! socket error: ${e.message}`));

    const finish = () => {
        term.destroy();
        if (onDone) {
            onDone();
        }
    };
    telnet.on('close', () => {
        console.log('-- connection closed');
        finish();
    });

    say('');
    say('ansi-bbs-utils live audio checklist');
    say('===================================');

    //  1. identity
    const da = await awaitReply(term, 'device attributes', p => p, 1500,
        () => term.sendSequence(term.cterm.queryDeviceAttributes(AsSequence)));
    say(da ?
        `client: ${da.client || 'unknown'}  version: ${da.version || '?'}  ctermVersion: ${da.ctermVersion || 'none'}` :
        'client: no device attributes reply within 1.5s');

    if (!telnet.writable) {
        return term;    //  a port scan or a protocol mismatch; nothing to do
    }

    //  2. probe
    const probe = await term.probeAudio({ timeout : 2000 });
    say(`probe: backend=${probe.backend} files=${probe.files}`);

    const audio = term.audio;
    audio.on('idle', e => say(`<< idle: channel ${e.channel} (${e.name || (e.handle ? 'tone' : 'no handle')})`));

    //  3. formats
    if ('cterm' === probe.backend && probe.files) {
        for (const name of [ 'wav/pcm16', 'ogg/vorbis', 'ogg/opus', 'flac/pcm16', 'mpeg/mp3' ]) {
            const answer = await audio.formatSupported(name);
            say(`format ${name}: ${undefined === answer ? 'cannot ask' : answer}`);
        }
    }

    //  4. assets
    const have = {};
    for (const [ key, file ] of [ [ 'music', args.music ], [ 'sfx', args.sfx ], [ 'big', args.big ] ]) {
        if (fs.existsSync(file)) {
            audio.asset({ name : `live/${key}${path.extname(file)}`, path : file });
            have[key] = `live/${key}${path.extname(file)}`;
            say(`asset ${key}: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
        } else {
            say(`asset ${key}: missing (${file}); run tools/make_test_audio.js or pass --${key}`);
        }
    }

    say('');
    MENU.forEach(line => say(line));
    say('');

    let volume = 70;
    let pan = 40;

    const actions = {
        m : async () => {
            const t0 = Date.now();
            const sent = sentApcs;
            const h = await audio.play('music', have.music, { loop : true, volume });
            say(`music: channel ${h.channel}, ${Date.now() - t0} ms, ${sentApcs - sent} APCs (3 = no upload needed)`);
        },
        s : async () => {
            pan = -pan;
            const h = await audio.play('sfx', have.sfx, { pan, volume : 90 });
            say(`sfx: channel ${h.channel}, pan ${pan}`);
        },
        '-' : async () => {
            volume = Math.max(0, volume - 20);
            await audio.volume('music', volume, { ramp : 1000 });
            say(`music volume -> ${volume} over 1s`);
        },
        '+' : async () => {
            volume = Math.min(100, volume + 20);
            await audio.volume('music', volume, { ramp : 1000 });
            say(`music volume -> ${volume} over 1s`);
        },
        f : async () => {
            await audio.stop('music', { fade : 1500 });
            say('music: fading out over 1.5s');
        },
        x : async () => {
            await audio.stop('music');
            say('music: stopped');
        },
        t : async () => {
            const h = await audio.playTone('sfx', { hz : 660, duration : 300, volume : 60 });
            say(`tone: channel ${h.channel}`);
        },
        l : async () => {
            const listing = await awaitReply(term, 'apc', ({ body }) => body.startsWith('SyncTERM:C;L\n') ? body : undefined, 2000,
                () => term.sendSequence(term.cterm.listFiles(AsSequence)));
            if (!listing) {
                return say('cache: no listing within 2s');
            }
            const lines = listing.split('\n').slice(1).filter(Boolean);
            say(`cache: ${lines.length} file(s)`);
            lines.forEach(line => say(`  ${line.replace('\t', '  ')}`));
        },
        a : async () => {
            const params = await awaitReply(term, 'report',
                p => 7 === p.params[0] && !(3 === p.params.length && 0 === p.params[2]) ? p.params : undefined, 2000,
                () => term.sendSequence(term.cterm.queryAudioState(AsSequence)));
            if (!params) {
                return say('state: no reply within 2s');
            }
            const running = [];
            for (let i = 1; i + 1 < params.length; i += 2) {
                running.push(`${params[i]}=${params[i + 1] ? 'running' : 'stopped'}`);
            }
            say(`state: ${running.length ? running.join(' ') : 'all idle'}`);
        },
        b : async () => {
            if (!have.big) {
                return say('no big file');
            }
            const size = fs.statSync(args.big).size;
            const t0 = Date.now();
            const sent = sentApcs;
            await audio.ensureAsset(have.big);
            const ms = Date.now() - t0;
            say(`big: ${(size / 1024).toFixed(0)} KB in ${ms} ms${sentApcs > sent ? ` (${(size / 1024 / (ms / 1000)).toFixed(0)} KB/s uploaded)` : ' (already cached)'}`);
        },
        r : async () => {
            audio.backend.invalidateCache();
            const sent = sentApcs;
            const t0 = Date.now();
            await audio.ensureAsset(have.music);
            say(`re-ensure music: ${Date.now() - t0} ms, ${sentApcs - sent} APC(s) (1 = listing only, no re-upload)`);
        },
        '?' : async () => {
            MENU.forEach(line => say(line));
        },
        q : async () => {
            say('bye');
            socket.end();
        },
    };

    let busy = Promise.resolve();
    term.on('input', buf => {
        for (const b of buf) {
            const key = String.fromCharCode(b);
            if ('\r' === key || '\n' === key || ' ' === key) {
                continue;
            }
            const action = actions[key];
            if (!action) {
                say(`?? stray input: 0x${b.toString(16).padStart(2, '0')} ${printable(key)}`);
                continue;
            }
            busy = busy.then(() => action()).catch(e => say(`!! ${key}: ${e.message}`));
        }
    });

    return term;
}

//  --- server ---------------------------------------------------------------

function listen(onSession) {
    const server = net.createServer(socket => {
        console.log(`-- connection from ${socket.remoteAddress}:${socket.remotePort}`);
        socket.setNoDelay(true);
        session(socket, { onDone : () => onSession && onSession() }).catch(e => {
            console.log(`!! session failed: ${e.stack || e.message}`);
            socket.destroy();
        });
    });
    server.listen(args.port, () => {
        console.log(`listening on port ${args.port}; connect a terminal via telnet`);
        console.log(`samples: ${args.music}`);
    });
    return server;
}

//  --- self test: the fake terminal over a real socket ----------------------

async function selftest() {
    const server = listen(() => {
        console.log('-- selftest session ended');
        server.close();
        fake.destroy();
        console.log(`-- selftest OK: ${fake.cache.size} file(s) in the fake cache, ${fake.waitCalls} Wait verb(s)`);
        process.exit(fake.waitCalls ? 1 : 0);
    });

    const fake = new FakeCTerm({ playbackMs : 400, formats : { '1;2' : true, '32;96' : true } });

    await new Promise(r => server.once('listening', r));
    const client = net.connect(args.port, '127.0.0.1');
    client.on('data', d => fake.socket.write(d));
    fake.on('reply', b => client.write(b));

    const keys = [ 'm', 's', 's', '-', 't', 'l', 'a', 'b', 'r', 'z', 'f', 'q' ];
    let delay = 2500;
    for (const key of keys) {
        setTimeout(() => client.write(key), delay);
        delay += 500;
    }
}

if (args.selftest) {
    selftest().catch(e => {
        console.log(`!! selftest failed: ${e.stack || e.message}`);
        process.exit(1);
    });
} else {
    const server = listen(() => {
        if (args.once) {
            console.log('-- done (--once)');
            server.close();
            process.exit(0);
        }
    });
}
