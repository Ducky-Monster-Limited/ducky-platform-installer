// 03_packages.js — the toolchain from Homebrew. mongodb-community only when
// no mongod is installed or running: an existing mongod is reused as it
// is (config, dbpath and data never touched, stopped or migrated).
// whisper-cpp is not here: it is optional (08_whisper, opt-in).

let util = require('../util')

// ---

let packages = [
    { bin : 'git',         formula : 'git' },
    { bin : 'redis-server', formula : 'redis' },
    { bin : 'ffmpeg',      formula : 'ffmpeg' },
    { bin : 'mkcert',      formula : 'mkcert' },
    { bin : 'python3.11',  formula : 'python@3.11' },
    { bin : 'nginx',       formula : 'nginx' },
    { bin : 'sops',        formula : 'sops' },
    { bin : 'age',         formula : 'age' }
]

/**
 * Whether a mongod exists (binary) or runs (process).
 *
 * @returns {boolean} True when one does
 */
function getMongod() {

    return !!util.getWhich('mongod') || util.exec('/usr/bin/pgrep', ['-x', 'mongod']).code === 0

}

/**
 * The node to run the platform with: major 20, as the cloud images.
 *
 * @returns {(string|null)} Its path
 */
function getNode() {

    let candidates = [util.getWhich('node'), '/opt/homebrew/opt/node@20/bin/node'].filter(Boolean)
    let found      = null

    candidates.forEach(function(bin) {

        let result = util.exec(bin, ['-v'])

        if (!found && result.code === 0 && /^v20\./.test(result.out.trim())) found = bin

    })

    return found

}

/**
 * What is missing.
 *
 * @returns {array} Formulas
 */
function getMissing() {

    let missing = packages.filter(function(item) {

        return !util.getWhich(item.bin)

    }).map(function(item) {

        return item.formula

    })

    if (!getNode()) missing.push('node@20')
    if (!getMongod()) missing.push('mongodb/brew/mongodb-community')

    return missing

}

module.exports = {
    getMongod,
    getNode,
    key   : 'packages',
    sudo  : false,
    title : 'toolchain (brew: node 20, redis, ffmpeg, mkcert, python 3.11, nginx, mongodb only if none)',
    apply : function() {

        let missing = getMissing()
        let result  = util.exec('brew', ['install'].concat(missing), { inherit : true, timeout : 60 * 60 * 1000 })

        return { detail : 'brew install ' + missing.join(' ') + ' exited ' + result.code, ok : result.code === 0 }

    },
    check : function() {

        let missing = getMissing()

        return missing.length ? { detail : 'brew install ' + missing.join(' '), ok : false } : { detail : 'all present (mongod reused as it is)', ok : true }

    }
}
