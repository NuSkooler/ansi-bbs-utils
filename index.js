exports.Terminal = require('./lib/terminal');
exports.Common = require('./lib/common');
exports.ReplyParser = require('./lib/input/reply_parser');
exports.DeviceAttributes = require('./lib/device_attrs');

const { AudioSession, Asset, Handle, Backends } = require('./lib/audio/session');
exports.Audio = {
    AudioSession,
    Asset,
    Handle,
    Backends,
    Formats     : require('./lib/audio/formats'),
    probeAudio  : require('./lib/audio/probe').probeAudio,
    queryFormatSupport : require('./lib/audio/probe').queryFormatSupport,
};

exports.Testing = {
    FakeCTerm : require('./lib/testing/fake_cterm'),
};
