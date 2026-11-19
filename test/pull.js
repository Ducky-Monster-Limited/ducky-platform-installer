// pull.js — `ducky-pro start`'s boot pull hook against L4's POST
// /:v/local/pull (plan_0011 §6): a fake api on loopback (a child process,
// curl blocks this one) answers 200 / 409 / 401 / 503 / html; each gives
// one status line, none throws. No sudo, nothing outside loopback.
//
// usage: node test/pull.js

let child_process = require('child_process')
let commands      = require('../lib/commands')

// ---

let ctx  = {
    settings : {
        api_host : 'api.ducky-test.localhost',
        host     : 'ducky-test.localhost'
    }
}
let rows = []

// the fake api: one answer per path, the method and headers echoed back
let server_code = [
    'let answers = {',
    '    "/ok"      : [200, { pulled : { actors : 3, users : 1 }, removed : { actors : 1 }, ts : "2026-11-19T10:00:00.000Z" }],',
    '    "/linked"  : [409, { message : "This machine is not linked yet.", status : 409 }],',
    '    "/revoked" : [401, { message : "This machine is unlinked.", status : 401 }],',
    '    "/offline" : [503, { message : "The cloud is offline.", status : 503 }]',
    '}',
    'let server = require("http").createServer(function(req, res) {',
    '    let answer = answers[req.url]',
    '    if (req.url === "/echo") answer = [200, { method : req.method, auth : req.headers.authorization || null, key : req.headers["x-client-key"] || null }]',
    '    if (!answer) { res.writeHead(502, { "content-type" : "text/html" }); return res.end("<html>bad gateway</html>") }',
    '    res.writeHead(answer[0], { "content-type" : "application/json" })',
    '    res.end(JSON.stringify(answer[1]))',
    '})',
    'server.listen(0, "127.0.0.1", function() { process.stdout.write(String(server.address().port) + "\\n") })'
].join('\n')

/**
 * Records and prints one row.
 *
 * @param {string}  label  - What
 * @param {boolean} passed - Result
 * @param {string}  detail - Extra
 */
function check(label, passed, detail) {

    rows.push(passed)
    console.log((passed ? '[ok]  ' : '[err] ') + label + (detail ? ' — ' + detail : ''))

}

/**
 * The line for one path of the fake api.
 *
 * @param   {number} port - The fake api's port
 * @param   {string} name - The path
 * @returns {object} { answer, line }
 */
function getLine(port, name) {

    let answer = commands.getPull('http://127.0.0.1:' + port + '/' + name)

    return {
        answer : answer,
        line   : commands.getPullLine(answer.status, answer.body, ctx)
    }

}

/**
 * The run.
 *
 * @returns {Promise<number>} Exit code
 */
async function main() {

    let server = child_process.spawn(process.execPath, ['-e', server_code], { stdio : ['ignore', 'pipe', 'inherit'] })
    let port   = await new Promise(function(resolve) {

        server.stdout.once('data', function(chunk) {

            resolve(Number(String(chunk).trim()))

        })

    })
    let result = null

    try {

        result = getLine(port, 'echo')
        check('POST with no session and no client key', result.answer.body && result.answer.body.method === 'POST' && result.answer.body.auth === null && result.answer.body.key === null)

        result = getLine(port, 'ok')
        check('200: pulled and removed counted', result.line.level === 'ok' && result.line.text === 'pull: 4 pulled, 1 removed', result.line.text)

        result = getLine(port, 'linked')
        check('409: not linked, the link page named', result.line.level === 'info' && result.line.text.indexOf('open https://ducky-test.localhost/local/link') > -1, result.line.text)

        result = getLine(port, 'revoked')
        check('401: revoked, the api\'s message', result.line.level === 'warn' && result.line.text.indexOf('This machine is unlinked.') > -1, result.line.text)

        result = getLine(port, 'offline')
        check('503: cloud offline', result.line.level === 'warn' && /offline/.test(result.line.text), result.line.text)

        result = getLine(port, 'html')
        check('other status, html body: a warning, no throw', result.line.level === 'warn' && result.line.text === 'pull: not done (502)', result.line.text)

        result = commands.getPull('http://127.0.0.1:1/none')
        check('no answer: a warning, no throw', result.status === 0 && commands.getPullLine(result.status, result.body, ctx).text === 'pull: not done (no answer)')

    } finally {
        server.kill()
    }

    return rows.every(Boolean) ? 0 : 1

}

// ---

main().then(function(code) {

    process.exitCode = code

})
