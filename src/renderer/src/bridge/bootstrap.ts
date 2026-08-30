// Runs inside each entry document, before that window's own entry script.
//
// web.vite.config.mts injects this as a module script at the top of <head>
// for index/floating/overlay.html — in dev AND in the built dist-web output.
// ES module scripts execute in document order, which is what guarantees
// `window.tracely` exists by the time the real app's entry module runs — the
// same guarantee the preload contextBridge gives it in the Electron build,
// and the same injection pattern preview/vite.config.mts uses for the mock.
//
// Unlike the preview bootstrap there is no harness to find on window.parent:
// this bridge talks HTTP to the local Tracely server on the SAME ORIGIN the
// page was served from, so it works wherever the server is listening.
import { createHttpApi } from './httpApi'

window.tracely = createHttpApi()
