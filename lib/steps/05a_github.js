// 05a_github.js — this machine reaches the org's GitHub repos over ssh:
// an ssh key on the machine, the key on the person's GitHub account, and
// that account in the org. The code and the encrypted secrets are cloned
// with it, and the secrets are decrypted with the same key.

let fs   = require('fs')
let os   = require('os')
let path = require('path')

let util = require('../util')

// ---

let dir_ssh = path.join(os.homedir(), '.ssh')

// the key names ssh tries by default, the preferred one first
let key_names = ['id_ed25519', 'id_ecdsa', 'id_rsa']

// ssh never asks anything in a check: no host prompt, no passphrase
let ssh_options = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10']

/**
 * The first ssh key on the machine with its public half.
 *
 * @returns {(string|null)} The private key file
 */
function getKey() {

    let found = null

    key_names.forEach(function(name) {

        let file = path.join(dir_ssh, name)

        if (!found && fs.existsSync(file) && fs.existsSync(file + '.pub')) found = file

    })

    return found

}

/**
 * The GitHub account this machine's key signs in as.
 *
 * @returns {(string|null)} The login, null when GitHub does not know the key
 */
function getLogin() {

    let result = util.exec('/usr/bin/ssh', ssh_options.concat(['-T', 'git@github.com']), { timeout : 20000 })
    let match  = /Hi ([^!]+)! You've successfully authenticated/.exec(result.err + result.out)

    return match ? match[1] : null

}

/**
 * Whether the account reaches the org's repos (one repo as the probe).
 *
 * @param   {object}  ctx - The run context
 * @returns {boolean} True when it does
 */
function getAccess(ctx) {

    let url    = 'git@github.com:' + ctx.settings.github_org + '/ducky-platform-api.git'
    let result = util.exec('git', ['ls-remote', url, 'HEAD'], {
        env     : { GIT_SSH_COMMAND : 'ssh ' + ssh_options.join(' '), GIT_TERMINAL_PROMPT : '0' },
        timeout : 30000
    })

    return result.code === 0

}

/**
 * Creates an ed25519 key; ssh-keygen asks the passphrase itself. With a
 * passphrase the macOS keychain keeps it (no asking on every git call).
 *
 * @returns {(string|null)} The private key file
 */
function newKey() {

    let file   = path.join(dir_ssh, 'id_ed25519')
    let config = path.join(dir_ssh, 'config')
    let text   = ''
    let result = null

    console.log('')
    console.log('       A new ssh key for this machine: ' + file)
    console.log('       ssh-keygen asks a passphrase now. Recommended: set one, the')
    console.log('       macOS keychain remembers it, you type it only this once.')
    console.log('')

    fs.mkdirSync(dir_ssh, { mode : 0o700, recursive : true })

    result = util.exec('/usr/bin/ssh-keygen', ['-t', 'ed25519', '-C', os.userInfo().username + '@' + os.hostname() + ' (ducky)', '-f', file], { inherit : true })

    if (result.code !== 0) return null

    try {
        text = fs.readFileSync(config, 'utf8')
    } catch (e) {
        text = ''
    }

    // IMPORTANT
    // only appended when no github.com entry exists, an own one stays
    // as it is

    if (!/^\s*Host\s+.*github\.com/m.test(text)) {
        fs.appendFileSync(config, (text && !/\n$/.test(text) ? '\n' : '') + '\nHost github.com\n    AddKeysToAgent yes\n    UseKeychain yes\n    IdentityFile ' + file + '\n', { mode : 0o600 })
    }

    util.exec('/usr/bin/ssh-add', ['--apple-use-keychain', file], { inherit : true })

    return file

}

/**
 * Gets the public key onto the person's GitHub account: with the gh cli
 * when it is signed in (asked), else clipboard + the GitHub page, then
 * waits until GitHub knows the key.
 *
 * @param   {string} file - The private key file
 * @returns {Promise<(string|null)>} The login, null when given up
 */
async function setKeyOnGitHub(file) {

    let key   = fs.readFileSync(file + '.pub', 'utf8').trim()
    let title = os.hostname().replace(/\.local$/, '') + ' (ducky)'
    let gh    = util.getWhich('gh') && util.exec('gh', ['auth', 'status']).code === 0
    let login = null
    let tries = 0

    console.log('')
    console.log('       GitHub does not know this machine yet. Its public key:')
    console.log('')
    console.log('       ' + key)
    console.log('')
    console.log('       (the public half only: safe to show, the private key never leaves')
    console.log('       ' + file + ')')
    console.log('')

    if (gh && await util.ask('       add it with the gh cli you are signed in with?')) {
        util.exec('gh', ['ssh-key', 'add', file + '.pub', '--title', title], { inherit : true })
        login = getLogin()
        if (login) return login
    }

    util.exec('/usr/bin/pbcopy', [], { input : key + '\n' })
    util.exec('/usr/bin/open', ['https://github.com/settings/ssh/new'])

    console.log('       Copied to the clipboard, and GitHub opened in the browser:')
    console.log('       1. sign in with your GitHub account (the one in the org)')
    console.log('       2. Title: ' + title)
    console.log('       3. Key type: Authentication Key, Key: paste (cmd+v)')
    console.log('       4. Add SSH key')
    console.log('')

    while (tries < 5) {

        tries++

        if ((await util.askLine('       press enter once it is added (or type skip):')).toLowerCase() === 'skip') return null

        login = getLogin()

        if (login) return login

        console.log('       not yet: GitHub still does not know this key, check the page and try again')

    }

    return null

}

// ---

module.exports = {
    key   : 'github',
    sudo  : false,
    title : 'GitHub over ssh (a key on this machine, on your GitHub account, the org\'s repos reachable)',
    apply : async function(ctx) {

        let file  = getKey() || newKey()
        let login = null

        if (!file) return { detail : 'no ssh key created (ssh-keygen stopped)', ok : false }

        login = getLogin() || await setKeyOnGitHub(file)

        if (!login) return { detail : 'GitHub does not know ' + file + '.pub yet: add it, then run the install again', ok : false }
        if (!getAccess(ctx)) return { detail : 'signed in as ' + login + ', but no access to ' + ctx.settings.github_org + ': an org owner adds ' + login + ' to the org (github.com/orgs/' + ctx.settings.github_org + '/people)', ok : false }

        return { detail : 'signed in as ' + login + ' (' + file + '), ' + ctx.settings.github_org + ' reachable', ok : true }

    },
    check : function(ctx) {

        let file  = getKey()
        let login = file ? getLogin() : null

        if (!file) return { detail : 'no ssh key on this machine: create ~/.ssh/id_ed25519 and add it to your GitHub account', ok : false }
        if (!login) return { detail : 'GitHub does not know this machine\'s key (' + file + '.pub): add it to your GitHub account', ok : false }
        if (!getAccess(ctx)) return { detail : 'signed in as ' + login + ', but no access to ' + ctx.settings.github_org + ': an org owner adds ' + login + ' to the org', fatal : true, ok : false }

        return { detail : 'signed in as ' + login + ' (' + file + '), ' + ctx.settings.github_org + ' reachable', ok : true }

    }
}
