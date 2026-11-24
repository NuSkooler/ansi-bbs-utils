'use strict';

//
//  analyze(report): what a probe board report says about the terminal.
//
//  Pure: takes the recorded report (telnet record + probe steps) and
//  returns a summary, so old reports can be re-read when the rules
//  change, and recorded reports work as test fixtures.
//
//  Cursor reports are read against the baseline step, which asks for the
//  cursor at two known places (the probe area, row 4 col 1, and the
//  sentinel, row 2 col 7). From those two answers:
//  - 'normal':     row;col, possibly offset (Telix reports one row more:
//                  its menu bar takes the top line)
//  - 'transposed': col;row (Terminate 5.00)
//  - 'constant':   the same answer everywhere (Qmodem 4.6 says 1;1)
//  - 'none':       no cursor reports at all
//  - 'unknown':    anything else
//  Every later cursor report is normalised the same way before use.
//

const { parseDeviceAttributes } = require('../../lib/device_attrs');
const { AREA_ROW, SENTINEL } = require('./probes');
const { CPR_SHAPED } = require('./runner');

const ESC = '\u001b';

const show = s => String(s).replace(/\x1b/g, 'ESC').replace(/[\x00-\x1f\x7f-\xff]/g,
    c => `<${c.charCodeAt(0).toString(16).padStart(2, '0')}>`);

const VtClass = { 1 : 'VT100', 6 : 'VT102', 62 : 'VT220', 63 : 'VT320', 64 : 'VT420', 65 : 'VT5xx' };

function parseCprs(rx) {
    return [ ...rx.matchAll(CPR_SHAPED) ].map(m => {
        const body = m[0].slice(2, -1);
        const extended = body.startsWith('?');
        const nums = (extended ? body.slice(1) : body).split(';').map(n => (n === '' ? 1 : parseInt(n, 10)));
        return { row : nums[0], col : nums.length > 1 ? nums[1] : 1, extended, raw : m[0] };
    });
}

//  Everything in rx that is not a CPR-shaped reply, split into tokens.
function otherReplies(rx) {
    const rest = rx.replace(CPR_SHAPED, '');
    const tokens = [];
    const re = /\x1bP[\s\S]*?\x1b\\|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b_[\s\S]*?\x1b\\|\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x1b[\s\S]?|[^\x1b]+/g;
    for (const m of rest.matchAll(re)) {
        tokens.push(m[0]);
    }
    return tokens;
}

function splitStep(step) {
    const cprs = parseCprs(step.rx);
    const n = cprs.length;
    return {
        sentinel    : n >= 1 ? cprs[n - 1] : null,
        after       : n >= 2 ? cprs[n - 2] : null,
        probeCprs   : cprs.slice(0, Math.max(0, n - 2)),
        replies     : otherReplies(step.rx),
    };
}

function cprMapping(baseline) {
    if (!baseline) {
        return { kind : 'none' };
    }
    const { after : a, sentinel : s } = splitStep(baseline);
    if (!a || !s) {
        return s ? { kind : 'unknown', seen : [ s.raw ] } : { kind : 'none' };
    }
    if (a.row === s.row && a.col === s.col) {
        return { kind : 'constant', value : `${a.row};${a.col}` };
    }
    const dRow = AREA_ROW - SENTINEL.row;       //  2
    const dCol = SENTINEL.col - 1;              //  6
    if (a.row - s.row === dRow && s.col - a.col === dCol) {
        return { kind : 'normal', rowOffset : a.row - AREA_ROW, colOffset : a.col - 1 };
    }
    if (a.col - s.col === dRow && s.row - a.row === dCol) {
        return { kind : 'transposed', rowOffset : a.col - AREA_ROW, colOffset : a.row - 1 };
    }
    return { kind : 'unknown', seen : [ a.raw, s.raw ] };
}

function normalizer(mapping) {
    if ('normal' !== mapping.kind && 'transposed' !== mapping.kind) {
        return null;
    }
    return (cpr) => {
        const [ row, col ] = 'transposed' === mapping.kind ? [ cpr.col, cpr.row ] : [ cpr.row, cpr.col ];
        return { row : row - mapping.rowOffset, col : col - mapping.colOffset };
    };
}

function sizeFrom(cpr, norm) {
    if (!cpr || !norm) {
        return null;
    }
    const raw = norm(cpr);
    const out = { rows : raw.row, cols : raw.col, raw : cpr.raw, flags : [] };
    if (231 === raw.row || 231 === raw.col) {
        out.flags.push('wrapped-256');          //  999 & 0xff: one-byte coordinates
    }
    if (79 === raw.col) {
        out.flags.push('clamped-79');           //  Telemate: cursor stops at column 79, draws 80
    }
    //  Still at home, or still in the probe area: Qmodem ignores an out-of-range move.
    if ((raw.row <= 1 && raw.col <= 1) || (raw.row === AREA_ROW && raw.col === 1)) {
        out.flags.push('did-not-move');
    }
    return out;
}

const plausible = (cols, rows) => cols >= 20 && cols <= 400 && rows >= 5 && rows <= 200 &&
    231 !== cols && 231 !== rows;

function analyze(report) {
    const steps = (report.probe && report.probe.steps) || [];
    const byId = Object.fromEntries(steps.map(s => [ s.id, s ]));
    const telnet = report.telnet || {};
    const notes = [];

    //  --- telnet ---
    const nawsRec = (telnet.naws || [])[0] || null;
    let naws = null;
    if (nawsRec) {
        naws = {
            width       : nawsRec.width,
            height      : nawsRec.height,
            length      : nawsRec.length,
            hex         : nawsRec.hex,
            malformed   : 4 !== nawsRec.length,
            plausible   : 4 === nawsRec.length && plausible(nawsRec.width, nawsRec.height),
        };
        if (naws.malformed) {
            notes.push(`NAWS is malformed: ${nawsRec.length} data bytes (${nawsRec.hex}), not 4`);
        } else if (!naws.plausible) {
            notes.push(`NAWS size ${nawsRec.width}x${nawsRec.height} is implausible`);
        }
    }
    const environ = {};
    for (const rec of telnet.environ || []) {
        for (const v of rec.vars) {
            environ[`${v.kind}:${v.name}`] = v.value;
        }
    }
    const ttypes = [ ...new Set((telnet.ttypes || []).map(t => t.replace(/\0+$/, ''))) ];
    if ((telnet.ttypes || []).some(t => /\0/.test(t))) {
        notes.push('TTYPE contains a NUL byte');
    }

    //  --- cursor reports ---
    const mapping = cprMapping(byId.baseline);
    const norm = normalizer(mapping);
    if ('transposed' === mapping.kind) {
        notes.push('cursor reports are column;row (transposed)');
    }
    if (norm && mapping.rowOffset) {
        notes.push(`cursor reports are offset by ${mapping.rowOffset > 0 ? '+' : ''}${mapping.rowOffset} row(s)`);
    }
    if (norm && mapping.colOffset) {
        notes.push(`cursor reports are offset by ${mapping.colOffset > 0 ? '+' : ''}${mapping.colOffset} column(s)`);
    }
    if ('constant' === mapping.kind) {
        notes.push(`every cursor report is ${mapping.value}: unusable for size or position`);
    }
    if ('none' === mapping.kind) {
        notes.push('no cursor position reports (CSI 6 n unanswered)');
    }

    //  --- per probe ---
    const probes = steps.map(step => {
        const parts = splitStep(step);
        const def = { id : step.id, complete : step.complete, ms : step.ms };
        def.replies = parts.replies.map(show);
        def.cprs = parts.probeCprs.map(c => c.raw).map(show);
        def.answered = parts.replies.length > 0 || parts.probeCprs.length > 0;
        def.printed = null;
        const probeDef = (report.probeDefs || {})[step.id];
        const moves = probeDef ? probeDef.moves : [ 'cpr-home', 'size-999' ].includes(step.id);
        if (norm && parts.after && !moves && 'baseline' !== step.id) {
            const a = norm(parts.after);
            def.printed = !(a.row === AREA_ROW && a.col === 1);
            if (def.printed) {
                def.printedCols = a.row === AREA_ROW ? a.col - 1 : null;
            }
        }
        def._parts = parts;
        return def;
    });
    const probe = Object.fromEntries(probes.map(p => [ p.id, p ]));
    const printed = probes.filter(p => p.printed).map(p => p.id);
    if (printed.length) {
        notes.push(`printed or moved the cursor: ${printed.join(', ')}`);
    }

    //  --- identity ---
    const firstMatch = (id, re) => {
        const p = probe[id];
        if (!p) {
            return null;
        }
        for (const tok of p._parts.replies) {
            const m = re.exec(tok);
            if (m) {
                return m;
            }
        }
        return null;
    };
    const daRe = /^\x1b\[([=?>]?)([0-9;]*)c$/;
    const da1m = firstMatch('da1', daRe) || firstMatch('da1-0', daRe);
    let da1 = null;
    if (da1m) {
        const parsed = parseDeviceAttributes(da1m[2]);
        da1 = { raw : show(da1m[0]), prefix : da1m[1], params : da1m[2], client : parsed.client, version : parsed.version };
        if ('?' === da1m[1] && !parsed.client) {
            const first = parseInt(da1m[2].split(';')[0], 10);
            da1.vtClass = da1m[2] === '' ? 'truncated' : (VtClass[first] || `VT (${first})`);
        }
        if ('=' === da1m[1] && da1m[2].startsWith('67;84;101;114;109')) {
            da1.ctermClass = true;      //  SyncTERM, TERMinator, RGTerm and BadTerm all send this
        }
    }
    const da2m = firstMatch('da2', /^\x1b\[>([0-9;]*)c$/);
    const da3m = firstMatch('da3', /^\x1b(?:P!\|([\s\S]*?)\x1b\\|\[=([0-9;]*)c)$/);
    const ctdaM = firstMatch('cterm-da', /^\x1b\[<([0-9;]*)c$/);
    const xtvM = firstMatch('xtversion', /^\x1bP>\|([\s\S]*?)\x1b\\$/);
    const enq = probe.enq ? probe.enq._parts.replies.filter(t => !t.startsWith(ESC)).join('') : '';
    const identity = {
        ttype       : ttypes[0] || null,
        da1,
        da2         : da2m ? da2m[1] : null,
        da3         : da3m ? (da3m[1] || da3m[2]) : null,
        ctermCaps   : ctdaM ? ctdaM[1].split(';').filter(Boolean).map(Number) : null,
        xtversion   : xtvM ? xtvM[1] : null,
        answerback  : enq || null,
    };
    if (!da1) {
        notes.push('no reply to primary DA');
    }

    //  --- size ---
    const p999 = probe['size-999'];
    const p255 = probe['size-255n'];
    const s999 = p999 ? sizeFrom(p999._parts.probeCprs[0], norm) : null;
    const s255 = p255 ? sizeFrom(p255._parts.probeCprs[0], norm) : null;
    const m18 = firstMatch('size-18t', /^\x1b\[8;([0-9]+);([0-9]+)t$/);
    const s18 = m18 ? { rows : parseInt(m18[1], 10), cols : parseInt(m18[2], 10) } : null;
    for (const [ name, s ] of [ [ 'size-999', s999 ], [ 'size-255n', s255 ] ]) {
        if (s && s.flags.includes('wrapped-256')) {
            notes.push(`${name}: a coordinate came back as 231 (999 wrapped at 256)`);
        }
        if (s && s.flags.includes('clamped-79')) {
            notes.push(`${name}: width 79 (cursor clamped at column 79)`);
        }
    }

    let recommended = { cols : 80, rows : 25, source : 'default' };
    const usable = s => s && plausible(s.cols, s.rows) && !s.flags.includes('did-not-move');
    if (naws && naws.plausible) {
        recommended = { cols : naws.width, rows : naws.height, source : 'naws' };
    } else if (usable(s255)) {
        recommended = { cols : s255.cols, rows : s255.rows, source : 'size-255n' };
    } else if (s18 && plausible(s18.cols, s18.rows)) {
        recommended = { cols : s18.cols, rows : s18.rows, source : 'size-18t' };
    } else if (s999 && !s999.flags.includes('did-not-move') && s999.rows >= 5 && s999.rows <= 200) {
        //  Each dimension on its own: Procomm Plus gives a good 24 rows and a wrapped width.
        const cols = plausible(s999.cols, s999.rows) ? s999.cols : 80;
        recommended = { cols : 79 === cols ? 80 : cols, rows : s999.rows, source : 'size-999' };
    }

    for (const p of probes) {
        delete p._parts;
    }

    return {
        label       : report.label || null,
        telnet      : { ttypes, naws, environ },
        cpr         : mapping,
        identity,
        size        : { naws : naws && { cols : naws.width, rows : naws.height }, 'size-999' : s999, 'size-255n' : s255, 'size-18t' : s18, recommended },
        probes,
        notes,
    };
}

//  A few lines for the terminal itself, ASCII only and under 80 columns.
function summaryLines(summary) {
    const id = summary.identity;
    const who = id.da1 && id.da1.client
        ? `${id.da1.client}${id.da1.version ? ` ${id.da1.version}` : ''}`
        : (id.da1 && id.da1.vtClass) || 'unidentified';
    const r = summary.size.recommended;
    const lines = [
        `Terminal: ${who}   TTYPE: ${summary.telnet.ttypes.join(', ') || '(none)'}`,
        `Size: ${r.cols}x${r.rows} (from ${r.source})   Cursor reports: ${summary.cpr.kind}`,
    ];
    for (const n of summary.notes.slice(0, 6)) {
        lines.push(`- ${n}`.slice(0, 79));
    }
    return lines;
}

module.exports = {
    analyze,
    summaryLines,
    show,
};
