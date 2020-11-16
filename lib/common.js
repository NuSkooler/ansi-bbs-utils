exports.CSI = '\u001b[';

exports.addOutputSequenceMethods = (src, dst) => {
    Object.keys(src).forEach(shortName => {
        dst[shortName] = (...args) => {
            const code = src[shortName];
            return `${exports.CSI}${args.join(';')}${code}`;
        }
    });
};
