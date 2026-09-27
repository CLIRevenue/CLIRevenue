import Cinema from './components/Cinema.jsx'
import Console from './components/console/Console.jsx'
import './App.css'

/* The film keeps its own <main> and its own scroll geometry. The
   console is appended after it, outside that main, so no chapter
   measurement in the cinema hook ever sees it. */
function App() {
  return (
    <>
      <Cinema />
      <Console />
    </>
  )
}

export default App
