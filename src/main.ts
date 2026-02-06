import { lightAnglePaths, lightPathGroups } from './data';
import { initWebGPUVisualization } from './webgpu/visualization-sphere';
import { initWebGPUVisualizationPlane } from './webgpu/visualization-plane';
import { initWebGPUVisualizationRing } from './webgpu/visualization-ring';
import { initWebGPUVisualizationCylinder } from './webgpu/visualization-cylinder';
import { printPathData, getPathDataGroups, getPathDataGroupsFormatted } from './utils';

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

// Status elements
const sphereStatus = document.getElementById('sphereStatus');
const planeStatus = document.getElementById('planeStatus');
const ringStatus = document.getElementById('ringStatus');
const cylinderStatus = document.getElementById('cylinderStatus');

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

if (!(cylinderCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #cylinderCanvas not found.');
}

if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error('Toggle button #toggleButton not found.');
}

let sphereController: VisualizationController | null = null;
let planeController: VisualizationController | null = null;
let ringController: VisualizationController | null = null;
let cylinderController: VisualizationController | null = null;
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

const updateCurrentGroup = (groupIndex: number) => {
    currentGroupIndex = groupIndex;
    const group = lightPathGroups[groupIndex];
    if (currentPathEl && group) {
        const titlesList = Object.values(group.titles);
        currentPathEl.textContent = titlesList.length > 0 ? titlesList[0] : `Group ${groupIndex}`;
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

const reinitializeWithOverlays = async () => {
    // Stop all visualizations
    sphereController?.stop();
    planeController?.stop();
    ringController?.stop();
    cylinderController?.stop();
    sphereController = null;
    planeController = null;
    ringController = null;
    cylinderController = null;

    // Create combined path data with main group and overlays
    const mainGroup = lightPathGroups[currentGroupIndex];
    const tempPathKey = `__temp_combined__`;

    // Build combined path data
    const combinedPathData: {
        title: string;
        [id: string]: any;
    } = {
        // Main group uses segment ID 0
        '0': mainGroup.values,
        title: Object.values(mainGroup.titles)[0] || `Group ${currentGroupIndex}`,
    };

    // Add overlay groups with different segment IDs
    let segmentId = 1;
    overlayGroups.forEach((_color, groupIndex) => {
        const overlayGroup = lightPathGroups[groupIndex];
        if (overlayGroup) {
            combinedPathData[String(segmentId)] = overlayGroup.values;
            segmentId++;
        }
    });

    window.lightAnglePaths[tempPathKey] = combinedPathData;

    try {
        setStatus('Updating visualizations...');
        toggleButton.disabled = true;

        sphereController = await initWebGPUVisualization(sphereCanvas, sphereStatus, tempPathKey);
        planeController = await initWebGPUVisualizationPlane(planeCanvas, planeStatus, tempPathKey);
        ringController = await initWebGPUVisualizationRing(ringCanvas, ringStatus, tempPathKey);
        cylinderController = await initWebGPUVisualizationCylinder(cylinderCanvas, cylinderStatus, tempPathKey);

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

    // Stop all visualizations
    sphereController?.stop();
    planeController?.stop();
    ringController?.stop();
    cylinderController?.stop();
    sphereController = null;
    planeController = null;
    ringController = null;
    cylinderController = null;

    // Get group data and create a temporary path
    const group = lightPathGroups[groupIndex];
    const tempPathKey = `__temp_group_${groupIndex}__`;

    // Add the group's raw values to lightAnglePaths temporarily
    window.lightAnglePaths[tempPathKey] = {
        '0': group.values,
        title: Object.values(group.titles)[0] || `Group ${groupIndex}`,
    };

    // Reinitialize with new group for all views
    try {
        setStatus(`Loading Group ${groupIndex}...`);
        toggleButton.disabled = true;

        // Initialize sphere view
        sphereController = await initWebGPUVisualization(sphereCanvas, sphereStatus, tempPathKey);

        // Initialize plane view
        planeController = await initWebGPUVisualizationPlane(planeCanvas, planeStatus, tempPathKey);

        // Initialize ring view (torus)
        ringController = await initWebGPUVisualizationRing(ringCanvas, ringStatus, tempPathKey);

        // Initialize cylinder view
        cylinderController = await initWebGPUVisualizationCylinder(cylinderCanvas, cylinderStatus, tempPathKey);

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
    updateSelectedData(currentGroupIndex); // Initialize with default group

    if (!navigator.gpu) {
        setStatus('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
        toggleButton.textContent = 'Unsupported';
        toggleButton.disabled = true;
        return;
    }

    try {
        setStatus('Initializing WebGPU...');

        // Get first group and create temporary path
        const group = lightPathGroups[currentGroupIndex];
        const tempPathKey = `__temp_group_${currentGroupIndex}__`;

        (window as any).lightAnglePaths[tempPathKey] = {
            '0': group.values,
            title: Object.values(group.titles)[0] || `Group ${currentGroupIndex}`,
        };

        // Initialize all visualizations
        sphereController = await initWebGPUVisualization(sphereCanvas, sphereStatus, tempPathKey);
        planeController = await initWebGPUVisualizationPlane(planeCanvas, planeStatus, tempPathKey);
        ringController = await initWebGPUVisualizationRing(ringCanvas, ringStatus, tempPathKey);
        cylinderController = await initWebGPUVisualizationCylinder(cylinderCanvas, cylinderStatus, tempPathKey);

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
    sphereController?.stop();
    planeController?.stop();
    ringController?.stop();
    cylinderController?.stop();
});
