import { initWebGPUVisualization, VisualizationController } from './webgpu/visualization';

const canvas = document.getElementById('webgpuCanvas');
const statusMessage = document.getElementById('statusMessage');
const toggleButton = document.getElementById('toggleButton');

if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #webgpuCanvas not found.');
}

if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error('Toggle button #toggleButton not found.');
}

let controller: VisualizationController | null = null;

const setStatus = (message: string) => {
    if (statusMessage) {
        statusMessage.textContent = message;
    }
};

const updateToggleLabel = (isRunning: boolean) => {
    toggleButton.textContent = isRunning ? 'Pause' : 'Play';
};

const bootstrap = async () => {
    if (!navigator.gpu) {
        setStatus('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
        toggleButton.textContent = 'Unsupported';
        toggleButton.disabled = true;
        return;
    }

    try {
        setStatus('Initializing WebGPU...');
        controller = await initWebGPUVisualization(canvas, statusMessage);
        toggleButton.disabled = false;
        updateToggleLabel(true);
        setStatus('WebGPU ready. Playing animation.');
    } catch (error) {
        console.error(error);
        toggleButton.textContent = 'Error';
        toggleButton.disabled = true;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to start WebGPU: ${message}`);
    }
};

void bootstrap();

toggleButton.addEventListener('click', () => {
    if (!controller) return;

    if (controller.running) {
        controller.pause();
        updateToggleLabel(false);
        setStatus('Paused. Click play to resume.');
    } else {
        controller.resume();
        updateToggleLabel(true);
        setStatus('WebGPU ready. Playing animation.');
    }
});

window.addEventListener('beforeunload', () => {
    controller?.stop();
});
