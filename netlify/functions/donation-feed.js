
"use strict";

const snap = require("./donation-snapshot");

exports.handler = async function(event, context){
  return snap.handler(event, context);
};
