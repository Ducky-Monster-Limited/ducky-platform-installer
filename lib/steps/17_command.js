// 17_command.js — the `ducky-pro` command on the PATH (a link into
// Homebrew's bin; `ducky` is the video cli). A second instance (instance
// set) gets no link. The old `ducky` link of this installer goes.

let fs   = require('fs')
let path = require('path')

let util = require('../util')

// ---

/**
 * The link and its target.
 *
 * @param   {object} ctx - The run context
 * @returns {object} { link, old, target }
 */
function getLink(ctx) {

    return {
        link   : path.join(ctx.paths.brew, 'bin', 'ducky-pro'),
        old    : path.join(ctx.paths.brew, 'bin', 'ducky'),
        target : path.join(util.dir_root, 'bin', 'ducky-pro')
    }

}

/**
 * Whether the old `ducky` link points into this installer.
 *
 * @param   {object}  link - getLink()
 * @returns {boolean} True when it is ours
 */
function getOldOurs(link) {

    try {
        return fs.readlinkSync(link.old).indexOf(util.dir_root + path.sep) === 0
    } catch (e) {
        return false
    }

}

module.exports = {
    key   : 'command',
    sudo  : false,
    title : 'the ducky-pro command on the PATH',
    apply : function(ctx) {

        let link = getLink(ctx)

        fs.rmSync(link.link, { force : true })
        fs.symlinkSync(link.target, link.link)

        // IMPORTANT
        // only our own old link: a `ducky` of anything else stays
        if (getOldOurs(link)) fs.rmSync(link.old, { force : true })

        return { detail : link.link + ' -> ' + link.target, ok : true }

    },
    check : function(ctx) {

        let link = getLink(ctx)

        if (ctx.settings.instance) return { detail : 'instance ' + ctx.settings.instance + ': run ' + link.target, ok : true }

        if (getOldOurs(link)) return { detail : 'link ' + link.link + ', drop the old ' + link.old, ok : false }

        try {
            if (fs.readlinkSync(link.link) === link.target) return { detail : link.link, ok : true }
        } catch (e) {
            return { detail : 'link ' + link.link, ok : false }
        }

        return { detail : link.link + ' points elsewhere, relink', ok : false }

    }
}
