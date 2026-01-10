import { lightAnglePaths } from './data';
import { initWebGPUVisualization, getAvailablePaths } from './webgpu/visualization-sphere';
import { initWebGPUVisualizationPlane } from './webgpu/visualization-plane';
import { initWebGPUVisualizationRing } from './webgpu/visualization-ring';
import { closestFraction, formatFraction, printPathData, printPathDataGroups } from './utils';

export interface VisualizationController {
    pause(): void;
    resume(): void;
    stop(): void;
    readonly running: boolean;
}

// Canvas elements
const sphereCanvas = document.getElementById('sphereCanvas');
const planeCanvas = document.getElementById('planeCanvas');
const ringCanvas = document.getElementById('ringCanvas');

// Status elements
const sphereStatus = document.getElementById('sphereStatus');
const planeStatus = document.getElementById('planeStatus');
const ringStatus = document.getElementById('ringStatus');

// UI controls
const toggleButton = document.getElementById('toggleButton');
const pathList = document.getElementById('pathList');
const pathSearch = document.getElementById('pathSearch');
const currentPathEl = document.getElementById('currentPath');
const selectedDataEl = document.getElementById('selectedData');

// Carousel controls
const carouselPrev = document.getElementById('carouselPrev');
const carouselNext = document.getElementById('carouselNext');
const carouselIndicators = document.querySelectorAll('.carousel__indicator');
const carouselSlides = document.querySelectorAll('.carousel__slide');
const carouselTitles = document.querySelectorAll('.carousel__title');

if (!(sphereCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #sphereCanvas not found.');
}

if (!(planeCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #planeCanvas not found.');
}

if (!(ringCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #ringCanvas not found.');
}

if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error('Toggle button #toggleButton not found.');
}

let sphereController: VisualizationController | null = null;
let planeController: VisualizationController | null = null;
let ringController: VisualizationController | null = null;
let currentPath = 'default';
let focusedIndex = -1;
let currentSlideIndex = 0;

const getActiveController = (): VisualizationController | null => {
    switch (currentSlideIndex) {
        case 0:
            return sphereController;
        case 1:
            return planeController;
        case 2:
            return ringController;
        default:
            return null;
    }
};

const setStatus = (message: string) => {
    // Update status for the currently active canvas
    const activeSlide = carouselSlides[currentSlideIndex];
    const statusEl = activeSlide?.querySelector('.status');
    if (statusEl) {
        statusEl.textContent = message;
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
    updateSelectedData(path);
};

const updateSelectedData = (path: string) => {
    if (!selectedDataEl) return;

    const pathData = lightAnglePaths[path];
    if (!pathData) {
        selectedDataEl.innerHTML = '<div class="no-data">No data available</div>';
        return;
    }

    const { title, ...segments } = pathData;
    const segmentKeys = Object.keys(segments).filter(k => k !== 'title');

    let html = `
        <div class="data-section">
            <div class="data-section__title">
                Path Information
            </div>
            <div class="data-item">
                <div class="data-grid">
                    <div class="data-grid__row">
                        <span class="data-grid__key">Name:</span>
                        <span class="data-grid__value">${path}</span>
                    </div>
                    <div class="data-grid__row">
                        <span class="data-grid__key">Title:</span>
                        <span class="data-grid__value">${title || 'N/A'}</span>
                    </div>
                    <div class="data-grid__row">
                        <span class="data-grid__key">Segments:</span>
                        <span class="data-grid__value">${segmentKeys.length}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (segmentKeys.length > 0) {
        html += `
            <div class="data-section">
                <div class="data-section__title">
                    Segments
                    <span class="data-section__badge">${segmentKeys.length}</span>
                </div>
        `;

        segmentKeys.forEach(segmentKey => {
            // @ts-ignore
            const segment = segments[segmentKey];
            const timeKeys = Object.keys(segment);

            html += `
                <div class="data-item">
                    <div class="data-item__header">
                        <span class="data-item__label">Segment ${segmentKey}</span>
                        <span class="data-item__value">${timeKeys.length} time${timeKeys.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="data-grid data-grid--vertical">
            `;

            timeKeys.slice(0, 10).forEach(timeKey => {
                const point = segment[timeKey];

                // Divide by PI and find fraction approximations
                const _x = point.x / Math.PI;
                const _y = point.y / Math.PI;

                const fracX = closestFraction(_x, 100);
                const fracY = closestFraction(_y, 100);

                const str_x = formatFraction(fracX.numerator, fracX.denominator);
                const str_y = formatFraction(fracY.numerator, fracY.denominator);

                html += `
                    <div class="data-grid__row data-grid__row--aligned">
                        <span class="data-grid__key">Time ${timeKey}h:</span>
                        <span class="data-grid__value data-grid__value--x">${str_x} π</span>
                        <span class="data-grid__value data-grid__value--y">${str_y} π</span>
                    </div>
                `;
            });

            if (timeKeys.length > 10) {
                html += `
                    <div class="data-grid__row">
                        <span class="data-grid__key" style="opacity: 0.6;">...</span>
                        <span class="data-grid__value" style="opacity: 0.6;">${timeKeys.length - 10} more</span>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    }

    selectedDataEl.innerHTML = html;
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

    // Stop all visualizations
    sphereController?.stop();
    planeController?.stop();
    ringController?.stop();
    sphereController = null;
    planeController = null;
    ringController = null;

    // Reinitialize with new path for all views
    try {
        setStatus(`Loading ${path}...`);
        toggleButton.disabled = true;

        // Initialize sphere view
        sphereController = await initWebGPUVisualization(sphereCanvas, sphereStatus, path);

        // Initialize plane view
        planeController = await initWebGPUVisualizationPlane(planeCanvas, planeStatus, path);

        // Initialize ring view (torus)
        ringController = await initWebGPUVisualizationRing(ringCanvas, ringStatus, path);

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
    // Skip if carousel navigation keys are pressed
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        return;
    }

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
    updateSelectedData(currentPath); // Initialize with default path

    if (!navigator.gpu) {
        setStatus('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
        toggleButton.textContent = 'Unsupported';
        toggleButton.disabled = true;
        return;
    }

    try {
        setStatus('Initializing WebGPU...');

        // Initialize all visualizations
        sphereController = await initWebGPUVisualization(sphereCanvas, sphereStatus, currentPath);
        planeController = await initWebGPUVisualizationPlane(planeCanvas, planeStatus, currentPath);
        ringController = await initWebGPUVisualizationRing(ringCanvas, ringStatus, currentPath);

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

// Carousel navigation
const updateCarousel = (index: number) => {
    currentSlideIndex = index;

    // Update slides
    carouselSlides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
    });

    // Update indicators
    carouselIndicators.forEach((indicator, i) => {
        indicator.classList.toggle('active', i === index);
    });

    // Update titles
    carouselTitles.forEach((title, i) => {
        title.classList.toggle('active', i === index);
    });
};

const nextSlide = () => {
    const nextIndex = (currentSlideIndex + 1) % carouselSlides.length;
    updateCarousel(nextIndex);
};

const prevSlide = () => {
    const prevIndex = (currentSlideIndex - 1 + carouselSlides.length) % carouselSlides.length;
    updateCarousel(prevIndex);
};

carouselNext?.addEventListener('click', nextSlide);
carouselPrev?.addEventListener('click', prevSlide);

carouselIndicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
        updateCarousel(index);
    });
});

// Keyboard navigation for carousel
window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') {
        prevSlide();
    } else if (e.key === 'ArrowRight') {
        nextSlide();
    }
});

// Initialize carousel
updateCarousel(0);

toggleButton.addEventListener('click', () => {
    const controller = getActiveController();
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
    sphereController?.stop();
    planeController?.stop();
    ringController?.stop();
});

window.lightAnglePaths = lightAnglePaths;
window.printPathData = printPathData;
window.printPathDataGroups = printPathDataGroups;
