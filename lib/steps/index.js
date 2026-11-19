// index.js — the install steps in order. Each step: check(ctx) -> { ok,
// detail, fatal? }, apply(ctx) -> { ok, detail } (may be async), sudo
// true when it needs a password (always asked, never with --yes alone).

module.exports = [
    require('./01_platform'),
    require('./02_brew'),
    require('./03_packages'),
    require('./04_dirs'),
    require('./05_sources'),
    require('./06_npm'),
    require('./07_python'),
    require('./08_whisper'),
    require('./09_config'),
    require('./10_migrations'),
    require('./11_ca'),
    require('./12_certs'),
    require('./13_hosts'),
    require('./14_nginx_file'),
    require('./15_nginx_reload'),
    require('./16_agents'),
    require('./17_command'),
    require('./18_sidequest')
]
