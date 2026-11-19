// sources.js — where the platform code comes from: git clones of the
// org's repos over ssh (sibling folders, so their relative symlinks
// resolve), ducky-secrets among them; `ducky update` pulls. One install
// for everyone (plan_0013): the machine's GitHub ssh key is the only
// credential (05a_github).

let crypto = require('crypto')
let fs     = require('fs')
let path   = require('path')

let config = require('./config')
let util   = require('./util')

// ---

/**
 * The sha256 of a file.
 *
 * @param   {string} file - Absolute path
 * @returns {string} Hex digest
 */
function getSha(file) {

    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

}

/**
 * The repos that are not cloned yet.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {array} Repo entries
 */
function getMissingClones(paths) {

    return config.repos.filter(function(item) {

        return !fs.existsSync(path.join(paths.repos, item.name, '.git'))

    })

}

/**
 * Clones one repo over ssh (or from `clone_base`, a local folder holding
 * the repos under the same names: tests, a machine without GitHub yet).
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @param   {object} item     - Repo entry
 * @returns {object} exec result
 */
function clone(settings, paths, item) {

    let source = settings.clone_base
        ? path.join(settings.clone_base, item.name)
        : 'git@github.com:' + settings.github_org + '/' + item.remote + '.git'

    fs.mkdirSync(paths.repos, { recursive : true })

    return util.exec('git', ['clone', '--quiet', source, path.join(paths.repos, item.name)], {
        env     : { GIT_SSH_COMMAND : 'ssh -o StrictHostKeyChecking=accept-new', GIT_TERMINAL_PROMPT : '0' },
        timeout : 30 * 60 * 1000
    })

}

module.exports = {
    clone,
    getMissingClones,
    getSha
}
