// 08_whisper.js — the whisper.cpp model for the sidequest bridge, sha256
// checked against the pinned hash.

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

module.exports = {
    model,
    key   : 'whisper',
    sudo  : false,
    title : 'the whisper model (' + model.file + ', 1.6 GB)',
    apply : function(ctx) {

        let file = path.join(ctx.paths.models, model.file)
        let part = file + '.part'
        let result = util.exec('/usr/bin/curl', ['-fL', '--retry', '3', '-C', '-', '-o', part, model.url], { inherit : true, timeout : 2 * 60 * 60 * 1000 })

        if (result.code !== 0) return { detail : 'download failed (' + result.code + '), re-run to resume', ok : false }
        if (sources.getSha(part) !== model.sha256) {
            fs.rmSync(part, { force : true })
            return { detail : 'sha256 mismatch, the download was removed', ok : false }
        }

        fs.renameSync(part, file)

        return { detail : file, ok : true }

    },
    check : function(ctx) {

        let file = path.join(ctx.paths.models, model.file)

        try {
            if (fs.statSync(file).size === model.size) return { detail : file, ok : true }
        } catch (e) {
            return { detail : 'download ' + model.url, ok : false }
        }

        return { detail : 'size differs, download again', ok : false }

    }
}
