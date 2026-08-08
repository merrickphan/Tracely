import ReactDOM from 'react-dom/client'
import PreviewApp from './PreviewApp'
import './preview.css'
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/600.css'
import '@fontsource/instrument-sans/700.css'

// Deliberately not StrictMode: it double-invokes effects, which here would
// mean every previewed iframe mounts, tears down and remounts on load —
// doubling the IPC call log and making it useless as a record of what the
// UI actually did.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<PreviewApp />)
