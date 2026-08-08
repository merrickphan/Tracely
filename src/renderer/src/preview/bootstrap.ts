// Runs inside each previewed iframe, before that window's own entry script.
//
// The preview Vite config injects this as a module script at the top of
// <head> for index/floating/overlay/tracer.html. ES module scripts execute
// in document order, which is what guarantees `window.tracely` exists by the
// time the real app's entry module runs — the same guarantee the preload
// contextBridge gives it in production.
//
// Nothing on disk in those four HTML files changes: the injection happens
// only under preview/vite.config.mts, so the shipped build is untouched.
import { createMockApi } from './mockApi'
import type { PreviewBridge } from './PreviewApp'

const bridge = (window.parent as Window & { __tracelyPreview?: PreviewBridge }).__tracelyPreview

if (!bridge) {
  // Someone opened a real entry directly instead of through the harness.
  // Failing loudly beats rendering a window whose every call is undefined.
  document.body.innerHTML =
    '<pre style="font:12px ui-monospace;padding:16px;color:#d6301a">Preview bootstrap: no harness found on window.parent. Open this through preview.html (npm run preview).</pre>'
} else {
  window.tracely = createMockApi(bridge.scenario, bridge.log, bridge.onTracerClose)
}
