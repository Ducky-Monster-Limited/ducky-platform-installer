// 09_config.js — ducky.json, secrets.json (minted once, 0600) and the envs
// (ducky_platform_shared/scripts/local-envs.js, never hand-edited).

let fs   = require('fs')
let path = require('path')

let config = require('../config')
let util   = require('../util')

// ---

/**
 * The generator and its outputs.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {object} { outputs, script }
 */
function getFiles(paths) {

    return {
        outputs : [
            path.join(paths.repos, 'ducky_platform_api', 'env.local.api.json'),
            path.join(paths.repos, 'ducky_platform_app_pro', 'env.local.app.json')
        ],
        script  : path.join(paths.repos, 'ducky_platform_shared', 'scripts', 'local-envs.js')
    }

}

/**
 * The newest modification time of some files (0 when missing).
 *
 * @param   {array} files - Absolute paths
 * @returns {number} ms
 */
function getNewest(files) {

    return files.reduce(function(newest, file) {

        try {
            return Math.max(newest, fs.statSync(file).mtimeMs)
        } catch (e) {
            return newest
        }

    }, 0)

}

/**
 * The oldest modification time of some files (0 when one is missing).
 *
 * @param   {array} files - Absolute paths
 * @returns {number} ms
 */
function getOldest(files) {

    return files.reduce(function(oldest, file) {

        try {
            return Math.min(oldest, fs.statSync(file).mtimeMs)
        } catch (e) {
            return 0
        }

    }, Infinity)

}

module.exports = {
    key   : 'config',
    sudo  : false,
    title : 'config (ducky.json, secrets.json) + the local envs',
    apply : function(ctx) {

        let files   = getFiles(ctx.paths)
        let secrets = config.newSecrets(config.getJSON(ctx.paths.secrets_json))
        let result  = null

        config.setSettings(ctx.settings)
        util.setFile(ctx.paths.secrets_json, JSON.stringify(secrets, null, 4) + '\n', 0o600)

        if (!fs.existsSync(files.script)) return { detail : 'local-envs.js is missing in the shared repo/bundle', ok : false }

        result = util.exec(ctx.settings.node || process.execPath, [files.script, '--home', ctx.paths.home, '--repos', ctx.paths.repos], { env : { DUCKY_HOME : ctx.paths.home } })

        // the generator's lines, never a secret value (it prints none)
        result.out.split('\n').filter(Boolean).forEach(function(line) {

            console.log('       ' + line)

        })

        return { detail : 'local-envs.js exited ' + result.code, ok : result.code === 0 }

    },
    check : function(ctx) {

        let files   = getFiles(ctx.paths)
        let stored  = config.getJSON(ctx.paths.ducky_json)
        let secrets = config.getJSON(ctx.paths.secrets_json)
        let inputs  = [ctx.paths.ducky_json, ctx.paths.secrets_json, files.script]

        if (!stored || JSON.stringify(stored) !== JSON.stringify(ctx.settings)) return { detail : 'write ducky.json', ok : false }
        if (!secrets || JSON.stringify(config.newSecrets(secrets)) !== JSON.stringify(secrets)) return { detail : 'mint secrets.json', ok : false }
        if (getOldest(files.outputs) < getNewest(inputs)) return { detail : 'node local-envs.js (envs missing or older than their inputs)', ok : false }

        return { detail : 'envs current', ok : true }

    }
}
