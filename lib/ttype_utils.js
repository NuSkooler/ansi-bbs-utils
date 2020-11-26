const isXTermVariant = (ttype) => {
    return ttype.startsWith('xterm-');
};

const isTruecolorVariant = (ttype) => {
    return ttype.endsWith('-truecolor');
};

const is256ColorVariant = (ttype) => {
    return ttype.endsWith('-256color');
};

const TermTypeAliases = {
    ansi                : 'ansi-bbs',
    pcansi              : 'ansi-bbs',
    syncterm            : 'cterm',
    'xterm-color'       : 'xterm',
    'xterm-16color'     : 'xterm',
    'vt100-256color'    : 'xterm-256color', //  see https://tintin.mudhalla.net/protocols/mtts/

    //  NetRunner
    'ansi-256color'     : 'ansi-bbs-256color',

    //  scoansi
    //  qansi
    //  'linux', 'screen', 'dumb', 'rxvt', 'konsole', 'gnome', 'x11 terminal emulator'
};

exports.normalizedTermType = (ttype) => {
    const alias = TermTypeAliases[ttype];
    if (alias) {
        return alias;
    }

    //  Various xxxx-truecolor -> xterm-truecolor
    if (isTruecolorVariant(ttype)) {
        return 'xterm-truecolor';
    }

    //  Various xxxx-256color -> xterm-256color
    if (is256ColorVariant(ttype)) {
        return 'xterm-256color';
    }

    //  Any other xterm-xxxx -> xterm
    if (isXTermVariant(ttype)) {
        return 'xterm';
    }

    //  Anything else: as-is
    return ttype;
}
