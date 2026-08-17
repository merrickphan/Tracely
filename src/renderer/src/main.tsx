import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ResizeGrips from './components/ResizeGrips'
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/500.css'
import '@fontsource/instrument-sans/600.css'
import '@fontsource/instrument-sans/700.css'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  // Grips here rather than inside App: they are window chrome, not app content,
  // and App returns four different trees (checking / signed out / needs name /
  // ready) that would each need their own copy. They are `position: fixed`, so
  // a sibling of the app is exactly as correct as a child of it.
  //
  // The MAIN window's entry only. floating.tsx and overlay.tsx are separate
  // documents in separate windows — the floating popup is a fixed-size panel
  // and the overlay is click-through by design.
  <React.StrictMode>
    <App />
    <ResizeGrips />
  </React.StrictMode>
)
