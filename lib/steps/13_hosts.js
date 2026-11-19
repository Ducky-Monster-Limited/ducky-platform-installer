// 13_hosts.js — the hosts resolve to loopback. macOS resolves *.localhost
// itself; only when it does not, a marked block goes into /etc/hosts
// (sudo, asked). DUCKY_HOSTS_FILE points the tests at a temp file.

let fs = require('fs')

let util = require('../util')

// ---

let marker = '# ducky local install'

/**
 * The hosts file.
 *
 * @returns {string} Its path
 */
function getFile() {

    return process.env.DUCKY_HOSTS_FILE || '/etc/hosts'

}

/**
 * Whether a host resolves to 127.0.0.1.
 *
 * @param   {string} host - The host
 * @returns {boolean} True when it does
 */
function getResolves(host) {

    let text = ''

    if (process.env.DUCKY_HOSTS_FILE) {

        try {
            text = fs.readFileSync(getFile(), 'utf8')
        } catch (e) {
            text = ''
        }

        return new RegExp('^127\\.0\\.0\\.1\\s+.*\\b' + host.replace(/\./g, '\\.') + '\\b', 'm').test(text)

    }

    return /ip_address: 127\.0\.0\.1/.test(util.exec('/usr/bin/dscacheutil', ['-q', 'host', '-a', 'name', host]).out)

}

module.exports = {
    getResolves,
    key   : 'hosts',
    sudo  : function() {

        return !process.env.DUCKY_HOSTS_FILE

    },
    title : 'the hosts resolve to 127.0.0.1 (/etc/hosts only when macOS does not)',
    apply : function(ctx) {

        let block  = '\n' + marker + ' (' + ctx.paths.label + ')\n127.0.0.1 ' + ctx.settings.host + ' ' + ctx.settings.api_host + '\n'
        let result = { code : 0 }

        if (process.env.DUCKY_HOSTS_FILE) {
            fs.appendFileSync(getFile(), block)
        } else {
            result = util.exec('/usr/bin/sudo', ['/usr/bin/tee', '-a', getFile()], { input : block })
        }

        return { detail : 'hosts block written (' + result.code + ')', ok : result.code === 0 }

    },
    check : function(ctx) {

        let missing = [ctx.settings.host, ctx.settings.api_host].filter(function(host) {

            return !getResolves(host)

        })

        return missing.length ? { detail : 'add "127.0.0.1 ' + missing.join(' ') + '" to ' + getFile(), ok : false } : { detail : ctx.settings.host + ', ' + ctx.settings.api_host + ' -> 127.0.0.1', ok : true }

    }
}
