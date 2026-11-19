// util.js — the installer's small helpers: running commands, asking,
// printing, rendering templates. No dependencies beyond node.

let child_process = require('child_process')
let fs            = require('fs')
let path          = require('path')
let readline      = require('readline')

// ---

let dir_root = path.resolve(__dirname, '..')

/**
 * Runs a command, returns { code, out, err } and never throws.
 *
 * @param   {string} cmd     - The program
 * @param   {array}  args    - Its arguments
 * @param   {object} options - child_process options (cwd, env, input)
 * @returns {object} { code, err, out }
 */
function exec(cmd, args, options) {

    let result = null

    options = options || {}

    try {
        result = child_process.spawnSync(cmd, args || [], {
            cwd      : options.cwd,
            encoding : 'utf8',
            env      : Object.assign({}, process.env, options.env || {}),
            input    : options.input,
            stdio    : options.inherit ? 'inherit' : 'pipe',
            timeout  : options.timeout || 0
        })
    } catch (e) {
        return { code : 1, err : e.message, out : '' }
    }

    return {
        code : result.status === null ? 1 : result.status,
        err  : String(result.stderr || (result.error ? result.error.message : '')),
        out  : String(result.stdout || '')
    }

}

/**
 * Whether a program is on the PATH.
 *
 * @param   {string} name - The program
 * @returns {(string|null)} Its path
 */
function getWhich(name) {

    let result = exec('/usr/bin/which', [name])

    return result.code === 0 ? result.out.trim() : null

}

/**
 * Asks a yes/no question on the terminal. No terminal = no.
 *
 * @param   {string} question - The question
 * @returns {Promise<boolean>} The answer
 */
function ask(question) {

    if (!process.stdin.isTTY) return Promise.resolve(false)

    return new Promise(function(resolve) {

        let rl = readline.createInterface({ input : process.stdin, output : process.stdout })

        rl.question(question + ' [y/N] ', function(answer) {

            rl.close()
            resolve(/^y(es)?$/i.test(String(answer).trim()))

        })

    })

}

/**
 * Asks for a line of text (hidden when secret). No terminal = ''.
 *
 * @param   {string}  question - The prompt
 * @param   {boolean} secret   - Hide the typing
 * @returns {Promise<string>} The answer
 */
function askLine(question, secret) {

    if (!process.stdin.isTTY) return Promise.resolve('')

    return new Promise(function(resolve) {

        let rl = readline.createInterface({ input : process.stdin, output : process.stdout, terminal : true })

        if (secret) {
            rl._writeToOutput = function(text) {

                if (text.indexOf(question) === 0) rl.output.write(text)

            }
        }

        rl.question(question + ' ', function(answer) {

            rl.close()
            if (secret) process.stdout.write('\n')
            resolve(String(answer).trim())

        })

    })

}

/**
 * Renders a template from templates/ with {{TOKEN}} placeholders.
 *
 * @param   {string} name   - The template file
 * @param   {object} tokens - TOKEN -> value
 * @returns {string} The text
 */
function render(name, tokens) {

    let text = fs.readFileSync(path.join(dir_root, 'templates', name), 'utf8')

    Object.keys(tokens).forEach(function(key) {

        text = text.split('{{' + key + '}}').join(String(tokens[key]))

    })

    if (/\{\{[A-Z_]+\}\}/.test(text)) throw new Error('template ' + name + ' has an unfilled token: ' + /\{\{[A-Z_]+\}\}/.exec(text)[0])

    return text

}

/**
 * Prints one status line.
 *
 * @param {string} tag  - ok, err, warn, dry, info, plan
 * @param {string} text - The line
 */
function say(tag, text) {

    let pad = tag.length < 4 ? ' '.repeat(4 - tag.length) : ''

    console.log('[' + tag + '] ' + pad + text)

}

/**
 * Writes a file only when its content changed.
 *
 * @param   {string} file    - Absolute path
 * @param   {string} content - The content
 * @param   {number} mode    - File mode
 * @returns {boolean} True when written
 */
function setFile(file, content, mode) {

    let current = null

    try {
        current = fs.readFileSync(file, 'utf8')
    } catch (e) {
        current = null
    }

    if (current === content) {
        if (mode) fs.chmodSync(file, mode)
        return false
    }

    fs.mkdirSync(path.dirname(file), { recursive : true })
    fs.writeFileSync(file, content, mode ? { mode : mode } : undefined)
    if (mode) fs.chmodSync(file, mode)

    return true

}

module.exports = {
    ask,
    askLine,
    dir_root,
    exec,
    getWhich,
    render,
    say,
    setFile
}
