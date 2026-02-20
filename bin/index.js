#!/usr/bin/env node

const fs = require('fs');
const { stdout, stdin } = require('process');
const backtick = require('../code/index');

const filename = process.argv[2];
const argsjson = process.argv[3];
if (!filename) throw new Error("No input file provided!");

const template = fs.readFileSync(filename, { encoding: 'utf8', flag: 'r' });
const groomedTemplate = backtick.groom(template);
const readStdin = () => new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
        data += chunk;
    });
    stdin.on('end', () => {
        resolve(data.trim());
    });
    stdin.on('error', reject);
});

const readArgs = async () => {
    if (argsjson) {
        return JSON.parse(fs.readFileSync(argsjson, { encoding: 'utf8', flag: 'r' }));
    }
    if (stdin.isTTY) {
        return {};
    }
    const stdinData = await readStdin();
    if (!stdinData) {
        return {};
    }
    return JSON.parse(stdinData);
};

(async () => {
    const args = await readArgs();
    const { text } = await backtick(groomedTemplate, args);
    stdout.write(text);
})().catch((error) => {
    process.stderr.write(String(error?.stack || error?.message || error));
    process.exit(1);
});
