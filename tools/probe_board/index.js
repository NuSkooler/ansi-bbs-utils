#!/usr/bin/env node
'use strict';

//
//  Probe board: a telnet service any terminal can connect to. It records
//  what the terminal says about itself (TTYPE, NAWS, NEW-ENVIRON), sends
//  the probes in probes.js one at a time with sentinels, and writes a
//  JSON report per connection: the raw record plus analyze()'s summary.
//  Reports are the raw material for the terminal support matrix and for
//  detection test fixtures.
//
//      node tools/probe_board [--port 4041] [--host 0.0.0.0] [--out probe-reports]
//                             [--label name] [--safe] [--once] [--no-prompt]
//                             [--timeout 3000]
//      node tools/probe_board --selftest
//
//  --safe       skip probes some terminals print (APC, OSC, ENQ, XTVERSION)
//  --label      name for the report; otherwise the board asks at the end
//  --no-prompt  don't ask for a name (automated runs, e.g. dos_terms)
//  --once       exit after the first connection
//  --selftest   run every scripted fake terminal against the board and
//               print what it concluded
//

const fs = require('fs');
const net = require('net');
const path = require('path');

const { ProbeTelnet } = require('./telnet');
const { runProbes } = require('./runner');
const { analyze, summaryLines } = require('./analyze');
const { Probes } = require('./probes');

const ESC = '\u001b';
const CSI = `${ESC}[`;

const probeDefs = Object.fromEntries(Probes.map(p => [ p.id, { send : p.send, cprs : p.cprs, moves : p.moves, risk : p.risk } ]));

function readLine(telnet, prompt, timeoutMs) {
    return new Promise(resolve => {
        let line = '';
        const done = (value) => {
            clearTimeout(timer);
            telnet.removeListener('data', onData);
            telnet.removeListener('close', onClose);
            resolve(value);
        };
        const onClose = () => done(line);
        const onData = (buf) => {
            for (const b of buf) {
                if (0x0d === b || 0x0a === b) {
                    telnet.write('\r\n');
                    return done(line);
                }
                if ((0x08 === b || 0x7f === b) && line.length) {
                    line = line.slice(0, -1);
                    telnet.write('\b \b');
                } else if (b >= 0x20 && b < 0x7f && line.length < 40) {
                    line += String.fromCharCode(b);
                    telnet.write(String.fromCharCode(b));
                }
            }
        };
        const timer = setTimeout(() => done(line), timeoutMs);
        telnet.on('data', onData);
        telnet.on('close', onClose);
        telnet.write(prompt);
    });
}

const slug = s => String(s || '').replace(/\0/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

//  One connection, start to finish. Resolves with { report, summary, file }.
async function probeSession(socket, options = {}) {
    const telnet = new ProbeTelnet(socket);
    telnet.on('error', () => {});
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;

    telnet.start();
    await telnet.settled(options.negotiateMs || 2500, options.negotiateQuietMs || 400);

    const probe = await runProbes(telnet, {
        safe        : !!options.safe,
        timeoutMs   : options.timeoutMs || 3000,
        quietMs     : options.quietMs || 800,
        graceMs     : options.graceMs || 150,
        gapMs       : undefined === options.gapMs ? 40 : options.gapMs,
    });

    const report = {
        tool        : 'ansi-bbs-utils probe board',
        version     : 1,
        label       : options.label || null,
        peer,
        telnet      : telnet.record(),
        probe,
        probeDefs,
    };
    let summary = analyze(report);

    if (telnet.writable) {
        const lines = summaryLines(summary);
        telnet.write(`${CSI}0m${CSI}2J${CSI}1;1H` + 'Probe board: done.\r\n\r\n' + lines.join('\r\n') + '\r\n\r\n');
        if (!report.label && !options.noPrompt) {
            const name = await readLine(telnet, 'Name this terminal for the report (Enter to skip): ', options.promptMs || 60000);
            report.label = name.trim() || null;
            summary = analyze(report);
        }
    }

    let file = null;
    if (options.out) {
        fs.mkdirSync(options.out, { recursive : true });
        const stamp = probe.started.replace(/[-:]/g, '').replace(/\..*$/, '');
        const name = slug(report.label) || slug(summary.telnet.ttypes[0]) || 'unknown';
        file = path.join(options.out, `${stamp}-${name}.json`);
        fs.writeFileSync(file, JSON.stringify({ ...report, summary }, null, 2));
        if (telnet.writable) {
            telnet.write(`Report saved: ${path.basename(file)}\r\nGoodbye.\r\n`);
        }
    }

    if (telnet.writable) {
        setTimeout(() => telnet.end(), 300);
    }
    return { report, summary, file };
}

function serve(options) {
    const server = net.createServer(socket => {
        console.log(`connection from ${socket.remoteAddress}:${socket.remotePort}`);
        probeSession(socket, options).then(({ summary, file }) => {
            for (const line of summaryLines(summary)) {
                console.log(`  ${line}`);
            }
            if (file) {
                console.log(`  report: ${file}`);
            }
            if (options.once) {
                server.close();
            }
        }).catch(e => console.error(`session failed: ${e.stack || e}`));
    });
    server.listen(options.port, options.host, () => {
        console.log(`probe board listening on ${options.host}:${options.port} (reports -> ${options.out})`);
    });
    return server;
}

async function selftest(options) {
    const { FakeTerminal, Profiles } = require('./fake_terminal');
    for (const [ name, profile ] of Object.entries(Profiles)) {
        const result = await new Promise((resolve, reject) => {
            const server = net.createServer(socket => {
                probeSession(socket, { ...options, label : name, noPrompt : true, out : null, timeoutMs : 600, quietMs : 300, negotiateMs : 800 })
                    .then(r => {
                        server.close();
                        fake.close();
                        resolve(r);
                    }, reject);
            });
            const fake = new FakeTerminal(profile);
            server.listen(0, '127.0.0.1', () => fake.connect(server.address().port).catch(reject));
        });
        console.log(`\n[${name}]`);
        for (const line of summaryLines(result.summary)) {
            console.log(`  ${line}`);
        }
    }
}

function parseArgs(argv) {
    const args = { port : 4041, host : '0.0.0.0', out : 'probe-reports', safe : false, once : false, noPrompt : false, selftest : false, timeoutMs : 3000 };
    for (let i = 0; i < argv.length; ++i) {
        const a = argv[i];
        if ('--safe' === a) {
            args.safe = true;
        } else if ('--once' === a) {
            args.once = true;
        } else if ('--no-prompt' === a) {
            args.noPrompt = true;
        } else if ('--selftest' === a) {
            args.selftest = true;
        } else if ('--port' === a) {
            args.port = parseInt(argv[++i], 10);
        } else if ('--host' === a) {
            args.host = argv[++i];
        } else if ('--out' === a) {
            args.out = argv[++i];
        } else if ('--label' === a) {
            args.label = argv[++i];
        } else if ('--timeout' === a) {
            args.timeoutMs = parseInt(argv[++i], 10);
        } else {
            console.error(`unknown argument: ${a}`);
            process.exit(2);
        }
    }
    return args;
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    if (args.selftest) {
        selftest(args).catch(e => {
            console.error(e);
            process.exit(1);
        });
    } else {
        serve(args);
    }
}

module.exports = {
    probeSession,
    serve,
};
