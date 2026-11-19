// 15_nginx_reload.js — nginx serves our file: nginx -t, then a reload (or
// a start). A root-owned master needs sudo (asked).

let nginx = require('../nginx')
let util  = require('../util')

// ---

module.exports = {
    key   : 'nginx_reload',
    sudo  : function() {

        return nginx.getMaster() !== 'user'

    },
    title : 'nginx loads the file (nginx -t + reload; sudo when nginx runs as root)',
    apply : function() {

        let master = nginx.getMaster()
        let sudo   = master !== 'user'
        let tested = nginx.test(sudo)
        let bin    = util.getWhich('nginx')
        let result = null

        if (!tested.ok) return { detail : 'nginx -t failed: ' + tested.detail, ok : false }

        result = sudo
            ? util.exec('/usr/bin/sudo', master ? [bin, '-s', 'reload'] : [bin])
            : util.exec(bin, ['-s', 'reload'])

        return { detail : (master ? 'reload' : 'start') + ' exited ' + result.code, ok : result.code === 0 }

    },
    check : function(ctx) {

        if (process.env.DUCKY_NGINX_SERVERS) return { detail : 'test servers folder, not loaded', ok : true }

        return nginx.getServing(ctx.settings, ctx.paths)

    }
}
