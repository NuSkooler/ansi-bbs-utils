'use strict';

//
//  Runs the probes over any stream with write() and 'data' events and
//  records every reply byte for byte. No interpretation happens here:
//  that is analyze.js, so a report can be re-analysed later.
//
//  When is a step over? The baseline step learns what the terminal sends
//  for the sentinel (the cursor at row 2, column 7: "CSI 2;7 R", or
//  "CSI 7;2 R" from a terminal that reports column;row). From then on a
//  step ends when THAT reply arrives, however many other cursor reports
//  come first: some terminals answer CSI = 6 n, or every CSI ... n, with
//  a cursor report. Counting replies instead lets a step end early, and
//  its sentinel lands in the next step (seen with Terminate 5.00, whose
//  replies arrive a byte at a time).
//
//  A step that times out is drained: the board keeps listening for its
//  sentinel (up to drainMs) before the next probe goes out, so a slow
//  reply is still filed under the probe that caused it.
//
//  Count mode (wait for the expected number of cursor reports) is used for
//  the baseline itself and for terminals whose reports are all the same.
//

const { Probes, AREA_ROW, frame } = require('./probes');

const ESC = '\u001b';
const CSI = `${ESC}[`;

//  Any CSI ... R: a CPR, a 255n answer, or an extended CPR (CSI ? ... R).
const CPR_SHAPED = /\x1b\[\??[0-9]*(?:;[0-9]*)*R/g;

const DefaultOptions = {
    timeoutMs   : 3000,     //  per step, before draining
    drainMs     : 2000,     //  after a timeout, how long to wait for the late sentinel
    graceMs     : 150,      //  count mode: after the last expected report, for trailing bytes
    quietMs     : 800,      //  without CPR support: a step ends after this much silence
    gapMs       : 40,       //  between steps
    safe        : false,    //  skip 'print' probes
    probes      : Probes,
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cprList = s => s.match(CPR_SHAPED) || [];

//  ctx: { mode: 'sentinel' | 'count' | 'quiet', sentinel: raw reply string }
function runStep(io, probe, opts, ctx) {
    return new Promise(resolve => {
        const t0 = Date.now();
        const chunks = [];
        let rx = '';
        let draining = false;
        let graceTimer = null;
        let quietTimer = null;
        let hardTimer = null;
        let drainTimer = null;
        const expected = probe.cprs + 2;

        const finish = (complete) => {
            [ graceTimer, quietTimer, hardTimer, drainTimer ].forEach(t => clearTimeout(t));
            io.removeListener('data', onData);
            resolve({
                id      : probe.id,
                sent    : probe.send,
                rx,
                chunks,
                ms      : Date.now() - t0,
                complete,
                late    : draining && complete,
            });
        };

        const armQuiet = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => finish(false), opts.quietMs);
        };

        const check = () => {
            if ('sentinel' === ctx.mode) {
                if (rx.includes(ctx.sentinel)) {
                    finish(true);
                }
            } else if ('count' === ctx.mode) {
                if (!graceTimer && cprList(rx).length >= expected) {
                    graceTimer = setTimeout(() => finish(true), opts.graceMs);
                }
            } else {
                armQuiet();
            }
        };

        const onData = (buf) => {
            rx += buf.toString('latin1');
            chunks.push({ t : Date.now() - t0, n : buf.length });
            check();
        };

        hardTimer = setTimeout(() => {
            if ('sentinel' !== ctx.mode) {
                return finish(false);
            }
            draining = true;        //  still waiting for this step's sentinel
            drainTimer = setTimeout(() => finish(false), opts.drainMs);
        }, opts.timeoutMs);

        io.on('data', onData);
        if ('quiet' === ctx.mode) {
            armQuiet();
        }
        io.write(frame(probe));
    });
}

//  After the baseline: how the remaining steps decide they are over.
function contextFromBaseline(step) {
    const cprs = cprList(step.rx);
    if (0 === cprs.length) {
        return { mode : 'quiet' };
    }
    if (cprs.length >= 2 && cprs[cprs.length - 1] !== cprs[cprs.length - 2]) {
        return { mode : 'sentinel', sentinel : cprs[cprs.length - 1] };
    }
    return { mode : 'count' };
}

//  Returns { started, safe, mode, steps: [...] }.
async function runProbes(io, options = {}) {
    const opts = Object.assign({}, DefaultOptions, options);
    const probes = opts.probes.filter(p => !opts.safe || 'safe' === p.risk);
    const steps = [];
    const started = new Date().toISOString();

    io.write(`${CSI}0m${CSI}2J${CSI}1;1H` +
        'ansi-bbs-utils probe board: probing, please wait...' +
        `${CSI}${AREA_ROW + 2};1H` + '(probe replies are recorded byte for byte)');

    let ctx = { mode : 'count' };
    for (const probe of probes) {
        const step = await runStep(io, probe, opts, ctx);
        steps.push(step);
        if ('baseline' === probe.id) {
            ctx = contextFromBaseline(step);
        }
        if (!io.writable) {
            break;
        }
        await delay(opts.gapMs);
    }

    return { started, safe : opts.safe, mode : ctx.mode, sentinel : ctx.sentinel || null, steps };
}

module.exports = {
    runProbes,
    CPR_SHAPED,
    DefaultOptions,
};
