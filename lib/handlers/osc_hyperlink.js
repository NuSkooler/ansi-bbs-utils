const { CSI } = require('../common');

module.exports = class OSCHyperlink {
    //  https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
    //  supported by a number of terminals, but still an outsider
    hyperlink(url, text='') {
        return `${CSI}8;;${url}${text}\u001b\\${text||url}${CSI}8;;\u001b\\`;
    }
};