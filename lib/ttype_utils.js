const isXTermVariant = (ttype) => {
    if (ttype.startsWith('xterm')) {
        return true;
    }

    return false;
};

const isXTerm256ColorVariant = (ttype) => {
    return ttype.endsWith('-256color') || ttype.endsWith('-truecolor');
};

const TermTypeAliases = {
    ansi            : 'ansi-bbs',
    pcansi          : 'ansi-bbs',
    syncterm        : 'cterm',
    'xterm-color'   : 'xterm',
    'xterm-16color' : 'xterm',

    //  scoansi
    //  qansi
    //  'linux', 'screen', 'dumb', 'rxvt', 'konsole', 'gnome', 'x11 terminal emulator'
};

exports.normalizedTermType = (ttype) => {
    if (isXTerm256ColorVariant(ttype)) {
        return 'xterm-256-color';
    }

    if (isXTermVariant(ttype)) {
        return 'xterm';
    }

    return TermTypeAliases[ttype] || ttype;
}
