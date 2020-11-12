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
    ansi : [
        'cp437',
        'ansi-bbs',
    ],
    'ansi-bbs' : [
        'cp437',
        'ansi-bbs',
    ],
    pcansi : [
        'cp437',
        'ansi-bbs',
    ],
    qansi : [
        'cp437',
        'ansi-bbs',
    ],
    scoansi : [
        'cp437',
        'ansi-bbs',
    ],
    syncterm : [
        'cp437',
        'ansi-bbs',
        'cterm-fonts',
        'cterm-baud',
    ],
    xterm : [
        'utf8',
        'ansi-bbs',
        'xterm',
    ],
    'xterm-256color' : [
        'utf8',
        'ansi-bbs',
        'xterm',
        'xterm-256',
    ],
    'xterm-16color' : [
        'utf8',
        'ansi-bbs',
        'xterm',
    ],
    'xterm-color' : [
        'utf8',
        'ansi-bbs',
        'xterm',
    ],

    //  :TODO: 'linux', 'screen', 'dumb', 'rxvt', 'konsole', 'gnome', 'x11 terminal emulator'
}