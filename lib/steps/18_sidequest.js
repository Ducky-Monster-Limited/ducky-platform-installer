// 18_sidequest.js — config/sidequest.json for the sidequest bridge in the
// local api (plan_0011 §3, §4 step 7): the example (templates/, no
// password) with the team's OBS websocket password from dev.json of
// ducky-secrets (vendors.obs.password, plan_0013; asked on the terminal,
// hidden, only when it is not there), written 0600, never printed. An existing file keeps everything (the
// sidequest view's foot writes its workspace_id) but takes the team's
// password when it differs; its mode is put back to 0600. The bridge
// finds the file within 30 s, no restart.

let fs   = require('fs')
let path = require('path')

let util = require('../util')

// ---

/**
 * The config file of the install.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {string} Absolute path
 */
function getFile(paths) {

    return path.join(paths.config, 'sidequest.json')

}

/**
 * The team's OBS websocket password from dev.json of the install's
 * ducky-secrets, '' when there is none (or it cannot be read).
 *
 * @param   {object} ctx - The run context
 * @returns {string} The password
 */
function getTeamPassword(ctx) {

    let secrets = null
    let value   = ''

    try {
        secrets = require(path.join(ctx.paths.repos, 'ducky_platform_shared', 'scripts', 'secrets.js'))
        value   = secrets.getPath(secrets.getSecrets('dev'), 'vendors.obs.password')
    } catch (e) {
        value = ''
    }

    return typeof value === 'string' && value.indexOf('<missing') !== 0 ? value : ''

}

/**
 * The example with this install's paths and the answers.
 *
 * @param   {object} ctx        - The run context
 * @param   {string} password   - The OBS websocket password ('' = none yet)
 * @param   {string} recordings - OBS's recording folder ('' = the example's)
 * @returns {object} The config
 */
function newConfig(ctx, password, recordings) {

    let data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'sidequest.example.json'), 'utf8'))

    data.obs.password = password || ''
    data.recordings = recordings || data.recordings

    return data

}

module.exports = {
    newConfig,
    key   : 'sidequest',
    sudo  : false,
    title : 'the sidequest bridge\'s config (config/sidequest.json, 0600; the OBS password from ducky-secrets, else asked)',
    apply : async function(ctx) {

        let file       = getFile(ctx.paths)
        let team       = getTeamPassword(ctx)
        let password   = team
        let recordings = ''
        let data       = null

        if (fs.existsSync(file)) {
            data = JSON.parse(fs.readFileSync(file, 'utf8'))
            if (team && data.obs && data.obs.password !== team) {
                data.obs.password = team
                util.setFile(file, JSON.stringify(data, null, 4) + '\n', 0o600)
                return { detail : file + ' kept, the team\'s OBS password set, 0600', ok : true }
            }
            fs.chmodSync(file, 0o600)
            return { detail : file + ' kept, 0600', ok : true }
        }

        if (team) console.log('       OBS websocket password: the team\'s, from ducky-secrets (set the same in OBS: Tools > WebSocket Server Settings)')
        if (!team) password = await util.askLine('       OBS websocket password (Tools > WebSocket Server Settings; empty = later):', true)
        recordings = await util.askLine('       OBS recording folder (Settings > Output > Recording; empty = ~/Movies):', false)

        util.setFile(file, JSON.stringify(newConfig(ctx, password, recordings), null, 4) + '\n', 0o600)

        return { detail : file + (password ? '' : ' (no OBS password yet: set obs.password in it)'), ok : true }

    },
    check : function(ctx) {

        let file = getFile(ctx.paths)
        let team = getTeamPassword(ctx)
        let data = null
        let mode = 0

        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'))
            mode = fs.statSync(file).mode & 0o777
        } catch (e) {
            return { detail : 'write ' + file, ok : false }
        }

        if (mode !== 0o600) return { detail : file + ' is ' + mode.toString(8) + ', not 600', ok : false }
        if (!data || !data.obs || !data.recordings) return { detail : file + ' has no obs / recordings', ok : false }
        if (team && data.obs.password !== team) return { detail : file + ': the team\'s OBS password from ducky-secrets', ok : false }

        // the password itself is never shown, only whether there is one
        return { detail : file + (data.obs.password ? '' : ' (no OBS password yet)'), ok : true }

    }
}
