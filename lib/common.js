exports.CSI = '\u001b[';

//  used for methods to return a sequence string
//  vs writing to output/returning this
exports.AsSequence = Symbol('AsSeq');

exports.wantAsSequence = (...args) => {
    const asSequence = (args[args.length - 1] === exports.AsSequence);
    return asSequence ? exports.AsSequence : false;
}
