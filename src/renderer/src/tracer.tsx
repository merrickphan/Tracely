import React from 'react'
import ReactDOM from 'react-dom/client'
import TracerApp from './TracerApp'
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/500.css'
import '@fontsource/instrument-sans/600.css'
import '@fontsource/instrument-sans/700.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TracerApp />
  </React.StrictMode>
)
