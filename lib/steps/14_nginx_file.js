// 14_nginx_file.js — our one server file in nginx's servers/ folder (no
// other nginx file is ever edited), checked with nginx -t.

let fs = require('fs')

let nginx = require('../nginx')
let util  = require('../util')

// ---

module.exports = {
    key   : 'nginx_file',
    sudo  : false,
    title : 'the nginx server file',
    apply : function(ctx) {

        util.setFile(ctx.paths.nginx_file, nginx.getText(ctx.settings, ctx.paths), 0o644)

        return { detail : ctx.paths.nginx_file, ok : true }

    },
    check : function(ctx) {

        let current = ''

        if (!nginx.getIncluded(ctx.paths)) return { detail : 'nginx.conf does not include servers/*; add it by hand (the installer never edits nginx.conf)', fatal : true, ok : false }

        try {
            current = fs.readFileSync(ctx.paths.nginx_file, 'utf8')
        } catch (e) {
            current = ''
        }

        return current === nginx.getText(ctx.settings, ctx.paths) ? { detail : ctx.paths.nginx_file, ok : true } : { detail : 'write ' + ctx.paths.nginx_file, ok : false }

    }
}
