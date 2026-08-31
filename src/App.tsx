import { SceneCanvas } from './scene/index.ts'

/**
 * The viewport is the floor. Chrome — chest, inspector, toolbar — floats over it as
 * rafts rather than boxing it in; see docs/DESIGN.md.
 */
function App() {
  return (
    <div className="by-viewport">
      <SceneCanvas />
    </div>
  )
}

export default App
