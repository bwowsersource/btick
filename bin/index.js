#!/usr/bin/env node

const fs = require('fs');
const { stdout } = require('process');
const backtick = require('../code/index');

const filename = process.argv[2];
const argsjson = process.argv[3];
if (!filename) throw new Error("No input file provided!");

const template = fs.readFileSync(filename, { encoding: 'utf8', flag: 'r' });
const groomedTemplate = backtick.groom(template);
let args = {}
if (argsjson) {
    args = JSON.parse(fs.readFileSync(argsjson, { encoding: 'utf8', flag: 'r' }));
    // console.log(args);
}

(async () => {
    const { text, render } = await backtick(groomedTemplate, args);
    const {text: rerenderedText} = await render({name:"bro"});
    // const confirmRerender = "Re-render works!!"
    stdout.write(text+'\n' + rerenderedText + '\n');
})().catch((error) => {
    process.stderr.write(String(error?.stack || error?.message || error));
    process.exit(1);
});