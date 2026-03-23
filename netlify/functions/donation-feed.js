
"use strict";

const builder = require("./donation-snapshot-builder");

exports.handler = async function(event, context){
  return builder.handler(event, context);
};
