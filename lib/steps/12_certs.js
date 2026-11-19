// 12_certs.js — the cert for the app and api hosts (mkcert, no sudo), made
// again when the hosts changed or it expires within 30 days.

let fs   = require('fs')
let path = require('path')

let util = require('../util')

// ---

/**
 * The cert files.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {object} { cert, key }
 */
function getFiles(paths) {

    return {
        cert : path.join(paths.certs, 'ducky_local.pem'),
        key  : path.join(paths.certs, 'ducky_local-key.pem')
    }

}

module.exports = {
    getFiles,
    key   : 'certs',
    sudo  : false,
    title : 'the https cert for the app and api hosts',
    apply : function(ctx) {

        let files  = getFiles(ctx.paths)
        let result = util.exec('mkcert', ['-cert-file', files.cert, '-key-file', files.key, ctx.settings.host, ctx.settings.api_host])

        if (result.code === 0) fs.chmodSync(files.key, 0o600)

        return { detail : 'mkcert exited ' + result.code, ok : result.code === 0 }

    },
    check : function(ctx) {

        let files = getFiles(ctx.paths)
        let names = null

        if (!fs.existsSync(files.cert) || !fs.existsSync(files.key)) return { detail : 'mkcert ' + ctx.settings.host + ' ' + ctx.settings.api_host, ok : false }

        names = util.exec('/usr/bin/openssl', ['x509', '-noout', '-text', '-in', files.cert]).out

        if (names.indexOf('DNS:' + ctx.settings.host) === -1 || names.indexOf('DNS:' + ctx.settings.api_host) === -1) return { detail : 'the cert lacks a host, make it again', ok : false }
        if (util.exec('/usr/bin/openssl', ['x509', '-noout', '-checkend', String(30 * 86400), '-in', files.cert]).code !== 0) return { detail : 'the cert expires within 30 days, make it again', ok : false }

        return { detail : files.cert, ok : true }

    }
}
