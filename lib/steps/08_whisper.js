// 08_whisper.js — whisper.cpp (brew whisper-cpp) and its model, sha256
// checked against the pinned hash: the sidequest bridge's OFFLINE
// FALLBACK only. Transcription is ElevenLabs Scribe (plan_0015 §4c), so
// this step is optional: install skips it unless asked
// (`ducky-pro whisper install`, or install --with whisper / --only whisper).

let fs   = require('fs')
let path = require('path')

let sources = require('../sources')
let util    = require('../util')

// ---

let model = {
    file   : 'ggml-large-v3-turbo.bin',
    sha256 : '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    size   : 1624555275,
    url    : 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
}

/**
 * What of whisper is there: the cli, the model (full size).
 *
 * @param   {object} ctx - The run context
 * @returns {object} { bin, file, model }
 */
function getState(ctx) {

    let file  = path.join(ctx.paths.models, model.file)
    let found = false

    try {
        found = fs.statSync(file).size === model.size
    } catch (e) {
        found = false
    }

    return {
        bin   : !!util.getWhich('whisper-cli'),
        file  : file,
        model : found
    }

}

module.exports = {
    getState,
    model,
    hint     : 'offline transcription fallback, ducky-pro whisper install',
    key      : 'whisper',
    optional : true,
    sudo     : false,
    title    : 'whisper.cpp + its model, the offline transcription fallback (brew whisper-cpp, ' + model.file + ' 1.6 GB)',
    apply    : function(ctx) {

        let state  = getState(ctx)
        let part   = state.file + '.part'
        let result = null

        if (!state.bin) {
            result = util.exec('brew', ['install', 'whisper-cpp'], { inherit : true, timeout : 60 * 60 * 1000 })
            if (result.code !== 0) return { detail : 'brew install whisper-cpp exited ' + result.code, ok : false }
        }
        if (state.model) return { detail : state.file, ok : true }

        fs.mkdirSync(ctx.paths.models, { mode : 0o755, recursive : true })

        result = util.exec('/usr/bin/curl', ['-fL', '--retry', '3', '-C', '-', '-o', part, model.url], { inherit : true, timeout : 2 * 60 * 60 * 1000 })

        if (result.code !== 0) return { detail : 'download failed (' + result.code + '), re-run to resume', ok : false }
        if (sources.getSha(part) !== model.sha256) {
            fs.rmSync(part, { force : true })
            return { detail : 'sha256 mismatch, the download was removed', ok : false }
        }

        fs.renameSync(part, state.file)

        return { detail : state.file, ok : true }

    },
    check    : function(ctx) {

        let state = getState(ctx)
        let need  = []

        if (state.bin && state.model) return { detail : 'whisper-cli + ' + state.file, ok : true }
        if (!state.bin) need.push('brew install whisper-cpp')
        if (!state.model) need.push('download ' + model.url)

        return { detail : need.join(', '), ok : false }

    }
}
