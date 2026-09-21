//
//  Terminal Capabilities:
//  ----------------------
//
//  NOTE: Not to be confused with *nix style termcaps!
//
//  General:
//
//  - ansi-bbs: ANSI-BBS semi-standard sequences.
//
//  - cterm-baud: cterm.txt/SyncTERM style baud rate emulation.
//
//  - cterm-fonts: cterm.txt/SyncTERM style font support.
//
//  - xterm: X term sequences.
//    https://mudhalla.net/tintin/info/xterm/
//
//  - xterm-256: X term style 256 color support.
//    https://tintin.sourceforge.io/info/256color/
//
//  - vtx-hyperlink
//  - vtx-audio
//
//  Encoding:
//
//  - cp437: Supports CP437 encoding.
//
//  - utf8: Supports UTF-8 encoding.
//
//  The following table maps terminal types (ttype)
//  to capabilities. This list is built from various
//  resources, observations, etc. and is certainly
//  not perfect.
//
//  Keys are *normalized* terminal types: see ttype_utils.js
//  for how raw TTYPE values such as 'syncterm' or
//  'screen-256color' map onto them.
//
//  A Terminal takes its own copy of an entry. Never mutate
//  this table at runtime; per-session capabilities belong
//  on the Terminal instance.
//
//
//  Terminal Behavior:
//  * https://docs.google.com/spreadsheets/d/1kCNhJEF3OsP_qyl8-dGNl7yu30padvdo_Crk_0bE-_4/
//
//  Colors
//  * https://tintin.sourceforge.io/info/256color/
//  * https://tintin.mudhalla.net/protocols/mtts/

//
//  Various Terminal TTYPE Values
//  (including aliases not listed in capability table)
//
//  ttype               | Terminal
//  --------------------+--------------
//  xterm               | Many many Linux terminals
//  xterm               | PuTTY
//  syncterm            | SyncTERM
//  ansi-bbs            | fTelnet
//  pcansi              | ZOC
//  screen              | ConnectBot (Android)
//  linux               | JuiceSSH
//  ansi-bbs-256color   | NetRunner
//


module.exports = {
    'ansi-bbs' : {
        encoding : 'cp437',
        capabilities : [
            'ansi-bbs',
        ],
        capHandlers : {
            //  Just assume ANSI-BBS terminals have some of these
            //  abilities. Generally no harm at all. A few terms
            //  do (wrongly) show unknown ESC sequences however.
            font    : 'cterm',
            baud    : 'cterm',
        }
    },

    //  ANSI-BBS variant with 256 color support
    //  e.g. modern BBSes supporting a semi-standard
    'ansi-bbs-256color' : {
        encoding    : 'cp437',
        capabilities : [
            'ansi-bbs',
            '8bit-color',
        ],
        capHandlers : {
            font    : 'cterm',
            baud    : 'cterm',
        }
    },

    cterm : {
        encoding : 'cp437',
        capabilities : [
            'ansi-bbs',
            'cterm',
            '8bit-color',
            '24bit-color',
        ],
        capHandlers : {
            font    : 'cterm',
            baud    : 'cterm',
        }
    },

    //  The most basic xterm
    xterm : {
        encoding : 'utf8',
        capabilities : [
            'ansi-bbs',
            'xterm',
            '8bit-color',
            '24bit-color',
            'ecma-48',
        ],
        capHandlers : {
        }
    },

    //  xterm with the addition of 8-bit/256 color support
    'xterm-256color' : {
        encoding : 'utf8',
        capabilities : [
            'ansi-bbs',
            'xterm',
            '8bit-color',
            'ecma-48',
        ],
        capHandlers : {
        }
    },

    //  xterm with the addition of 24-bit/truecolor support
    'xterm-truecolor' : {
        encoding : 'utf8',
        capabilities : [
            'ansi-bbs',
            'xterm',
            '8bit-color',
            '24bit-color',
            'ecma-48',
        ],
        capHandlers : {
        }
    },

    vtx : {
        encoding : 'cp437',
        capabilities : [
            'ansi-bbs',
            'vtx',
            '8bit-color',
            '24bit-color',
            'ecma-48',
        ],
        capHandlers : {
            hyperlink   : 'vtx',
            audio       : 'vtx',
            font        : 'cterm',
        }
    }
};
