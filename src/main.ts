import { lightAnglePaths } from './data';
import { initWebGPUVisualization, VisualizationController, getAvailablePaths } from './webgpu/visualization';

const canvas = document.getElementById('webgpuCanvas');
const statusMessage = document.getElementById('statusMessage');
const toggleButton = document.getElementById('toggleButton');
const pathList = document.getElementById('pathList');
const pathSearch = document.getElementById('pathSearch');
const currentPathEl = document.getElementById('currentPath');

if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #webgpuCanvas not found.');
}

if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error('Toggle button #toggleButton not found.');
}

let controller: VisualizationController | null = null;
let currentPath = 'default';
let focusedIndex = -1;

const setStatus = (message: string) => {
    if (statusMessage) {
        statusMessage.textContent = message;
    }
};

const updateToggleLabel = (isRunning: boolean) => {
    toggleButton.textContent = isRunning ? 'Pause' : 'Play';
};

const updateCurrentPath = (path: string) => {
    currentPath = path;
    if (currentPathEl) {
        currentPathEl.textContent = path;
    }
};

const populatePathList = () => {
    if (!pathList) return;

    const paths = getAvailablePaths();
    pathList.innerHTML = '';

    paths.forEach(path => {
        const li = document.createElement('li');
        const pathData = lightAnglePaths[path];
        const title = pathData?.title || path;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'path-name';
        nameSpan.textContent = path;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'path-title';
        titleSpan.textContent = title;

        li.appendChild(nameSpan);
        li.appendChild(titleSpan);

        li.dataset.path = path;
        li.dataset.title = title;
        if (path === currentPath) {
            li.classList.add('active');
        }
        li.addEventListener('click', () => selectPath(path));
        pathList.appendChild(li);
    });
};

const selectPath = async (path: string) => {
    if (path === currentPath) return;

    // Update UI
    const items = pathList?.querySelectorAll('li');
    items?.forEach(item => {
        item.classList.toggle('active', item.dataset.path === path);
    });

    updateCurrentPath(path);

    // Stop current visualization
    controller?.stop();
    controller = null;

    // Reinitialize with new path
    try {
        setStatus(`Loading ${path}...`);
        toggleButton.disabled = true;
        controller = await initWebGPUVisualization(canvas, statusMessage, path);
        toggleButton.disabled = false;
        updateToggleLabel(true);
        setStatus(`Playing: ${path}`);
    } catch (error) {
        console.error(error);
        toggleButton.textContent = 'Error';
        toggleButton.disabled = true;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to load ${path}: ${message}`);
    }
};

const filterPaths = (searchTerm: string) => {
    const items = pathList?.querySelectorAll('li');
    const term = searchTerm.toLowerCase();

    items?.forEach(item => {
        const path = item.dataset.path?.toLowerCase() || '';
        const title = item.dataset.title?.toLowerCase() || '';
        const matches = path.includes(term) || title.includes(term);
        item.classList.toggle('hidden', !matches);
    });

    // Reset focused index when filtering
    focusedIndex = -1;
};

const getVisibleItems = (): HTMLLIElement[] => {
    if (!pathList) return [];
    const items = pathList.querySelectorAll<HTMLLIElement>('li');
    return Array.from(items).filter(item => !item.classList.contains('hidden'));
};

const updateFocusedItem = (index: number) => {
    const visibleItems = getVisibleItems();
    if (visibleItems.length === 0) return;

    // Remove previous focus
    visibleItems.forEach(item => item.classList.remove('focused'));

    // Clamp index to valid range
    focusedIndex = Math.max(0, Math.min(index, visibleItems.length - 1));

    // Add focus to new item
    const focusedItem = visibleItems[focusedIndex];
    focusedItem.classList.add('focused');

    // Scroll into view if needed
    focusedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

const handleKeyboardNavigation = (e: KeyboardEvent) => {
    const visibleItems = getVisibleItems();
    if (visibleItems.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateFocusedItem(focusedIndex + 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateFocusedItem(focusedIndex - 1);
    }
    const focusedItem = visibleItems[focusedIndex];
    if (focusedItem && focusedItem.dataset.path) {
        void selectPath(focusedItem.dataset.path);
    }
};

const bootstrap = async () => {
    populatePathList();

    if (!navigator.gpu) {
        setStatus('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
        toggleButton.textContent = 'Unsupported';
        toggleButton.disabled = true;
        return;
    }

    try {
        setStatus('Initializing WebGPU...');
        controller = await initWebGPUVisualization(canvas, statusMessage, currentPath);
        toggleButton.disabled = false;
        updateToggleLabel(true);
        setStatus(`Playing: ${currentPath}`);
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
        setStatus(`Playing: ${currentPath}`);
    }
});

pathSearch?.addEventListener('input', e => {
    const target = e.target as HTMLInputElement;
    filterPaths(target.value);
});

window.addEventListener('keydown', handleKeyboardNavigation);

window.addEventListener('beforeunload', () => {
    controller?.stop();
});

window.lightAnglePaths = lightAnglePaths;
