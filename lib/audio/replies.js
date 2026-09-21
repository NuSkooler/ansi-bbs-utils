//
//  Ask the terminal something and wait for the matching reply on the
//  terminal's input side, with a timeout. Resolves with whatever the
//  matcher returns for the first payload it accepts, or undefined on
//  timeout. Never rejects for lack of an answer: silence is an answer
//  ("not supported").
//
//  |send| is called after the listener is in place, so a reply can
//  never race the wait. It may return a promise (sendSequence()); a
//  send that fails resolves the wait with undefined at once rather
//  than sitting out the timeout on a dead socket. A synchronous throw
//  from |send| (argument validation) propagates to the caller.
//
//  The timer is deliberately not unref'd: a caller is awaiting this.
//

function awaitReply(terminal, event, match, timeout, send) {
    return new Promise(resolve => {
        let timer = null;

        const done = value => {
            terminal.removeListener(event, listener);
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            resolve(value);
        };

        const listener = payload => {
            const value = match(payload);
            if (undefined !== value) {
                done(value);
            }
        };

        terminal.on(event, listener);

        if (timeout > 0) {
            timer = setTimeout(() => done(undefined), timeout);
        }

        let sent;
        try {
            sent = send();
        } catch (e) {
            done(undefined);
            throw e;
        }

        if (sent && 'function' === typeof(sent.then)) {
            sent.then(null, () => done(undefined));
        }
    });
}

//  CTerm reports: CSI = 7 ; ... n
const isCTermReport = payload => '=' === payload.prefix && 7 === payload.params[0];

module.exports = {
    awaitReply,
    isCTermReport,
};
