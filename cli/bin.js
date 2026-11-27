#!/usr/bin/env node
"use strict";

require("./index")
  .main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    process.stderr.write(`dash-check broke: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 2;
  });
