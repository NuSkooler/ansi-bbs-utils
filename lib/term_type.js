exports.isXTermVariant = (ttype) => {
    if (ttype.startsWith('xterm')) {
        return true;
    }

    return false;
};

exports.isXTerm256ColorVariant = (ttype) => {
    return ttype.endsWith('-256color') || ttype.endsWith('-truecolor');
};
