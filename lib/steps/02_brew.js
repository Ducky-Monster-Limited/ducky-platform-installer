// 02_brew.js — Homebrew (its official install script, asked).

let util = require('../util')

// ---

module.exports = {
    key   : 'brew',
    sudo  : false,
    title : 'Homebrew',
    apply : function() {

        let result = util.exec('/bin/bash', ['-c', '$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)'], { inherit : true })

        return { detail : 'Homebrew install script exited ' + result.code, ok : result.code === 0 }

    },
    check : function() {

        let brew = util.getWhich('brew')

        return brew ? { detail : brew, ok : true } : { detail : 'the official Homebrew install script (brew.sh)', ok : false }

    }
}
