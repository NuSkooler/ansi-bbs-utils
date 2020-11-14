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
    cterm : {
        encoding : 'cp437',
        capabilities : [
            'ansi-bbs',
            'cterm',
        ],
        capHandlers : {
            font    : 'cterm',
            baud    : 'cterm',
        }
    },
    xterm : {
        encoding : 'utf8',
        capabilities : [
            'ansi-bbs',
            'xterm',
        ],
        capHandlers : {
            hyperlink : 'xterm',
        }
    },
    'xterm-256-color' : {
        encoding : 'utf8',
        capabilities : [
            'ansi-bbs',
            'xterm',
            'xterm-256',
        ],
        capHandlers : {
            hyperlink   : 'xterm',
            rgb256      : 'xterm-256',
        }
    },
    vtx : {
        encoding : 'cp437',
        capabilities : [
            'ansi-bbs',
            'vtx',
        ],
        capHandlers : {
            hyperlink : 'vtx',
            audio     : 'vtx',
            font      : 'cterm',
        }
    }
};
