// 10_migrations.js — the api's ordered, idempotent local migrations
// (ducky_platform_api/scripts/local-migrations/NNN-*.js); the ones run are
// recorded in config/migrations.json.

let migrations = require('../migrations')

// ---

module.exports = {
    key   : 'migrations',
    sudo  : false,
    title : 'local migrations',
    apply : function(ctx) {

        let result = migrations.run(ctx.settings, ctx.paths)

        return { detail : result.ran.length + ' ran' + (result.failed ? ', ' + result.failed + ' failed' : ''), ok : !result.failed }

    },
    check : function(ctx) {

        let pending = migrations.getPending(ctx.paths)

        return pending.length ? { detail : 'run ' + pending.join(', '), ok : false } : { detail : 'none pending', ok : true }

    }
}
