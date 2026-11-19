// nginx.js — the install's one nginx server file (servers/ducky_local.conf).
// Never edits any other nginx file: nginx.conf already includes servers/*.
// A reload of a root-owned nginx master needs sudo (asked).

let crypto = require('crypto')
let fs     = require('fs')
let path   = require('path')

let util = require('./util')

// ---

/**
 * The server file's text.
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @returns {string} The conf
 */
function getText(settings, paths) {

    return util.render('nginx.conf', getTokens(settings, paths))

}

/**
 * The template's tokens, CONF_HASH a hash over the others (the probe
 * answer tells which file nginx serves).
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @returns {object} The tokens
 */
function getTokens(settings, paths) {

    let tokens = {
        API_HOST   : settings.api_host,
        API_PORT   : settings.api_port,
        APP_PORT   : settings.app_port,
        CERT       : path.join(paths.certs, 'ducky_local.pem'),
        CERT_KEY   : path.join(paths.certs, 'ducky_local-key.pem'),
        HOST       : settings.host,
        HTTPS_PORT : settings.https_port || 443,
        LABEL      : paths.label,
        LOGS       : paths.logs
    }

    tokens.CONF_HASH = crypto.createHash('sha256').update(JSON.stringify(tokens)).digest('hex').slice(0, 12)

    return tokens

}

/**
 * Whether the running nginx serves the current file: the probe location
 * answers the label and the hash.
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @returns {object} { detail, ok }
 */
function getServing(settings, paths) {

    let tokens = getTokens(settings, paths)
    let url    = 'https://' + settings.host + ':' + tokens.HTTPS_PORT + '/__ducky_nginx'
    let result = util.exec('/usr/bin/curl', ['-s', '--max-time', '5', '--resolve', settings.host + ':' + tokens.HTTPS_PORT + ':127.0.0.1', url])

    if (result.code === 60 || result.code === 35) return { detail : 'nginx answers ' + settings.host + ' with another certificate (our file is not loaded)', ok : false }
    if (result.code !== 0) return { detail : 'nginx does not answer on ' + tokens.HTTPS_PORT + ' (curl ' + result.code + ')', ok : false }
    if (result.out.trim() !== tokens.LABEL + ' ' + tokens.CONF_HASH) return { detail : 'nginx serves an older file (reload needed)', ok : false }

    return { detail : 'serving ' + paths.nginx_file, ok : true }

}

/**
 * Whether nginx.conf includes the servers folder our file lands in.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {boolean} True when it does
 */
function getIncluded(paths) {

    let conf = path.join(path.dirname(path.dirname(paths.nginx_file)), 'nginx.conf')
    let text = ''

    if (process.env.DUCKY_NGINX_SERVERS) return true

    try {
        text = fs.readFileSync(conf, 'utf8')
    } catch (e) {
        return false
    }

    return /^\s*include\s+servers\/\*;/m.test(text)

}

/**
 * The nginx master's owner: 'root', 'user' or null (not running).
 *
 * @returns {(string|null)} The owner
 */
function getMaster() {

    let result = util.exec('/bin/ps', ['-axo', 'user=,command='])
    let line   = result.out.split('\n').filter(function(row) {

        return /nginx: master process/.test(row)

    })[0]

    if (!line) return null

    return /^root\s/.test(line.trim()) ? 'root' : 'user'

}

/**
 * nginx -t (as root when the master is root's: its pid/log files).
 *
 * @param   {boolean} sudo - Run through sudo
 * @returns {object} { ok, detail }
 */
function test(sudo) {

    let nginx  = util.getWhich('nginx')
    let result = null

    if (!nginx) return { detail : 'nginx is not installed', ok : false }

    result = sudo ? util.exec('/usr/bin/sudo', [nginx, '-t']) : util.exec(nginx, ['-t'])

    return {
        detail : (result.err || result.out).trim().split('\n').slice(-1)[0],
        ok     : result.code === 0
    }

}

module.exports = {
    getIncluded,
    getMaster,
    getServing,
    getText,
    getTokens,
    test
}
