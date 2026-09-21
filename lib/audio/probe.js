//
//  Capability probes. These need the terminal's input side wired
//  (the host feeds inbound bytes through terminal.feed()); without
//  it every probe simply times out to "no".
//

const { AsSequence } = require('../common');
const { awaitReply, isCTermReport } = require('./replies');
const { resolveFormat, revisionAtLeast, Revisions } = require('./formats');

const DefaultTimeout = 2000;

//  Clients known to speak the CTerm audio APC, or to be CTerm
const CTermClients = new Set([ 'cterm', 'icy_term' ]);

//
//  Ask for the libsndfile feature. Any reply at all means the audio
//  APC exists (Synth works without a decoder); 1 means files decode.
//
//  Sets 'cterm-audio' and, with a decoder, 'cterm-audio-files' on
//  this terminal only.
//
//  A terminal already identified as some other client (VTX, Arctel)
//  is not asked unless |force| is set: not every terminal ignores an
//  unknown APC cleanly.
//
//  -> { backend: 'cterm' | 'none', files, client, ctermVersion }
//
async function probeAudio(terminal, { timeout = DefaultTimeout, force = false } = {}) {
    const result = {
        backend         : 'none',
        files           : false,
        client          : terminal.termClient,
        ctermVersion    : terminal.ctermVersion || null,
    };

    if (!force && 'unknown' !== terminal.termClient && !CTermClients.has(terminal.termClient)) {
        return result;
    }

    const answer = await awaitReply(
        terminal,
        'report',
        payload => isCTermReport(payload) && 100 === payload.params[1] ? payload.params[2] : undefined,
        timeout,
        () => terminal.sendSequence(terminal.cterm.queryLibsndfile(AsSequence))
    );

    if (undefined === answer) {
        return result;
    }

    result.backend = 'cterm';
    result.files = 1 === answer;

    terminal.addCapability('cterm-audio');
    if (result.files) {
        terminal.addCapability('cterm-audio-files');
    }

    return result;
}

//
//  Can this terminal's decoder read a container/codec pair?
//
//  -> true | false | undefined (cannot ask: no decoder, or a CTerm
//     revision without the query, or no answer)
//
async function queryFormatSupport(terminal, container, codec, { timeout = DefaultTimeout } = {}) {
    if (!terminal.hasCapability('cterm-audio-files')) {
        return undefined;
    }
    if (terminal.ctermVersion && !revisionAtLeast(terminal.ctermVersion, Revisions.formatQuery)) {
        return undefined;
    }

    const [ major, subtype ] = resolveFormat(container, codec);

    const answer = await awaitReply(
        terminal,
        'report',
        payload => {
            const p = payload.params;
            return isCTermReport(payload) && 101 === p[1] && major === p[2] && subtype === p[3] ? p[4] : undefined;
        },
        timeout,
        () => terminal.sendSequence(terminal.cterm.queryFormat(major, subtype, AsSequence))
    );

    return undefined === answer ? undefined : 1 === answer;
}

module.exports = {
    probeAudio,
    queryFormatSupport,
    CTermClients,
    DefaultTimeout,
};
