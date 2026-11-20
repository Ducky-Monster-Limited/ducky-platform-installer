// 03_packages.js — the toolchain from Homebrew. mongodb-community only when
// no mongod is installed or running: an existing mongod is reused as it
// is (config, dbpath and data never touched, stopped or migrated).
// node is nvm's 26 (plan_0016, as the cloud images): nvm is installed
// when missing, an older node is never used.

let fs   = require('fs')
let os   = require('os')
let path = require('path')

let util = require('../util')

// ---

let node_major  = 26
let nvm_version = 'v0.40.8'

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
 * The nvm folder (NVM_DIR, else ~/.nvm).
 *
 * @returns {string} The folder
 */
function getNvmDir() {

    return process.env.NVM_DIR || path.join(os.homedir(), '.nvm')

}

/**
 * The node to run the platform with: major 26, as the cloud images. nvm's
 * newest 26 first, then the PATH's node when it is a 26; an older node is
 * refused.
 *
 * @returns {(string|null)} Its path
 */
function getNode() {

    let dir        = path.join(getNvmDir(), 'versions', 'node')
    let candidates = []
    let found      = null

    try {
        candidates = fs.readdirSync(dir).filter(function(name) {

            return new RegExp('^v' + node_major + '\\.').test(name)

        }).sort(function(a, b) {

            return b.localeCompare(a, 'en', { numeric : true })

        }).map(function(name) {

            return path.join(dir, name, 'bin', 'node')

        })
    } catch (e) {
        candidates = []
    }

    candidates.push(util.getWhich('node'))

    candidates.filter(Boolean).forEach(function(bin) {

        if (!found && isNode(bin)) found = bin

    })

    return found

}

/**
 * Whether a node binary is the platform's major (26).
 *
 * @param   {string}  bin - The node
 * @returns {boolean} True when it runs and is a 26
 */
function isNode(bin) {

    let result = bin && fs.existsSync(bin) ? util.exec(bin, ['-v']) : null

    return !!result && result.code === 0 && new RegExp('^v' + node_major + '\\.').test(result.out.trim())

}

/**
 * Installs node 26 through nvm, nvm first when it is missing (its own
 * install script, pinned, no shell profile touched).
 *
 * @returns {object} { detail, ok }
 */
function newNode() {

    let nvm    = path.join(getNvmDir(), 'nvm.sh')
    let result = null

    if (!fs.existsSync(nvm)) {

        result = util.exec('/bin/bash', ['-c', 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/' + nvm_version + '/install.sh | PROFILE=/dev/null bash'], { inherit : true, timeout : 10 * 60 * 1000 })

        if (result.code !== 0 || !fs.existsSync(nvm)) return { detail : 'nvm install exited ' + result.code, ok : false }

    }

    result = util.exec('/bin/bash', ['-c', 'source "' + nvm + '" && nvm install ' + node_major], { env : { NVM_DIR : getNvmDir() }, inherit : true, timeout : 30 * 60 * 1000 })

    return result.code === 0 && getNode() ? { detail : 'node ' + node_major + ' (nvm)', ok : true } : { detail : 'nvm install ' + node_major + ' exited ' + result.code, ok : false }

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

    if (!getMongod()) missing.push('mongodb/brew/mongodb-community')

    return missing

}

module.exports = {
    getMongod,
    getNode,
    isNode,
    node_major,
    key   : 'packages',
    sudo  : false,
    title : 'toolchain (nvm: node 26; brew: redis, ffmpeg, mkcert, python 3.11, nginx, mongodb only if none)',
    apply : function(ctx) {

        let missing = getMissing()
        let result  = missing.length ? util.exec('brew', ['install'].concat(missing), { inherit : true, timeout : 60 * 60 * 1000 }) : { code : 0 }
        let node    = getNode() ? { ok : true } : newNode()

        // IMPORTANT
        // the run's node follows at once: npm, migrations, config and the
        // agents of this run use the 26
        if (node.ok && ctx && ctx.settings) ctx.settings.node = getNode()

        if (result.code !== 0) return { detail : 'brew install ' + missing.join(' ') + ' exited ' + result.code, ok : false }
        if (!node.ok) return node

        return { detail : (missing.length ? 'brew install ' + missing.join(' ') + ', ' : '') + 'node ' + getNode(), ok : true }

    },
    check : function() {

        let missing = getMissing()
        let todo    = missing.length ? ['brew install ' + missing.join(' ')] : []

        if (!getNode()) todo.push('nvm install ' + node_major)

        return todo.length ? { detail : todo.join(', '), ok : false } : { detail : 'all present, node ' + getNode() + ' (mongod reused as it is)', ok : true }

    }
}
