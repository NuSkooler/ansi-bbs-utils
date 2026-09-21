//
//  libsndfile format identifiers as CTerm's format query wants them:
//
//      pm = (SF_INFO.format & SF_FORMAT_TYPEMASK) >> 16    (container)
//      ps =  SF_INFO.format & SF_FORMAT_SUBMASK            (codec)
//
//  Copied from cterm.html's registry (itself copied from the libsndfile
//  headers). Any other numeric value is passed through untouched.
//

const Container = {
    wav     : 1,
    voc     : 8,
    flac    : 23,
    ogg     : 32,
    mpeg    : 35,
};

const Codec = {
    pcm16   : 2,
    float   : 6,
    vorbis  : 96,
    opus    : 100,
    mp3     : 130,      //  SF_FORMAT_MPEG_LAYER_III
};

//  Convenience names for the pairs a BBS is likely to ask about
const Named = {
    'ogg/vorbis'    : [ Container.ogg, Codec.vorbis ],
    'ogg/opus'      : [ Container.ogg, Codec.opus ],
    'wav/pcm16'     : [ Container.wav, Codec.pcm16 ],
    'flac/pcm16'    : [ Container.flac, Codec.pcm16 ],
    'mpeg/mp3'      : [ Container.mpeg, Codec.mp3 ],
};

//  CTerm revisions that introduced things we care about
const Revisions = {
    blobVerbs   : '1.329',  //  LoadBlob and friends
    formatQuery : '1.331',  //  SyncTERM:Q;libsndfileFormat
};

const resolveOne = (value, table, what) => {
    if (Number.isInteger(value) && value >= 0) {
        return value;
    }
    if ('string' === typeof(value) && Object.prototype.hasOwnProperty.call(table, value.toLowerCase())) {
        return table[value.toLowerCase()];
    }
    throw new RangeError(`unknown ${what} ${JSON.stringify(value)}; use one of ${Object.keys(table).join(', ')} or a libsndfile id`);
};

//
//  resolveFormat('ogg', 'vorbis') / resolveFormat('ogg/vorbis') /
//  resolveFormat(32, 96) -> [ 32, 96 ]
//
function resolveFormat(container, codec) {
    if (undefined === codec && 'string' === typeof(container) && container.includes('/')) {
        const named = Named[container.toLowerCase()];
        if (named) {
            return named.slice();
        }
        [ container, codec ] = container.split('/');
    }
    return [ resolveOne(container, Container, 'container'), resolveOne(codec, Codec, 'codec') ];
}

//  '1.332' vs '1.331' -> 1; equal -> 0; missing parts count as 0
function compareRevisions(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; ++i) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) {
            return d < 0 ? -1 : 1;
        }
    }
    return 0;
}

function revisionAtLeast(version, minimum) {
    return compareRevisions(version, minimum) >= 0;
}

module.exports = {
    Container,
    Codec,
    Named,
    Revisions,
    resolveFormat,
    compareRevisions,
    revisionAtLeast,
};
