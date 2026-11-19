// 18_sidequest.js — config/sidequest.json for the sidequest bridge in the
// local api (plan_0011 §3, §4 step 7): the example (templates/, no
// password) with this install's whisper paths, the OBS password asked on
// the terminal (hidden, never printed), written 0600. An existing file
// is never overwritten (the sidequest view's foot writes its
// workspace_id), only its mode is put back to 0600. The bridge finds the
// file within 30 s, no restart.

let fs   = require('fs')
let path = require('path')

let util    = require('../util')
let whisper = require('./08_whisper')

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
    data.whisper.bin = path.join(ctx.paths.brew, 'bin', 'whisper-cli')
    data.whisper.model = path.join(ctx.paths.models, whisper.model.file)

    return data

}

module.exports = {
    newConfig,
    key   : 'sidequest',
    sudo  : false,
    title : 'the sidequest bridge\'s config (config/sidequest.json, 0600; asks the OBS websocket password)',
    apply : async function(ctx) {

        let file       = getFile(ctx.paths)
        let password   = ''
        let recordings = ''

        if (fs.existsSync(file)) {
            fs.chmodSync(file, 0o600)
            return { detail : file + ' kept, 0600', ok : true }
        }

        password = await util.askLine('       OBS websocket password (Tools > WebSocket Server Settings; empty = later):', true)
        recordings = await util.askLine('       OBS recording folder (Settings > Output > Recording; empty = ~/Movies):', false)

        util.setFile(file, JSON.stringify(newConfig(ctx, password, recordings), null, 4) + '\n', 0o600)

        return { detail : file + (password ? '' : ' (no OBS password yet: set obs.password in it)'), ok : true }

    },
    check : function(ctx) {

        let file = getFile(ctx.paths)
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

        // the password itself is never shown, only whether there is one
        return { detail : file + (data.obs.password ? '' : ' (no OBS password yet)'), ok : true }

    }
}
