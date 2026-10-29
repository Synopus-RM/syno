#!/usr/bin/env node
'use strict';
// SessionEnd: this session no longer counts as running on the device.
const sessions = require('../lib/sessions');
const c = require('../lib/common');

async function run(input = {}) {
  sessions.unregister(input.session_id);
  return null;
}

module.exports = { run };

if (require.main === module) {
  c.readStdin()
    .then(raw => run(JSON.parse(raw || '{}')))
    .catch(() => {})
    .finally(() => process.exit(0));
}
