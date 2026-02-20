const { CAPTURE_END, CAPTURE_START, CAPTURED, COMMENT_CLOSE, TOKEN_CAPTURE_END, TOKEN_CAPTURE_START } = require('./consts');
const { renderParsedTokens } = require('./renderer');


function createCaptureControls() {

    const captureEndHandler = (inlineRenderer = () => '') => {
        const tokenGroup = (segments, statementFns, opener) => {
            return async function groupStatementFn(context) {
                const renderFn = (cgroupCtx) => {
                    return renderParsedTokens({ segments, statementFns, context: { ...context, ctx: cgroupCtx } }).then(({ text }) => text)
                }
                const openerRenderer = await opener(context);
                const renderer = typeof openerRenderer === "function" ? openerRenderer : inlineRenderer;
                return renderer(renderFn);
            }
        }
        tokenGroup.markers = [TOKEN_CAPTURE_END]
        return tokenGroup;
    }
    // const captureHandler = handler || defaultHandler;

    return Object.create({
        markers: [TOKEN_CAPTURE_START],
        end: captureEndHandler,

    })
}


module.exports = {
    createCaptureControls
}