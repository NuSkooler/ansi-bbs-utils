//
//  Device Attributes (DA) replies identify the remote terminal client.
//
//  A terminal answers CSI c (or CSI < c for CTerm's own variant) with
//  CSI [=?<>] p1 ; p2 ; ... c. The parameter list is what we match on:
//
//  - CTerm/SyncTERM: CSI = 67;84;101;114;109 ; <revision> c
//    ("CTerm" as ASCII codes, then the revision with dots as semicolons,
//    e.g. 1;332 for revision 1.332). A fork appends further components.
//    See https://syncterm.bbsdev.net/cterm.html
//
//  - IcyTerm: CSI = 73;99;121;84;101;114;109 ; <version> c
//    ("IcyTerm" as ASCII codes, then version information).
//    See https://github.com/mkrueger/icy_tools
//
//  - VTX: CSI ? 50;86;84;88 c
//    See https://github.com/codewar65/VTX_ClientServer/blob/master/vtx.txt
//
//  - Arctel (Irssi ConnectBot on Android): CSI ? 63;1;2 c
//    https://web.archive.org/web/20190828112223/http://www.fbl.cz/arctel/download/techman.pdf
//
//  One home for this table, so hosts stop carrying their own copy of it.
//

const ExactMatches = {
    '63;1;2'        : 'arctel',
    '50;86;84;88'   : 'vtx',
};

const PrefixMatches = [
    { prefix : '67;84;101;114;109',        client : 'cterm' },
    { prefix : '73;99;121;84;101;114;109', client : 'icy_term' },
];

const isNumericPart = (part) => /^(?:0|[1-9][0-9]*)$/.test(part);

//
//  Parse the parameter list of a DA reply (the text between the
//  private prefix and the final 'c', e.g. '67;84;101;114;109;1;332').
//
//  Returns { client, version, ctermVersion }:
//  - client: a known client name, or null
//  - version: the client's version with dots ('1.332'), or null when
//    the reply carried none or it was not numeric
//  - ctermVersion: the same as version for CTerm-compatible clients
//    that report a CTerm revision, else null
//
function parseDeviceAttributes(paramString) {
    const result = { client : null, version : null, ctermVersion : null };

    if ('string' !== typeof(paramString) || !paramString.length) {
        return result;
    }

    const exact = ExactMatches[paramString];
    if (exact) {
        result.client = exact;
        return result;
    }

    for (const { prefix, client } of PrefixMatches) {
        if (paramString === prefix || paramString.startsWith(`${prefix};`)) {
            result.client = client;

            const rest = paramString.slice(prefix.length + 1);
            const parts = rest ? rest.split(';') : [];
            if (parts.length && parts.every(isNumericPart)) {
                result.version = parts.join('.');
                if ('cterm' === client) {
                    result.ctermVersion = result.version;
                }
            }
            return result;
        }
    }

    return result;
}

module.exports = {
    parseDeviceAttributes,
};
