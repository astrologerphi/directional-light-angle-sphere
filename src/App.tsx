import { useEffect, useState } from 'react';
import WebGPUVisualization from './components/WebGPUVisualization';
import './App.css';

function App() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (!navigator.gpu) {
      setIsSupported(false);
    } else {
      setIsSupported(true);
    }
  }, []);

  if (isSupported === null) {
    return (
      <div className="app">
        <div className="loading">Checking WebGPU support...</div>
      </div>
    );
  }

  if (isSupported === false) {
    return (
      <div className="app">
        <div className="error">
          <h2>WebGPU Not Supported</h2>
          <p>Your browser does not support WebGPU. Please use a browser with WebGPU enabled.</p>
          <p>Recommended: Chrome 113+ or Edge 113+ with WebGPU enabled.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Directional Light Angle Sphere</h1>
        <p>Visualizing periodic changes in directional light direction</p>
      </header>
      <WebGPUVisualization />
    </div>
  );
}

export default App;
