// 01_platform.js — macOS on Apple silicon with the Xcode command line tools.

let os = require('os')

let util = require('../util')

// ---

module.exports = {
    key   : 'platform',
    sudo  : false,
    title : 'macOS arm64 + Xcode command line tools',
    apply : function() {

        util.exec('/usr/bin/xcode-select', ['--install'])

        return { detail : 'the Xcode tools installer opened: finish it, then run `ducky-pro install` again', ok : false }

    },
    check : function() {

        if (os.platform() !== 'darwin' || os.arch() !== 'arm64') return { detail : 'needs macOS on Apple silicon, this is ' + os.platform() + ' ' + os.arch(), fatal : true, ok : false }
        if (util.exec('/usr/bin/xcode-select', ['-p']).code !== 0) return { detail : 'xcode-select --install', ok : false }

        return { detail : 'macOS ' + os.release() + ', arm64, Xcode tools', ok : true }

    }
}
