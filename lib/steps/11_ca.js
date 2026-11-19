// 11_ca.js — mkcert's local CA in the System keychain (mkcert -install:
// a keychain password prompt, asked first). Skipped when already trusted.

let fs   = require('fs')
let path = require('path')

let util = require('../util')

// ---

/**
 * Whether mkcert's CA exists and is in the System keychain.
 *
 * @returns {object} { detail, ok }
 */
function getTrusted() {

    let caroot  = util.exec('mkcert', ['-CAROOT']).out.trim()
    let file    = path.join(caroot, 'rootCA.pem')
    let subject = null

    if (!caroot || !fs.existsSync(file)) return { detail : 'no mkcert CA yet', ok : false }

    subject = /CN\s*=\s*([^,\n]+)/.exec(util.exec('/usr/bin/openssl', ['x509', '-noout', '-subject', '-in', file]).out)

    if (!subject) return { detail : 'the mkcert CA is unreadable', ok : false }
    if (util.exec('/usr/bin/security', ['find-certificate', '-c', subject[1].trim(), '/Library/Keychains/System.keychain']).code !== 0) return { detail : 'the mkcert CA is not trusted yet', ok : false }

    return { detail : 'mkcert CA trusted (' + subject[1].trim() + ')', ok : true }

}

module.exports = {
    getTrusted,
    key   : 'ca',
    sudo  : true,
    title : 'trust the mkcert CA (mkcert -install, keychain password)',
    apply : function() {

        let result = util.exec('mkcert', ['-install'], { inherit : true })

        return { detail : 'mkcert -install exited ' + result.code, ok : result.code === 0 }

    },
    check : function() {

        let trusted = getTrusted()

        return trusted.ok ? trusted : { detail : 'mkcert -install', ok : false }

    }
}
