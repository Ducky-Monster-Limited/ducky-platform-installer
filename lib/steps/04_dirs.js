// 04_dirs.js — the install tree: repos, media, config (0700), certs, logs,
// models/whisper, run.

let fs = require('fs')

// ---

/**
 * The folders and their modes.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {array} [[dir, mode]]
 */
function getDirs(paths) {

    return [
        [paths.home, 0o755],
        [paths.repos, 0o755],
        [paths.media, 0o755],
        [paths.config, 0o700],
        [paths.certs, 0o700],
        [paths.logs, 0o755],
        [paths.models, 0o755],
        [paths.run, 0o755]
    ]

}

module.exports = {
    key   : 'dirs',
    sudo  : false,
    title : 'the install folders',
    apply : function(ctx) {

        getDirs(ctx.paths).forEach(function(pair) {

            fs.mkdirSync(pair[0], { mode : pair[1], recursive : true })
            fs.chmodSync(pair[0], pair[1])

        })

        return { detail : ctx.paths.home, ok : true }

    },
    check : function(ctx) {

        let bad = getDirs(ctx.paths).filter(function(pair) {

            try {
                return (fs.statSync(pair[0]).mode & 0o777) !== pair[1]
            } catch (e) {
                return true
            }

        })

        return bad.length ? { detail : 'create ' + bad.map(function(pair) { return pair[0] }).join(', '), ok : false } : { detail : ctx.paths.home, ok : true }

    }
}
