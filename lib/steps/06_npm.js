// 06_npm.js — npm ci in the api and the pro app when the lockfile changed
// (or node_modules is missing), the cli without dev deps; dev mode also
// builds the css.

let crypto = require('crypto')
let fs     = require('fs')
let path   = require('path')

let config = require('../config')
let util   = require('../util')

// ---

let repos = ['ducky_platform_api', 'ducky_platform_app_pro', 'ducky_cli']

/**
 * The lockfile hash of a repo, null when it has none.
 *
 * @param   {string} dir - The repo
 * @returns {(string|null)} sha256
 */
function getLockHash(dir) {

    try {
        return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'package-lock.json'))).digest('hex')
    } catch (e) {
        return null
    }

}

/**
 * The repos whose node_modules are stale.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {array} Repo names
 */
function getStale(paths) {

    let done = config.getJSON(path.join(paths.run, 'npm.json')) || {}

    return repos.filter(function(name) {

        let dir = path.join(paths.repos, name)

        if (!fs.existsSync(dir)) return true
        if (!fs.existsSync(path.join(dir, 'package-lock.json'))) return false

        return !fs.existsSync(path.join(dir, 'node_modules')) || done[name] !== getLockHash(dir)

    })

}

module.exports = {
    getStale,
    key   : 'npm',
    sudo  : false,
    title : 'node modules (npm ci) + the app css',
    apply : function(ctx) {

        let file   = path.join(ctx.paths.run, 'npm.json')
        let done   = config.getJSON(file) || {}
        let failed = []
        let node   = ctx.settings.node ? path.dirname(ctx.settings.node) : null
        let env    = node ? { PATH : node + ':' + process.env.PATH } : {}

        getStale(ctx.paths).forEach(function(name) {

            let dir = path.join(ctx.paths.repos, name)

            let args = ['ci', '--no-audit', '--no-fund'].concat(name === 'ducky_cli' ? ['--omit=dev'] : [])

            if (util.exec('npm', args, { cwd : dir, env : env, inherit : true, timeout : 30 * 60 * 1000 }).code !== 0) return failed.push(name)

            done[name] = getLockHash(dir)

        })
        util.setFile(file, JSON.stringify(done, null, 4) + '\n')

        if (!failed.length && ctx.settings.mode === 'dev') {
            if (util.exec('npm', ['run', 'scss:build'], { cwd : path.join(ctx.paths.repos, 'ducky_platform_app_pro'), env : env }).code !== 0) failed.push('scss:build')
        }

        return failed.length ? { detail : 'failed: ' + failed.join(', '), ok : false } : { detail : 'node modules current', ok : true }

    },
    check : function(ctx) {

        let stale = getStale(ctx.paths)

        return stale.length ? { detail : 'npm ci in ' + stale.join(', '), ok : false } : { detail : 'node modules current', ok : true }

    }
}
