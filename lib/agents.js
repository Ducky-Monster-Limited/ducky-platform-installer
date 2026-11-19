// agents.js — the two launchd user agents (<label>.api, <label>.app):
// KeepAlive on a crash, logs into ~/Ducky/logs. Only ever bootstraps or
// boots out these two labels; mongod, redis and nginx are never touched.

let fs   = require('fs')
let os   = require('os')
let path = require('path')

let util = require('./util')

// ---

/**
 * The mkcert CA the local cert is signed by: node trusts it through
 * NODE_EXTRA_CA_CERTS, so the app server reaches its api through the
 * local nginx (https://<api_host>, the api's local gate) as the page
 * does. node reads no macOS keychain.
 *
 * @returns {string} The CA file (rootCA.pem)
 */
function getCaFile() {

    let result = util.exec('mkcert', ['-CAROOT'])
    let dir    = result.code === 0 && result.out.trim() ? result.out.trim() : (process.env.CAROOT || path.join(os.homedir(), 'Library', 'Application Support', 'mkcert'))

    return path.join(dir, 'rootCA.pem')

}

/**
 * The agents of an install.
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @returns {array} [{ file, label, side, text }]
 */
function getAgents(settings, paths) {

    let ca       = getCaFile()
    let node     = settings.node || util.getWhich('node') || '/opt/homebrew/bin/node'
    let release  = settings.mode === 'release'
    let versions = release && settings.release.versions ? settings.release.versions : {}
    let sides    = [
        { dir : 'ducky_platform_api', env : 'env.local.api.json', side : 'api' },
        { dir : 'ducky_platform_app_pro', env : 'env.local.app.json', side : 'app' }
    ]

    return sides.map(function(item) {

        let label = paths.label + '.' + item.side
        let cwd   = path.join(paths.repos, item.dir)

        return {
            file  : path.join(paths.agents, label + '.plist'),
            label : label,
            side  : item.side,
            text  : util.render('agent.plist', {
                CA_FILE  : ca,
                CWD      : cwd,
                ENV_FILE : path.join(cwd, item.env),
                HOME     : paths.home,
                LABEL    : label,
                LOG      : path.join(paths.logs, item.side + '.log'),
                NODE     : node,
                NODE_ENV : release ? 'production' : 'development',
                PATH     : path.join(paths.brew, 'bin') + ':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                VERSION  : versions[item.side] || '0.0.0-local'
            })
        }

    })

}

/**
 * The launchd domain of this user.
 *
 * @returns {string} gui/<uid>
 */
function getDomain() {

    return 'gui/' + os.userInfo().uid

}

/**
 * Whether an agent is loaded, and its pid.
 *
 * @param   {string} label - The label
 * @returns {object} { loaded, pid }
 */
function getState(label) {

    let result = util.exec('/bin/launchctl', ['print', getDomain() + '/' + label])
    let pid    = /\bpid = (\d+)/.exec(result.out)

    return {
        loaded : result.code === 0,
        pid    : pid ? Number(pid[1]) : null
    }

}

/**
 * Loads an agent (bootstrap), when not loaded yet.
 *
 * @param   {object} agent - From getAgents()
 * @returns {object} { code, err }
 */
function start(agent) {

    if (getState(agent.label).loaded) return util.exec('/bin/launchctl', ['kickstart', getDomain() + '/' + agent.label])

    return util.exec('/bin/launchctl', ['bootstrap', getDomain(), agent.file])

}

/**
 * Unloads an agent (bootout), only our labels.
 *
 * @param   {object} agent - From getAgents()
 * @returns {object} { code, err }
 */
function stop(agent) {

    if (!/^com\.duckymonster\.ducky(\.[a-z0-9_-]+)?\.(api|app)$/.test(agent.label)) throw new Error('refusing to boot out a foreign label: ' + agent.label)
    if (!getState(agent.label).loaded) return { code : 0, err : '' }

    return util.exec('/bin/launchctl', ['bootout', getDomain() + '/' + agent.label])

}

/**
 * Writes the plist files that changed.
 *
 * @param   {array} agents - From getAgents()
 * @returns {array} The labels written
 */
function write(agents) {

    return agents.filter(function(agent) {

        return util.setFile(agent.file, agent.text, 0o644)

    }).map(function(agent) {

        return agent.label

    })

}

/**
 * Whether every plist on disk equals its render.
 *
 * @param   {array}   agents - From getAgents()
 * @returns {boolean} True when current
 */
function getCurrent(agents) {

    return agents.every(function(agent) {

        try {
            return fs.readFileSync(agent.file, 'utf8') === agent.text
        } catch (e) {
            return false
        }

    })

}

module.exports = {
    getAgents,
    getCurrent,
    getState,
    start,
    stop,
    write
}
