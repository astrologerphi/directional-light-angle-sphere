import { lightAnglePaths, lightPathGroups } from './data';
import { initWebGPUVisualization } from './webgpu/visualization-sphere';
import { initWebGPUVisualizationPlane } from './webgpu/visualization-plane';
import { initWebGPUVisualizationRing } from './webgpu/visualization-ring';
import { initWebGPUVisualizationCylinder } from './webgpu/visualization-cylinder';
import { initHexagonVisualization, HexagonController, TOWER_TOP_POSITIONS } from './webgpu/visualization-hexagon';
import { initPuzzleEditor, PuzzleEditorController } from './puzzle/editor';
import {
    printPathData,
    getPathDataGroups,
    getPathDataGroupsFormatted,
    calculateAndFormatClosestFraction,
    getSphereLineIntersectionPoints,
} from './utils';

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
const cylinderCanvas = document.getElementById('cylinderCanvas');
const puzzleSphereCanvas = document.getElementById('puzzleSphereCanvas');
const puzzlePlaneCanvas = document.getElementById('puzzlePlaneCanvas');

// Status elements
const sphereStatus = document.getElementById('sphereStatus');
const planeStatus = document.getElementById('planeStatus');
const ringStatus = document.getElementById('ringStatus');
const cylinderStatus = document.getElementById('cylinderStatus');
const puzzleSphereStatus = document.getElementById('puzzleSphereStatus');
const puzzlePlaneStatus = document.getElementById('puzzlePlaneStatus');

// UI controls
const toggleButton = document.getElementById('toggleButton');
const pathList = document.getElementById('pathList');
const pathSearch = document.getElementById('pathSearch');
const currentPathEl = document.getElementById('currentPath');
const selectedDataEl = document.getElementById('selectedData');
const puzzleFigureList = document.getElementById('puzzleFigureList');
const puzzleSidebarStatus = document.getElementById('puzzleSidebarStatus');
const puzzleSelectionSummary = document.getElementById('puzzleSelectionSummary');

// Carousel controls
const lightPathsPanel = document.querySelector('[data-panel="light-paths"]');
const carouselPrev = lightPathsPanel?.querySelector('#carouselPrev') ?? null;
const carouselNext = lightPathsPanel?.querySelector('#carouselNext') ?? null;
const carouselIndicators = lightPathsPanel?.querySelectorAll('.carousel__indicator') ?? [];
const carouselSlides = lightPathsPanel?.querySelectorAll('.carousel__slide') ?? [];
const carouselTitles = lightPathsPanel?.querySelectorAll('.carousel__title') ?? [];

if (!(sphereCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #sphereCanvas not found.');
}

if (!(planeCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #planeCanvas not found.');
}

if (!(ringCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #ringCanvas not found.');
}

if (!(cylinderCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #cylinderCanvas not found.');
}

if (!(puzzleSphereCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #puzzleSphereCanvas not found.');
}

if (!(puzzlePlaneCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #puzzlePlaneCanvas not found.');
}

if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error('Toggle button #toggleButton not found.');
}

let sphereController: VisualizationController | null = null;
let planeController: VisualizationController | null = null;
let ringController: VisualizationController | null = null;
let cylinderController: VisualizationController | null = null;
let puzzleEditorController: PuzzleEditorController | null = null;
let currentGroupIndex = 0;
let focusedIndex = -1;
let currentSlideIndex = 0;

// Overlay groups tracking: Map of groupIndex -> color
const overlayGroups: Map<number, [number, number, number]> = new Map();

// Generate a random vibrant color
const generateRandomColor = (): [number, number, number] => {
    const hue = Math.random();
    const saturation = 0.7 + Math.random() * 0.3; // 0.7-1.0
    const lightness = 0.5 + Math.random() * 0.2; // 0.5-0.7
    // HSL to RGB conversion
    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
    const m = lightness - c / 2;
    let r = 0,
        g = 0,
        b = 0;
    if (hue < 1 / 6) {
        r = c;
        g = x;
        b = 0;
    } else if (hue < 2 / 6) {
        r = x;
        g = c;
        b = 0;
    } else if (hue < 3 / 6) {
        r = 0;
        g = c;
        b = x;
    } else if (hue < 4 / 6) {
        r = 0;
        g = x;
        b = c;
    } else if (hue < 5 / 6) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }
    return [r + m, g + m, b + m];
};

const getActiveController = (): VisualizationController | null => {
    switch (currentSlideIndex) {
        case 0:
            return sphereController;
        case 1:
            return planeController;
        case 2:
            return ringController;
        case 3:
            return cylinderController;
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

const getCurrentGroupTitle = (groupIndex: number): string => {
    const group = lightPathGroups[groupIndex];
    if (!group) {
        return `Group ${groupIndex}`;
    }

    const titlesList = Object.values(group.titles);
    return titlesList.length > 0 ? titlesList[0] : `Group ${groupIndex}`;
};

const updateCurrentGroup = (groupIndex: number) => {
    currentGroupIndex = groupIndex;
    const title = getCurrentGroupTitle(groupIndex);
    if (currentPathEl) {
        currentPathEl.textContent = title;
    }
    updateSelectedData(groupIndex);
};

const updateSelectedData = (groupIndex: number) => {
    if (!selectedDataEl) return;

    const group = lightPathGroups[groupIndex];
    if (!group) {
        selectedDataEl.innerHTML = '<div class="no-data">No data available</div>';
        return;
    }

    const { titles, values } = group;

    // Get formatted data for this group
    const formattedGroups = getPathDataGroupsFormatted(lightAnglePaths);
    const formattedValues = formattedGroups[groupIndex]?.values || values;

    const pathNames = Object.keys(titles);
    const timeKeys = Object.keys(values);

    let html = `
        <div class="data-section">
            <div class="data-section__title">
                Group Information
            </div>
            <div class="data-item">
                <div class="data-grid">
                    <div class="data-grid__row">
                        <span class="data-grid__key">Group:</span>
                        <span class="data-grid__value">#${groupIndex}</span>
                    </div>
                    <div class="data-grid__row">
                        <span class="data-grid__key">Paths:</span>
                        <span class="data-grid__value">${pathNames.length}</span>
                    </div>
                    <div class="data-grid__row">
                        <span class="data-grid__key">Time Points:</span>
                        <span class="data-grid__value">${timeKeys.length}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Display values (formatted) - moved above titles
    if (timeKeys.length > 0) {
        html += `
            <div class="data-section">
                <div class="data-section__title">
                    Values
                    <span class="data-section__badge">${timeKeys.length}</span>
                </div>
                <div class="data-item">
                    <div class="data-grid data-grid--vertical">
        `;

        timeKeys.slice(0, 10).forEach(timeKey => {
            const point = formattedValues[timeKey];
            html += `
                <div class="data-grid__row data-grid__row--aligned">
                    <span class="data-grid__key">Time ${timeKey}h:</span>
                    <span class="data-grid__value data-grid__value--x">${point.x}</span>
                    <span class="data-grid__value data-grid__value--y">${point.y}</span>
                </div>
            `;
        });

        if (timeKeys.length > 10) {
            html += `
                <div class="data-grid__row">
                    <span class="data-grid__key" style="opacity: 0.6;">...</span>
                    <span class="data-grid__value" style="opacity: 0.6;\">${timeKeys.length - 10} more</span>
                </div>
            `;
        }

        html += `
                    </div>
                </div>
            </div>
        `;
    }

    // Display titles
    if (pathNames.length > 0) {
        html += `
            <div class="data-section">
                <div class="data-section__title">
                    Titles
                    <span class="data-section__badge">${pathNames.length}</span>
                </div>
        `;

        pathNames.forEach(pathName => {
            const title = titles[pathName];
            html += `
                <div class="data-item">
                    <div class="data-grid data-grid--vertical">
                        <div class="data-grid__row">
                            <span class="data-grid__key">${pathName}</span>
                        </div>
                        <div class="data-grid__row">
                            <span class="data-grid__value">${title}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    }

    selectedDataEl.innerHTML = html;
};

// Section colors based on values count
const sectionColors: Record<number, string> = {
    1: '#b54ee4', // Red - single value
    2: '#ffa94d', // Orange - 2 values
    3: '#ffd43b', // Yellow - 3 values
    4: '#69db7c', // Green - 4 values
    5: '#4dabf7', // Blue - 5 values
    6: '#3276bf', // Purple - 6 values
    7: '#1dd387', // Pink - 7 values
    8: '#7485d8', // Teal - 8+ values
};

const getSectionColor = (count: number): string => {
    if (count >= 8) return sectionColors[8];
    return sectionColors[count] || sectionColors[8];
};

const populatePathList = () => {
    if (!pathList) return;

    pathList.innerHTML = '';

    // Group items by values count
    const groupedByCount: Map<number, { group: (typeof lightPathGroups)[0]; index: number }[]> = new Map();

    lightPathGroups.forEach((group, index) => {
        const valuesCount = Object.keys(group.values).length;
        if (!groupedByCount.has(valuesCount)) {
            groupedByCount.set(valuesCount, []);
        }
        groupedByCount.get(valuesCount)!.push({ group, index });
    });

    // Sort by values count (ascending)
    const sortedCounts = Array.from(groupedByCount.keys()).sort((a, b) => a - b);

    sortedCounts.forEach(count => {
        const items = groupedByCount.get(count)!;
        const sectionColor = getSectionColor(count);

        // Create section header
        const sectionHeader = document.createElement('li');
        sectionHeader.className = 'section-header';
        sectionHeader.style.setProperty('--section-color', sectionColor);
        sectionHeader.innerHTML = `<span class="section-count">${count}</span><span class="section-label">${count === 1 ? 'value' : 'values'}</span><span class="section-items-count">(${items.length})</span>`;
        pathList.appendChild(sectionHeader);

        // Create items in this section
        items.forEach(({ group, index }) => {
            const li = document.createElement('li');
            li.style.setProperty('--section-color', sectionColor);
            const titlesList = Object.values(group.titles);
            const displayTitle = titlesList.length > 0 ? titlesList[0] : `Group ${index}`;

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'path-item-content';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'path-name';
            nameSpan.textContent = `Group ${index}`;

            const titleSpan = document.createElement('span');
            titleSpan.className = 'path-title';
            titleSpan.textContent = displayTitle;

            contentWrapper.appendChild(nameSpan);
            contentWrapper.appendChild(titleSpan);
            li.appendChild(contentWrapper);

            // Add overlay button for non-active items
            if (index !== currentGroupIndex) {
                const overlayBtn = document.createElement('button');
                overlayBtn.className = 'overlay-btn';
                overlayBtn.dataset.groupIndex = String(index);

                if (overlayGroups.has(index)) {
                    overlayBtn.classList.add('active');
                    overlayBtn.textContent = '−';
                    overlayBtn.title = 'Remove overlay';
                } else {
                    overlayBtn.textContent = '+';
                    overlayBtn.title = 'Add overlay';
                }

                overlayBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    toggleOverlay(index);
                });
                li.appendChild(overlayBtn);
            }

            li.dataset.groupIndex = String(index);
            li.dataset.title = displayTitle;
            if (index === currentGroupIndex) {
                li.classList.add('active');
            }
            li.addEventListener('click', () => selectGroup(index));
            pathList.appendChild(li);
        });
    });
};

const toggleOverlay = async (groupIndex: number) => {
    if (overlayGroups.has(groupIndex)) {
        // Remove overlay
        overlayGroups.delete(groupIndex);
    } else {
        // Add overlay with random color
        overlayGroups.set(groupIndex, generateRandomColor());
    }

    // Update the path list UI
    populatePathList();

    // Reinitialize visualizations with updated overlays
    await reinitializeWithOverlays();
};

const stopLightPathVisualizations = () => {
    sphereController?.stop();
    planeController?.stop();
    ringController?.stop();
    cylinderController?.stop();
    sphereController = null;
    planeController = null;
    ringController = null;
    cylinderController = null;
};

const stopPuzzleVisualizations = () => {
    puzzleEditorController?.destroy();
    puzzleEditorController = null;
};

const createCurrentPathData = (): {
    pathKey: string;
    pathData: {
        title: string;
        [id: string]: any;
    };
} => {
    const mainGroup = lightPathGroups[currentGroupIndex];
    const title = getCurrentGroupTitle(currentGroupIndex);

    if (overlayGroups.size === 0) {
        return {
            pathKey: `__temp_group_${currentGroupIndex}__`,
            pathData: {
                '0': mainGroup.values,
                title,
            },
        };
    }

    const combinedPathData: {
        title: string;
        [id: string]: any;
    } = {
        '0': mainGroup.values,
        title,
    };

    let segmentId = 1;
    overlayGroups.forEach((_color, groupIndex) => {
        const overlayGroup = lightPathGroups[groupIndex];
        if (!overlayGroup) return;
        combinedPathData[String(segmentId)] = overlayGroup.values;
        segmentId++;
    });

    return {
        pathKey: '__temp_combined__',
        pathData: combinedPathData,
    };
};

const updateTemporaryPathData = (): string => {
    const { pathKey, pathData } = createCurrentPathData();
    window.lightAnglePaths[pathKey] = pathData;
    return pathKey;
};

const initializeLightPathVisualizations = async (pathKey: string) => {
    sphereController = await initWebGPUVisualization(sphereCanvas, sphereStatus, pathKey);
    planeController = await initWebGPUVisualizationPlane(planeCanvas, planeStatus, pathKey);
    ringController = await initWebGPUVisualizationRing(ringCanvas, ringStatus, pathKey);
    cylinderController = await initWebGPUVisualizationCylinder(cylinderCanvas, cylinderStatus, pathKey);
};

const reinitializeWithOverlays = async () => {
    stopLightPathVisualizations();

    const tempPathKey = updateTemporaryPathData();

    try {
        setStatus('Updating visualizations...');
        toggleButton.disabled = true;

        await initializeLightPathVisualizations(tempPathKey);

        toggleButton.disabled = false;
        updateToggleLabel(true);
        setStatus(
            `Playing: Group ${currentGroupIndex}${overlayGroups.size > 0 ? ` (+${overlayGroups.size} overlays)` : ''}`
        );
    } catch (error) {
        console.error(error);
        toggleButton.textContent = 'Error';
        toggleButton.disabled = true;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to update: ${message}`);
    }
};

const selectGroup = async (groupIndex: number) => {
    if (groupIndex === currentGroupIndex) return;

    // Clear all overlays when selecting a new group
    overlayGroups.clear();

    // Update UI
    const items = pathList?.querySelectorAll('li');
    items?.forEach(item => {
        item.classList.toggle('active', item.dataset.groupIndex === String(groupIndex));
    });

    updateCurrentGroup(groupIndex);

    // Refresh the path list to update overlay buttons
    populatePathList();

    stopLightPathVisualizations();

    const tempPathKey = updateTemporaryPathData();

    // Reinitialize with new group for all views
    try {
        setStatus(`Loading Group ${groupIndex}...`);
        toggleButton.disabled = true;

        await initializeLightPathVisualizations(tempPathKey);

        toggleButton.disabled = false;
        updateToggleLabel(true);
        setStatus(`Playing: Group ${groupIndex}`);
    } catch (error) {
        console.error(error);
        toggleButton.textContent = 'Error';
        toggleButton.disabled = true;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to load Group ${groupIndex}: ${message}`);
    }
};

const filterPaths = (searchTerm: string) => {
    const items = pathList?.querySelectorAll('li');
    const term = searchTerm.toLowerCase();

    items?.forEach(item => {
        const groupIndex = item.dataset.groupIndex?.toLowerCase() || '';
        const title = item.dataset.title?.toLowerCase() || '';
        const matches = groupIndex.includes(term) || title.includes(term);
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
    if (e.defaultPrevented || !lightPathsPanel?.classList.contains('active')) {
        return;
    }

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
    if (focusedItem && focusedItem.dataset.groupIndex) {
        void selectGroup(Number(focusedItem.dataset.groupIndex));
    }
};

const bootstrap = async () => {
    populatePathList();
    updateCurrentGroup(currentGroupIndex);

    if (!navigator.gpu) {
        setStatus('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
        toggleButton.textContent = 'Unsupported';
        toggleButton.disabled = true;
        return;
    }

    try {
        setStatus('Initializing WebGPU...');

        const tempPathKey = updateTemporaryPathData();

        await initializeLightPathVisualizations(tempPathKey);

        toggleButton.disabled = false;
        updateToggleLabel(true);
        setStatus(`Playing: Group ${currentGroupIndex}`);
    } catch (error) {
        console.error(error);
        toggleButton.textContent = 'Error';
        toggleButton.disabled = true;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to start WebGPU: ${message}`);
    }
};

// Make data available on window before bootstrap
window.lightAnglePaths = lightAnglePaths;
window.printPathData = printPathData;
window.getPathDataGroups = getPathDataGroups;
window.getPathDataGroupsFormatted = getPathDataGroupsFormatted;
window.calculateAndFormatClosestFraction = calculateAndFormatClosestFraction;
window.getSphereLineIntersectionPoints = getSphereLineIntersectionPoints;
window.towerTopPositions = TOWER_TOP_POSITIONS;

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
    if (e.defaultPrevented || !lightPathsPanel?.classList.contains('active')) {
        return;
    }

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
        const group = lightPathGroups[currentGroupIndex];
        const titlesList = Object.values(group.titles);
        const displayTitle = titlesList.length > 0 ? titlesList[0] : `Group ${currentGroupIndex}`;
        setStatus(`Playing: ${displayTitle}`);
    }
});

pathSearch?.addEventListener('input', e => {
    const target = e.target as HTMLInputElement;
    filterPaths(target.value);
});

window.addEventListener('keydown', handleKeyboardNavigation);

window.addEventListener('beforeunload', () => {
    stopLightPathVisualizations();
    stopPuzzleVisualizations();
});

// Top-level tab navigation
const topNavTabs = document.querySelectorAll<HTMLButtonElement>('.top-nav__tab');
const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

topNavTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const targetPanel = tab.dataset.tab;
        if (!targetPanel) return;

        topNavTabs.forEach(t => t.classList.toggle('active', t === tab));
        tabPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === targetPanel));

        if (targetPanel === 'puzzle') {
            puzzleEditorController?.refresh();
        }
    });
});

if (!(puzzleFigureList instanceof HTMLElement)) {
    throw new Error('Puzzle figure list #puzzleFigureList not found.');
}

puzzleEditorController = initPuzzleEditor({
    planeCanvas: puzzlePlaneCanvas,
    sphereCanvas: puzzleSphereCanvas,
    figureList: puzzleFigureList,
    sidebarStatus: puzzleSidebarStatus,
    selectionSummary: puzzleSelectionSummary,
    planeStatus: puzzlePlaneStatus,
    sphereStatus: puzzleSphereStatus,
});

// Divine Hexagon coordinate persistence
const HEXAGON_STORAGE_KEY = 'divine-hexagon-coords';
const hexagonInputs = document.querySelectorAll<HTMLElement>('.coord-input');
const hexagonStatus = document.getElementById('hexagonStatus');

const loadHexagonCoords = (): string[] => {
    try {
        const raw = localStorage.getItem(HEXAGON_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        /* ignore */
    }
    return Array.from({ length: 6 }, () => '');
};

const saveHexagonCoords = () => {
    const coords: string[] = [];
    hexagonInputs.forEach(group => {
        const input = group.querySelector<HTMLInputElement>('.coord-input__field');
        coords.push(input?.value ?? '');
    });
    localStorage.setItem(HEXAGON_STORAGE_KEY, JSON.stringify(coords));
    if (hexagonStatus) hexagonStatus.textContent = 'Saved.';
    setTimeout(() => {
        if (hexagonStatus) hexagonStatus.textContent = '';
    }, 1500);
};

// Restore saved values
const savedCoords = loadHexagonCoords();
hexagonInputs.forEach((group, idx) => {
    const value = savedCoords[idx];
    if (!value) return;
    const input = group.querySelector<HTMLInputElement>('.coord-input__field');
    if (input) input.value = value;
});

// Parse a "x, y, z" string into a Vec3 or null
const parseVec3 = (s: string): Vec3 | null => {
    const parts = s.split(',').map(p => parseFloat(p.trim()));
    if (parts.length >= 3 && parts.every(n => Number.isFinite(n))) {
        return [parts[0], parts[1], parts[2]];
    }
    return null;
};

const getHexagonVertices = (): (Vec3 | null)[] => {
    const coords = loadHexagonCoords();
    return coords.map(parseVec3);
};

// Hexagon WebGPU visualization
let hexagonController: HexagonController | null = null;
const hexagonCanvas = document.getElementById('hexagonCanvas');

if (hexagonCanvas instanceof HTMLCanvasElement) {
    initHexagonVisualization(hexagonCanvas)
        .then(ctrl => {
            hexagonController = ctrl;
            ctrl.updateVertices(getHexagonVertices());
        })
        .catch(err => {
            console.error('Hexagon visualization error:', err);
        });
}

// Save on any input change & update hex visualization
hexagonInputs.forEach(group => {
    const input = group.querySelector<HTMLInputElement>('.coord-input__field');
    input?.addEventListener('input', () => {
        saveHexagonCoords();
        hexagonController?.updateVertices(getHexagonVertices());
    });
});
