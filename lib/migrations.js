// migrations.js — the api's local migrations: ordered, idempotent node
// scripts (ducky_platform_api/scripts/local-migrations/NNN-name.js), run
// with the local api env; the ones done are kept in config/migrations.json.
// A migration exits 0 when done (also when there was nothing to do).

let fs   = require('fs')
let path = require('path')

let config = require('./config')
let util   = require('./util')

// ---

/**
 * The migration folder.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {string} Absolute path
 */
function getDir(paths) {

    return path.join(paths.repos, 'ducky_platform_api', 'scripts', 'local-migrations')

}

/**
 * The migrations not run yet, in order.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {array} File names
 */
function getPending(paths) {

    let done  = (config.getJSON(paths.migrations) || {}).done || []
    let files = []

    try {
        files = fs.readdirSync(getDir(paths))
    } catch (e) {
        files = []
    }

    return files.filter(function(name) {

        return /^\d{3}-[a-z0-9_-]+\.js$/.test(name) && done.indexOf(name) === -1

    }).sort()

}

/**
 * Runs the pending migrations in order, stops at the first failure.
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @returns {object} { failed, ran }
 */
function run(settings, paths) {

    let record = config.getJSON(paths.migrations) || { done : [] }
    let ran    = []
    let failed = 0

    getPending(paths).every(function(name) {

        let result = util.exec(settings.node || process.execPath, [path.join(getDir(paths), name)], {
            cwd : path.join(paths.repos, 'ducky_platform_api'),
            env : {
                APP_ENV_FILE : path.join(paths.repos, 'ducky_platform_api', 'env.local.api.json'),
                DUCKY_HOME   : paths.home
            }
        })

        if (result.code !== 0) {
            util.say('err', 'migration ' + name + ' exited ' + result.code + ': ' + result.err.trim().split('\n').slice(-1)[0])
            failed++
            return false
        }

        record.done.push(name)
        ran.push(name)
        util.setFile(paths.migrations, JSON.stringify(record, null, 4) + '\n', 0o600)

        return true

    })

    return {
        failed : failed,
        ran    : ran
    }

}

module.exports = {
    getPending,
    run
}
