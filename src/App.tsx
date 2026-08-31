/**
 * Placeholder shell. The scene canvas fills the viewport region and the chest and
 * inspector become floating rails over it; see docs/DESIGN.md.
 */
function App() {
  return (
    <div className="by-viewport">
      <div className="by-empty">
        <p className="by-empty__title">Nothing on the baseplate yet</p>
        <p className="by-empty__body">Open the chest and pick a piece.</p>
      </div>
    </div>
  )
}

export default App
