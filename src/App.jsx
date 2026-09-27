import Cinema from './components/Cinema.jsx'
import Console from './components/console/Console.jsx'
import Conversion from './components/conv/Conversion.jsx'
import './App.css'

/* The film keeps its own <main> and its own scroll geometry. The
   console and the conversion layer are appended after it, outside
   that main, so no chapter measurement in the cinema hook ever
   sees them. */
function App() {
  return (
    <>
      <Cinema />
      <Console />
      <Conversion />
    </>
  )
}

export default App
