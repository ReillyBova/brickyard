import { BuilderCanvas } from './scene/interaction/BuilderCanvas.tsx'

/**
 * The viewport is the floor. Chrome — chest, inspector, toolbar — floats over it as
 * rafts rather than boxing it in; see docs/DESIGN.md.
 */
function App() {
  return (
    <div className="by-viewport">
      <BuilderCanvas />
    </div>
  )
}

export default App
