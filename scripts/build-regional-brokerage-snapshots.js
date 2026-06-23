"use strict";
const path = require("path");
const root = path.resolve(__dirname, "..");
const publisher = require(path.join(root, "netlify", "functions", "lib", "regional-brokerage-publisher.v1"));
const report = publisher.publishFromSearchBank({ root, trigger: "netlify-build" });
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
