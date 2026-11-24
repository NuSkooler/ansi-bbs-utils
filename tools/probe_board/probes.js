'use strict';

//
//  The probes the board sends, in order.
//
//  Each probe is written on its own line of the probe area, followed by
//  two cursor position reports (CPR, CSI 6 n):
//
//      CSI <AREA_ROW>;1 H  CSI K  <probe>  CSI 6 n  CSI 2;7 H  CSI 6 n
//                                          '-after-'          '-sentinel-'
//
//  The "after" report shows where the probe left the cursor, so a probe
//  the terminal printed as text shows up as a moved cursor. The sentinel
//  marks the end of the probe's replies: any reply before the after report
//  belongs to this probe, so a late reply can't be taken for the next
//  probe's answer. The sentinel is at row 2, column 7 (row != column) so a
//  terminal that reports column;row can be told from one that doesn't.
//
//  Fields:
//  - id:     stable name, used in reports and fixtures
//  - send:   the bytes (latin1)
//  - cprs:   how many CPR-shaped replies (CSI ... R) the probe itself may
//            produce, so the runner knows when the step is complete
//  - moves:  true when the probe moves the cursor on purpose (the after
//            report then says nothing about printing)
//  - risk:   'safe'  standard CSI; terminals that don't know it ignore it
//            'print' known to be printed, or acted on, by some terminals
//                    (APC, OSC, ENQ, DCS-style replies); sent last and
//                    skipped with --safe
//  - about:  one line for humans
//

const ESC = '\u001b';
const CSI = `${ESC}[`;

const AREA_ROW = 4;
const SENTINEL = { row : 2, col : 7 };

const Probes = [
    //  No probe: the two reports alone. Establishes CPR support, row/column
    //  offsets and transposition, against which every other step is read.
    { id : 'baseline',      send : '',                      cprs : 0, moves : false, risk : 'safe',
        about : 'CPR support, offsets and transposition (no probe)' },
    { id : 'cpr-home',      send : `${CSI}1;1H${CSI}6n`,    cprs : 1, moves : true,  risk : 'safe',
        about : 'CPR at home: 1;1, or 2;1 under a menu bar' },

    { id : 'da1',           send : `${CSI}c`,               cprs : 0, moves : false, risk : 'safe',
        about : 'Primary DA: identifies CTerm, IcyTerm, VTX; VT level otherwise' },
    { id : 'da1-0',         send : `${CSI}0c`,              cprs : 0, moves : false, risk : 'safe',
        about : 'Primary DA in the CSI 0 c form ENiGMA sends' },
    { id : 'da2',           send : `${CSI}>c`,              cprs : 0, moves : false, risk : 'safe',
        about : 'Secondary DA: xterm-family version' },
    { id : 'da3',           send : `${CSI}=c`,              cprs : 0, moves : false, risk : 'safe',
        about : 'Tertiary DA (DECRPTUI); also CTerm-adjacent private form' },
    { id : 'cterm-da',      send : `${CSI}<c`,              cprs : 0, moves : false, risk : 'safe',
        about : 'CTerm capability DA (CSI < 0 ; Ps... c)' },
    { id : 'dsr-status',    send : `${CSI}5n`,              cprs : 0, moves : false, risk : 'safe',
        about : 'Device status: CSI 0 n when OK' },

    { id : 'size-999',      send : `${CSI}999;999H${CSI}6n`, cprs : 1, moves : true,  risk : 'safe',
        about : 'Size by moving to 999;999 and asking where the cursor is' },
    { id : 'size-255n',     send : `${CSI}255n`,            cprs : 1, moves : false, risk : 'safe',
        about : 'Size by the ANSI-BBS CSI 255 n extension (answered as a CPR)' },
    { id : 'size-18t',      send : `${CSI}18t`,             cprs : 0, moves : false, risk : 'safe',
        about : 'Size by XTWINOPS 18 t (CSI 8 ; rows ; cols t)' },
    { id : 'decxcpr',       send : `${CSI}?6n`,             cprs : 1, moves : false, risk : 'safe',
        about : 'Extended CPR (CSI ? row ; col [; page] R)' },

    { id : 'cterm-font-state', send : `${CSI}=1n`,          cprs : 0, moves : false, risk : 'safe',
        about : 'CTerm font state report (CSI = 1 ; ... n)' },
    { id : 'cterm-mode',    send : `${CSI}=2n`,             cprs : 0, moves : false, risk : 'safe',
        about : 'CTerm mode report (CSI = 2 ; ... n)' },
    { id : 'cterm-cell',    send : `${CSI}=3n`,             cprs : 0, moves : false, risk : 'safe',
        about : 'CTerm character cell size (CSI = 3 ; h ; w n)' },
    { id : 'cterm-6n',      send : `${CSI}=6n`,             cprs : 0, moves : false, risk : 'safe',
        about : 'CSI = 6 n, which ENiGMA sends (SyncTERM answers =6;1n)' },

    { id : 'font-select',   send : `${CSI}0;0 D`,           cprs : 0, moves : false, risk : 'safe',
        about : 'CTerm font select (CSI 0 ; 0 SP D): printed by terminals that do not parse it' },

    { id : 'xtversion',     send : `${CSI}>0q`,             cprs : 0, moves : false, risk : 'print',
        about : 'XTVERSION: tells SyncTERM, TERMinator, RGTerm and BadTerm apart (DCS > | ... ST)' },
    { id : 'osc-fg',        send : `${ESC}]10;?${ESC}\\`,   cprs : 0, moves : false, risk : 'print',
        about : 'OSC 10 foreground colour query (xterm family)' },
    { id : 'apc-empty',     send : `${ESC}_${ESC}\\`,       cprs : 0, moves : false, risk : 'print',
        about : 'An empty APC string: shows whether APC is swallowed or printed' },
    { id : 'enq',           send : '\u0005',                cprs : 0, moves : false, risk : 'print',
        about : 'ENQ answerback (PuTTY answers, per its docs)' },
];

function frame(probe) {
    return `${CSI}${AREA_ROW};1H${CSI}K${probe.send}${CSI}6n${CSI}${SENTINEL.row};${SENTINEL.col}H${CSI}6n`;
}

module.exports = {
    Probes,
    AREA_ROW,
    SENTINEL,
    frame,
};
