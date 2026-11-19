// checks.js — `ducky doctor`: plan_0010 §2.2's rows plus the local
// install's (host resolution, cert expiry, nginx file served, agents
// loaded, health, device link, cloud reachable, whisper model, OBS).
// Read-only probes. red = blocking (with the fix), amber = a feature off.

let fs   = require('fs')
let net  = require('net')
let os   = require('os')
let path = require('path')

let agents = require('./agents')
let config = require('./config')
let nginx  = require('./nginx')
let steps  = require('./steps')
let util   = require('./util')

// ---

/**
 * Whether a TCP port answers on loopback.
 *
 * @param   {number} port - The port
 * @returns {Promise<boolean>} True when it does
 */
function getPort(port) {

    return new Promise(function(resolve) {

        let socket = net.connect({ host : '127.0.0.1', port : port })

        socket.setTimeout(1500)
        socket.on('connect', function() {

            socket.destroy()
            resolve(true)

        })
        socket.on('error', function() {

            resolve(false)

        })
        socket.on('timeout', function() {

            socket.destroy()
            resolve(false)

        })

    })

}

/**
 * The http status of a url through nginx (or direct), 0 when none.
 *
 * @param   {string} url - The url
 * @returns {number} Status
 */
function getStatus(url) {

    let result = util.exec('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', url])

    return Number(result.out.trim()) || 0

}

/**
 * Whether a folder is writable.
 *
 * @param   {string}  dir - The folder
 * @returns {boolean} True when it is
 */
function getWritable(dir) {

    try {
        fs.accessSync(dir, fs.constants.W_OK)
        return true
    } catch (e) {
        return false
    }

}

/**
 * The step a check reuses.
 *
 * @param   {string} key - Step key
 * @returns {object} The step
 */
function getStep(key) {

    return steps.filter(function(step) {

        return step.key === key

    })[0]

}

/**
 * All rows.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<array>} [{ detail, label, level }] level ok|amber|red
 */
async function getRows(ctx) {

    let settings = ctx.settings
    let paths    = ctx.paths
    let rows     = []
    let api_env  = config.getJSON(path.join(paths.repos, 'ducky_platform_api', 'env.local.api.json')) || {}
    let cli      = ((api_env.services || {}).productions || {}).cli || path.join(paths.repos, 'ducky_cli', 'ducky.sh')
    let sidequest = config.getJSON(path.join(paths.config, 'sidequest.json'))
    let device   = config.getJSON(path.join(paths.config, 'device.json'))
    let free     = util.exec('/bin/df', ['-k', fs.existsSync(paths.media) ? paths.media : os.homedir()]).out.split('\n')[1] || ''
    let free_gb  = Math.round(Number(free.split(/\s+/)[3] || 0) / 1024 / 1024)

    function row(label, passed, detail, amber) {

        rows.push({ detail : detail || '', label : label, level : passed ? 'ok' : (amber ? 'amber' : 'red') })

    }

    function rowStep(label, key, amber) {

        let result = getStep(key).check(ctx)

        row(label, result.ok, result.detail, amber)

    }

    rowStep('platform', 'platform')
    row('node 20', !!settings.node && fs.existsSync(settings.node), settings.node || 'ducky install (packages)')
    row('mongod', await getPort(27017), 'tcp 27017' + (settings.mongod_installed ? '' : ' (not ours: start it the way it was installed)'))
    row('redis', await getPort(6379), 'tcp 6379, db ' + settings.redis_db + ' (brew services start redis)')
    rowStep('code', 'sources')
    rowStep('node modules', 'npm')
    rowStep('config + envs', 'config')
    rowStep('migrations', 'migrations')
    rowStep('mkcert CA', 'ca')
    rowStep('cert', 'certs')
    rowStep('hosts', 'hosts')
    rowStep('nginx file', 'nginx_file')
    rowStep('nginx serves it', 'nginx_reload')
    rowStep('launchd plists', 'agents')

    agents.getAgents(settings, paths).forEach(function(agent) {

        let state = agents.getState(agent.label)

        row('agent ' + agent.side, state.loaded && !!state.pid, state.loaded ? (state.pid ? 'pid ' + state.pid : 'loaded, not running (ducky logs ' + agent.side + ')') : 'not loaded (ducky start)')

    })

    row('api health', getStatus('https://' + settings.api_host + '/api/0.1.0/status') === 200, 'https://' + settings.api_host + '/api/0.1.0/status')
    row('app health', [200, 302].indexOf(getStatus('https://' + settings.host + '/')) !== -1, 'https://' + settings.host + '/')
    row('ducky_cli', fs.existsSync(cli), cli)
    row('ffmpeg / ffprobe', !!util.getWhich('ffmpeg') && !!util.getWhich('ffprobe'), 'brew install ffmpeg')
    row('whisper-cli', !!util.getWhich('whisper-cli'), 'brew install whisper-cpp', true)
    rowStep('whisper model', 'whisper', true)
    rowStep('sidequest config', 'sidequest', true)
    rowStep('demucs venv', 'python', true)
    row('~/.ducky-dnr', fs.existsSync(path.join(os.homedir(), '.ducky-dnr')), 'three-way extract off without it', true)
    row('media_root writable', getWritable(paths.media), paths.media)
    row('disk free', free_gb >= 20, free_gb + ' GB free on the media disk', true)
    row('cloud reachable', getStatus(settings.cloud_api + '/api/0.1.0/status') === 200, settings.cloud_api, true)
    row('device link', !!(device && device.device_link_id), device ? 'linked' : 'not linked (ducky link)', true)
    row('Automation consent', true, 'macOS asks once, on the first folder dialog (System Settings > Privacy > Automation)', true)

    if (sidequest && sidequest.obs) row('OBS reachable', await getPort(Number(sidequest.obs.port) || 4455), (sidequest.obs.address || '127.0.0.1') + ':' + (sidequest.obs.port || 4455), true)

    return rows

}

/**
 * Prints the rows, returns whether any is red.
 *
 * @param   {array}   rows - From getRows()
 * @returns {boolean} True when something blocks
 */
function print(rows) {

    let width = rows.reduce(function(max, item) {

        return Math.max(max, item.label.length)

    }, 0)

    rows.forEach(function(item) {

        let tag = item.level === 'ok' ? 'ok' : (item.level === 'amber' ? 'warn' : 'err')

        util.say(tag, item.label + ' '.repeat(width - item.label.length) + '  ' + item.detail)

    })

    return rows.some(function(item) {

        return item.level === 'red'

    })

}

module.exports = {
    getPort,
    getRows,
    getStatus,
    print
}
