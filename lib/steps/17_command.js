// 17_command.js — the `ducky` command on the PATH (a link into Homebrew's
// bin). A second instance (instance set) gets no link.

let fs   = require('fs')
let path = require('path')

let util = require('../util')

// ---

/**
 * The link and its target.
 *
 * @param   {object} ctx - The run context
 * @returns {object} { link, target }
 */
function getLink(ctx) {

    return {
        link   : path.join(ctx.paths.brew, 'bin', 'ducky'),
        target : path.join(util.dir_root, 'bin', 'ducky')
    }

}

module.exports = {
    key   : 'command',
    sudo  : false,
    title : 'the ducky command on the PATH',
    apply : function(ctx) {

        let link = getLink(ctx)

        fs.rmSync(link.link, { force : true })
        fs.symlinkSync(link.target, link.link)

        return { detail : link.link + ' -> ' + link.target, ok : true }

    },
    check : function(ctx) {

        let link = getLink(ctx)

        if (ctx.settings.instance) return { detail : 'instance ' + ctx.settings.instance + ': run ' + link.target, ok : true }

        try {
            if (fs.readlinkSync(link.link) === link.target) return { detail : link.link, ok : true }
        } catch (e) {
            return { detail : 'link ' + link.link, ok : false }
        }

        return { detail : link.link + ' points elsewhere, relink', ok : false }

    }
}
