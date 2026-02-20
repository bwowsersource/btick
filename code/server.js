var http = require('http');
var fs = require('fs');
const backtick = require('./index');
const { name, version } = require('../package.json');
const { awaitSeries } = require('./utils');
const { createCaptureControls } = require('./captureGroups');

const PORT = 8083;
const RESOURCE_ROOT = '/resources'

const exampleGlobal = {
    about: "Hello, this is " + name + '@' + version,
    repeat: (() => {
        const controls = createCaptureControls();

        const loopHandler = (initCondState, cond) => {
            const handler = async (render) => {
                let out = '';
                const condState = { ...initCondState }
                while (1) {
                    const state = cond(condState);
                    if (!state) break;
                    out += await render(condState);

                    Object.assign(condState, state)
                }
                return out;
            }
            handler.markers = controls.markers
            return handler;
        }
        // const handler = loopHandler;
        loopHandler.end = controls.end();
        return loopHandler;
    })(),
}
const examplePayload = {
    "name": {
        "morning": "Akash",
        "evening": "Webcrafti"
    }
}


async function jsmlRouter(req) {
    const path = req.url;
    const filePath = '.' + RESOURCE_ROOT + path + (/\.jsml$/.test(path) ? '' : '.jsml')
    try {
        const template = fs.readFileSync(filePath, { encoding: 'utf-8' });
        const groomed = backtick.groom(template);
        return backtick(groomed, { ...exampleGlobal, args: examplePayload });
    } catch (e) {
        console.error(e);
        return { text: "Not found!!", ctx: null }
    }
}

http.createServer(function (req, res) {
    jsmlRouter(req).then(({ text, ctx }) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-CTX': JSON.stringify(ctx) });

        res.end(text);
    });

}).listen(PORT);

console.log("serving at http://localhost:" + PORT)