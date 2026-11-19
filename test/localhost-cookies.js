// localhost-cookies.js — the day-1 check of plan_0011 slice 0011_1: do the
// browser's cookies and CORS work between ducky.localhost (app) and
// api.ducky.localhost (api) the way the local install sets them?
//
// Two https servers on loopback only (mkcert cert, no sudo, no nginx, no
// hosts entry: the browser resolves *.localhost itself), a real Chrome
// (puppeteer) and the cookie attributes the local envs use:
//   - the api mints the auth cookie on .ducky.localhost (Secure, HttpOnly,
//     SameSite None) from a credentialed, preflighted fetch of the app page
//   - the app page then sees it on its own host
//   - the app's own cookie reaches the api on a credentialed fetch
//   - a foreign origin gets no CORS grant
//
// usage: node test/localhost-cookies.js [--puppeteer <dir>] [--port <n>]
// exit 0 when every row passes.

let child_process = require('child_process')
let fs            = require('fs')
let https         = require('https')
let os            = require('os')
let path          = require('path')

// ---

let host_app = 'ducky.localhost'
let host_api = 'api.ducky.localhost'

/**
 * One command line value.
 *
 * @param   {string} name     - The flag
 * @param   {*}      fallback - The value when missing
 * @returns {*} The value
 */
function arg(name, fallback) {

    let index = process.argv.indexOf(name)

    return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback

}

/**
 * A mkcert cert for both hosts in a temp folder.
 *
 * @param   {string} dir - The temp folder
 * @returns {object} { cert, key }
 */
function newCert(dir) {

    let cert = path.join(dir, 'cert.pem')
    let key  = path.join(dir, 'key.pem')

    child_process.execFileSync('mkcert', ['-cert-file', cert, '-key-file', key, host_app, host_api, 'localhost'], { stdio : 'ignore' })

    return {
        cert : fs.readFileSync(cert),
        key  : fs.readFileSync(key)
    }

}

/**
 * Starts one https server on 127.0.0.1 and ::1.
 *
 * @param   {object}   tls     - { cert, key }
 * @param   {number}   port    - The port
 * @param   {function} handler - The request handler
 * @returns {array} The servers
 */
function newServer(tls, port, handler) {

    return ['127.0.0.1', '::1'].map(function(address) {

        let server = https.createServer(tls, handler)

        server.listen(port, address)

        return server

    })

}

/**
 * The api side: CORS for the app origin only, mints the auth cookie,
 * echoes the cookies it got.
 *
 * @param {string} origin_app - The app's origin
 * @returns {function} The handler
 */
function newApiHandler(origin_app) {

    return function(req, res) {

        let origin = req.headers.origin || ''

        if (origin === origin_app) {
            res.setHeader('Access-Control-Allow-Origin', origin)
            res.setHeader('Access-Control-Allow-Credentials', 'true')
            res.setHeader('Access-Control-Allow-Headers', 'x-client-key, content-type')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            res.setHeader('Vary', 'Origin')
        }
        if (req.method === 'OPTIONS') {
            res.writeHead(origin === origin_app ? 204 : 403)
            return res.end()
        }
        if (req.url === '/login') {
            res.setHeader('Set-Cookie', 'ducky_local_auth=token1; Domain=.' + host_app + '; Path=/; Secure; HttpOnly; SameSite=None')
        }

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ cookie : req.headers.cookie || '' }))

    }

}

/**
 * The app side: sets its own session cookie, echoes the cookies it got.
 *
 * @returns {function} The handler
 */
function newAppHandler() {

    return function(req, res) {

        if (req.url === '/') {
            res.setHeader('Set-Cookie', 'ducky_local_pro_session=s1; Domain=.' + host_app + '; Path=/; Secure; HttpOnly; SameSite=None')
            res.setHeader('Content-Type', 'text/html')
            return res.end('<!doctype html><title>app</title>')
        }

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ cookie : req.headers.cookie || '' }))

    }

}

/**
 * The run.
 *
 * @returns {Promise<number>} Exit code
 */
async function run() {

    let port       = Number(arg('--port', 14170))
    let port_app   = port + 2
    let port_api   = port + 1
    let dir_pptr   = arg('--puppeteer', path.resolve(__dirname, '../../ducky4/ducky_platform_app_pro/node_modules/puppeteer'))
    let puppeteer  = require(dir_pptr)
    let dir        = fs.mkdtempSync(path.join(os.tmpdir(), 'ducky-cookies-'))
    let tls        = newCert(dir)
    let origin_app = 'https://' + host_app + ':' + port_app
    let origin_api = 'https://' + host_api + ':' + port_api
    let servers    = newServer(tls, port_api, newApiHandler(origin_app)).concat(newServer(tls, port_app, newAppHandler()))
    let browser    = await puppeteer.launch({ headless : true })
    let page       = await browser.newPage()
    let rows       = []
    let answer     = null
    let foreign    = null

    function check(label, passed, detail) {

        rows.push(passed)
        console.log((passed ? '[ok]  ' : '[err] ') + label + (detail ? ' — ' + detail : ''))

    }

    try {

        await page.goto(origin_app + '/', { waitUntil : 'load' })
        check('app page loads on ' + host_app + ' (resolution + mkcert trust)', true)

        answer = await page.evaluate(async function(url) {

            let res = await fetch(url + '/login', { credentials : 'include', headers : { 'x-client-key' : 'k' }, method : 'POST' })

            return res.json()

        }, origin_api)
        check('preflighted credentialed fetch app -> api', !!answer)
        check('the api gets the app\'s cookie (one site)', /ducky_local_pro_session=s1/.test(answer.cookie), answer.cookie)

        await page.goto(origin_app + '/echo', { waitUntil : 'load' })
        answer = JSON.parse(await page.evaluate(function() {

            return document.body.innerText

        }))
        check('the auth cookie minted by the api reaches the app', /ducky_local_auth=token1/.test(answer.cookie), answer.cookie)

        await page.goto(origin_app + '/', { waitUntil : 'load' })
        answer = await page.evaluate(async function(url) {

            let res = await fetch(url + '/echo', { credentials : 'include', headers : { 'x-client-key' : 'k' } })

            return res.json()

        }, origin_api)
        check('the api gets both cookies on a later call', /ducky_local_auth=token1/.test(answer.cookie) && /ducky_local_pro_session=s1/.test(answer.cookie))

        // the app server under another origin (localhost, in the cert)
        await page.goto('https://localhost:' + port_app + '/', { waitUntil : 'load' })
        check('foreign origin page loads', page.url().indexOf('https://localhost:') === 0, page.url())
        foreign = await page.evaluate(async function(url) {

            try {
                await fetch(url + '/echo', { credentials : 'include', headers : { 'x-client-key' : 'k' } })
                return 'granted'
            } catch (e) {
                return 'blocked'
            }

        }, origin_api).catch(function() {

            return 'blocked'

        })
        check('a foreign origin gets no CORS grant', foreign === 'blocked', foreign)

    } catch (err) {
        check('run', false, err.message)
    }

    await browser.close()
    servers.forEach(function(server) {

        server.close()

    })
    fs.rmSync(dir, { force : true, recursive : true })

    return rows.every(Boolean) ? 0 : 1

}

// ---

run().then(function(code) {

    process.exitCode = code

})
