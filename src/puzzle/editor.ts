import { shapes } from './shapes';
import { closestFraction } from '../utils';

interface Point2 {
    x: number;
    y: number;
}

interface Point3 {
    x: number;
    y: number;
    z: number;
}

interface RenderedPoint3 extends Point2 {
    depth: number;
}

interface PuzzleFigure {
    id: string;
    name: string;
    color: string;
    visible: boolean;
    showLengths: boolean;
    valueCount: number;
    center: Point3;
    rotation: number;
    scale: number;
    handleDistance: number;
    baseVertices: Point2[];
}

interface FigureGeometry {
    centerPlane: Point2;
    handlePlane: Point2;
    sphereVertices: Point3[];
    planeVertices: Point2[];
    sphereBoundary: Point3[];
    planeBoundary: Point2[];
    edgeLabels: FigureEdgeLabel[];
}

interface FigureEdgeLabel {
    text: string;
    planePoint: Point2;
    spherePoint: Point3;
}

interface PuzzleEditorElements {
    planeCanvas: HTMLCanvasElement;
    sphereCanvas: HTMLCanvasElement;
    figureList: HTMLElement;
    sidebarStatus?: HTMLElement | null;
    selectionSummary?: HTMLElement | null;
    planeStatus?: HTMLElement | null;
    sphereStatus?: HTMLElement | null;
}

interface CanvasMetrics {
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    radiusPx: number;
    pixelsPerUnit: number;
}

type PlaneInteraction =
    | {
          mode: 'move';
          pointerId: number;
          figureId: string;
          offset: Point2;
      }
    | {
          mode: 'rotate';
          pointerId: number;
          figureId: string;
      };

interface SphereInteraction {
    pointerId: number;
    lastX: number;
    lastY: number;
}

export interface PuzzleEditorController {
    refresh(): void;
    destroy(): void;
}

const VIEW_RADIUS = 1.6;
const MOVE_LIMIT = VIEW_RADIUS;
const ROTATION_HANDLE_RADIUS_PX = 14;
const GRID_RADII = [0.4, 0.8, 1.2, 1.6];
const SPHERE_RADIUS_SCALE = 0.95;
const BOUNDARY_SEGMENT_SAMPLES = 20;
const PUZZLE_FIGURE_COLORS = ['#6cf1ff', '#eeff71', '#ff9f68', '#9d7cff', '#6effa7', '#ff6f91', '#7bd0ff', '#ffcf5a'];

export function initPuzzleEditor({
    planeCanvas,
    sphereCanvas,
    figureList,
    sidebarStatus,
    selectionSummary,
    planeStatus,
    sphereStatus,
}: PuzzleEditorElements): PuzzleEditorController {
    const planeContext = planeCanvas.getContext('2d');
    const sphereContext = sphereCanvas.getContext('2d');

    if (!planeContext || !sphereContext) {
        throw new Error('Puzzle editor requires 2D canvas support.');
    }

    let selectedFigureId = '';
    let planeInteraction: PlaneInteraction | null = null;
    let sphereInteraction: SphereInteraction | null = null;
    let sphereYaw = -0.8;
    let spherePitch = 0.6;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFallbackAttached = false;

    planeCanvas.style.touchAction = 'none';
    sphereCanvas.style.touchAction = 'none';

    const getSelectedFigure = (): PuzzleFigure | undefined => figures.find(figure => figure.id === selectedFigureId);

    const syncCanvasResolution = (canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round((rect.width || canvas.clientWidth || 640) * dpr));
        const height = Math.max(1, Math.round((rect.height || canvas.clientHeight || 480) * dpr));

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
    };

    const getMetrics = (canvas: HTMLCanvasElement): CanvasMetrics => {
        const width = canvas.width;
        const height = canvas.height;
        const radiusPx = Math.min(width, height) * 0.38;

        return {
            width,
            height,
            centerX: width / 2,
            centerY: height / 2,
            radiusPx,
            pixelsPerUnit: radiusPx / VIEW_RADIUS,
        };
    };

    const toCanvasPoint = (point: Point2, metrics: CanvasMetrics): Point2 => ({
        x: metrics.centerX + point.x * metrics.pixelsPerUnit,
        y: metrics.centerY + point.y * metrics.pixelsPerUnit,
    });

    const toWorldPoint = (point: Point2, metrics: CanvasMetrics): Point2 => ({
        x: (point.x - metrics.centerX) / metrics.pixelsPerUnit,
        y: (point.y - metrics.centerY) / metrics.pixelsPerUnit,
    });

    const getPointerCanvasPoint = (event: PointerEvent, canvas: HTMLCanvasElement): Point2 => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / Math.max(rect.width, 1);
        const scaleY = canvas.height / Math.max(rect.height, 1);

        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    };

    const subtractPoint2 = (a: Point2, b: Point2): Point2 => ({
        x: a.x - b.x,
        y: a.y - b.y,
    });

    const scalePoint2 = (point: Point2, scale: number): Point2 => ({
        x: point.x * scale,
        y: point.y * scale,
    });

    const rotatePoint2 = (point: Point2, angle: number): Point2 => {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return {
            x: point.x * cos - point.y * sin,
            y: point.x * sin + point.y * cos,
        };
    };

    const addPoint3 = (a: Point3, b: Point3): Point3 => ({
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z,
    });

    const scalePoint3 = (point: Point3, scale: number): Point3 => ({
        x: point.x * scale,
        y: point.y * scale,
        z: point.z * scale,
    });

    const dotPoint3 = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;

    const crossPoint3 = (a: Point3, b: Point3): Point3 => ({
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    });

    const normalizePoint3 = (point: Point3): Point3 => {
        const length = Math.hypot(point.x, point.y, point.z) || 1;
        return {
            x: point.x / length,
            y: point.y / length,
            z: point.z / length,
        };
    };

    const clampToCircle = (point: Point2, maxRadius: number): Point2 => {
        const length = Math.hypot(point.x, point.y);
        if (length <= maxRadius || length === 0) {
            return point;
        }

        const scale = maxRadius / length;
        return {
            x: point.x * scale,
            y: point.y * scale,
        };
    };

    const hexToRgba = (hex: string, alpha: number): string => {
        const normalized = hex.replace('#', '');
        const safeHex = normalized.length === 3 ? normalized.replace(/(.)/g, '$1$1') : normalized;
        const value = Number.parseInt(safeHex, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const formatLineLength = (length: number): string => {
        const normalized = length / Math.PI;
        const fraction = closestFraction(normalized, 32);
        const approximation = fraction.numerator / fraction.denominator;

        if (Math.abs(approximation - normalized) > 0.0025) {
            return length.toFixed(2);
        }

        if (fraction.numerator === 0) {
            return '0';
        }

        const sign = fraction.numerator < 0 ? '-' : '';
        const numerator = Math.abs(fraction.numerator);

        if (fraction.denominator === 1) {
            return numerator === 1 ? `${sign}π` : `${sign}${numerator}π`;
        }

        return numerator === 1 ? `${sign}π/${fraction.denominator}` : `${sign}${numerator}π/${fraction.denominator}`;
    };

    const getSphereArcLength = (start: Point3, end: Point3): number =>
        Math.acos(Math.max(-1, Math.min(1, dotPoint3(normalizePoint3(start), normalizePoint3(end)))));

    const drawCanvasLabel = (
        context: CanvasRenderingContext2D,
        anchor: Point2,
        origin: Point2,
        text: string,
        color: string,
        metrics: CanvasMetrics,
        alpha = 1
    ) => {
        const directionX = anchor.x - origin.x;
        const directionY = anchor.y - origin.y;
        const directionLength = Math.hypot(directionX, directionY) || 1;
        const offset = Math.max(14, Math.min(24, metrics.radiusPx * 0.06));
        const labelX = anchor.x + (directionX / directionLength) * offset;
        const labelY = anchor.y + (directionY / directionLength) * offset;
        const fontSize = Math.max(12, Math.min(20, metrics.radiusPx * 0.05));

        context.save();
        context.font = `600 ${fontSize}px system-ui, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const textWidth = context.measureText(text).width;
        const paddingX = fontSize * 0.45;
        const paddingY = fontSize * 0.32;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        context.fillStyle = `rgba(3, 6, 12, ${0.86 * alpha})`;
        context.strokeStyle = hexToRgba(color, 0.45 * alpha);
        context.lineWidth = 1.25;
        context.fillRect(labelX - boxWidth / 2, labelY - boxHeight / 2, boxWidth, boxHeight);
        context.strokeRect(labelX - boxWidth / 2, labelY - boxHeight / 2, boxWidth, boxHeight);
        context.fillStyle = hexToRgba(color, alpha);
        context.fillText(text, labelX, labelY + fontSize * 0.04);
        context.restore();
    };

    const planeToSphere = (point: Point2): Point3 => {
        const clampedPoint = clampToCircle(point, MOVE_LIMIT);
        const radius = Math.hypot(clampedPoint.x, clampedPoint.y);
        const azimuth = Math.atan2(clampedPoint.y, clampedPoint.x);
        const polar = (radius / VIEW_RADIUS) * Math.PI;
        const sinPolar = Math.sin(polar);

        return {
            x: sinPolar * Math.cos(azimuth),
            y: Math.cos(polar),
            z: sinPolar * Math.sin(azimuth),
        };
    };

    const sphereToPlane = (point: Point3): Point2 => {
        const polar = Math.acos(Math.max(-1, Math.min(1, point.y)));
        const radius = (polar / Math.PI) * VIEW_RADIUS;
        const azimuth = Math.atan2(point.z, point.x);

        return {
            x: radius * Math.cos(azimuth),
            y: radius * Math.sin(azimuth),
        };
    };

    const getFigureBasis = (center: Point3) => {
        const reference =
            Math.abs(center.y) < 0.95 ? ({ x: 0, y: 1, z: 0 } as Point3) : ({ x: 0, y: 0, z: 1 } as Point3);
        const tangentX = normalizePoint3(crossPoint3(center, reference));
        const tangentY = normalizePoint3(crossPoint3(tangentX, center));

        return { tangentX, tangentY };
    };

    const transformLocalPoint = (figure: PuzzleFigure, point: Point2): Point2 =>
        rotatePoint2(scalePoint2(point, figure.scale), figure.rotation);

    const radAnglesToSphere = (angles: { x: number; y: number }): Point3 =>
        normalizePoint3({
            x: Math.cos(angles.x) * -Math.sin(angles.y),
            y: -Math.sin(angles.x),
            z: Math.cos(angles.x) * Math.cos(angles.y),
        });

    const pointsAlmostEqual = (a: Point3, b: Point3): boolean =>
        Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

    const collapseNeighboringDuplicateVertices = (points: Point3[]): Point3[] => {
        const collapsed: Point3[] = [];

        points.forEach(point => {
            if (collapsed.length === 0 || !pointsAlmostEqual(point, collapsed[collapsed.length - 1])) {
                collapsed.push(point);
            }
        });

        if (collapsed.length > 1 && pointsAlmostEqual(collapsed[0], collapsed[collapsed.length - 1])) {
            collapsed.pop();
        }

        return collapsed;
    };

    const slerpSpherePoints = (start: Point3, end: Point3, t: number): Point3 => {
        if (pointsAlmostEqual(start, end)) {
            return start;
        }

        const startNormalized = normalizePoint3(start);
        const endNormalized = normalizePoint3(end);
        const dot = Math.max(-1, Math.min(1, dotPoint3(startNormalized, endNormalized)));

        if (dot > 1 - 1e-6) {
            return startNormalized;
        }

        if (dot < -1 + 1e-6) {
            const reference =
                Math.abs(startNormalized.x) < 0.9 ? ({ x: 1, y: 0, z: 0 } as Point3) : ({ x: 0, y: 1, z: 0 } as Point3);
            const orthogonal = normalizePoint3(crossPoint3(startNormalized, reference));
            return normalizePoint3(
                addPoint3(
                    scalePoint3(startNormalized, Math.cos(Math.PI * t)),
                    scalePoint3(orthogonal, Math.sin(Math.PI * t))
                )
            );
        }

        const omega = Math.acos(dot);
        const sinOmega = Math.sin(omega);

        return normalizePoint3(
            addPoint3(
                scalePoint3(startNormalized, Math.sin((1 - t) * omega) / sinOmega),
                scalePoint3(endNormalized, Math.sin(t * omega) / sinOmega)
            )
        );
    };

    const projectSpherePointToLocal = (
        point: Point3,
        center: Point3,
        basis: { tangentX: Point3; tangentY: Point3 }
    ): Point2 => {
        const normalizedPoint = normalizePoint3(point);
        const normalizedCenter = normalizePoint3(center);
        const centerDot = Math.max(-1, Math.min(1, dotPoint3(normalizedPoint, normalizedCenter)));
        const angle = Math.acos(centerDot);

        if (angle < 1e-6) {
            return { x: 0, y: 0 };
        }

        const tangentVector = addPoint3(normalizedPoint, scalePoint3(normalizedCenter, -centerDot));
        const tangentLength = Math.hypot(tangentVector.x, tangentVector.y, tangentVector.z);
        const tangentDirection = tangentLength < 1e-6 ? basis.tangentX : scalePoint3(tangentVector, 1 / tangentLength);

        return {
            x: dotPoint3(tangentDirection, basis.tangentX) * angle,
            y: dotPoint3(tangentDirection, basis.tangentY) * angle,
        };
    };

    const buildPuzzleFigure = (name: string, group: { x: number; y: number }[], index: number): PuzzleFigure => {
        const spherePoints = group.map(radAnglesToSphere);
        const uniquePoints = collapseNeighboringDuplicateVertices(spherePoints);

        const center = normalizePoint3(
            uniquePoints.reduce(
                (sum, point) => ({
                    x: sum.x + point.x,
                    y: sum.y + point.y,
                    z: sum.z + point.z,
                }),
                { x: 0, y: 0, z: 0 }
            )
        );
        const basis = getFigureBasis(center);
        const baseVertices = uniquePoints.map(point => projectSpherePointToLocal(point, center, basis));
        const handleDistance = Math.max(...baseVertices.map(vertex => Math.hypot(vertex.x, vertex.y)), 0.25) + 0.28;

        return {
            id: `puzzle-shape-${index}`,
            name,
            color: PUZZLE_FIGURE_COLORS[index % PUZZLE_FIGURE_COLORS.length],
            visible: true,
            showLengths: false,
            valueCount: group.length,
            center,
            rotation: 0,
            scale: 1,
            handleDistance,
            baseVertices,
        };
    };

    const figures: PuzzleFigure[] = Object.entries(shapes).map(([name, group], index) =>
        buildPuzzleFigure(name, group, index)
    );

    selectedFigureId = figures[0]?.id ?? '';

    const getVisibleFigures = (): PuzzleFigure[] => figures.filter(figure => figure.visible);
    const areAllFiguresVisible = (): boolean => figures.every(figure => figure.visible);
    const hasSomeVisibleFigures = (): boolean => figures.some(figure => figure.visible);
    const areAllFigureLengthsVisible = (): boolean => figures.every(figure => figure.showLengths);
    const hasSomeFigureLengthsVisible = (): boolean => figures.some(figure => figure.showLengths);

    const setAllFiguresVisible = (visible: boolean) => {
        figures.forEach(figure => {
            figure.visible = visible;
        });

        if (!visible) {
            planeInteraction = null;
        }
    };

    const setAllFigureLengthsVisible = (showLengths: boolean) => {
        figures.forEach(figure => {
            figure.showLengths = showLengths;
        });
    };

    const localPointToSphere = (center: Point3, localPoint: Point2): Point3 => {
        const basis = getFigureBasis(center);
        const angle = Math.hypot(localPoint.x, localPoint.y);

        if (angle < 1e-6) {
            return normalizePoint3(center);
        }

        const tangentDirection = normalizePoint3(
            addPoint3(scalePoint3(basis.tangentX, localPoint.x), scalePoint3(basis.tangentY, localPoint.y))
        );

        return normalizePoint3(
            addPoint3(scalePoint3(center, Math.cos(angle)), scalePoint3(tangentDirection, Math.sin(angle)))
        );
    };

    const getFigureGeometry = (figure: PuzzleFigure): FigureGeometry => {
        const transformedVertices = figure.baseVertices.map(vertex => transformLocalPoint(figure, vertex));
        const sphereVertices = collapseNeighboringDuplicateVertices(
            transformedVertices.map(vertex => localPointToSphere(figure.center, vertex))
        );
        const planeVertices = sphereVertices.map(sphereToPlane);
        const handleLocal = transformLocalPoint(figure, { x: 0, y: -figure.handleDistance });
        const handlePlane = sphereToPlane(localPointToSphere(figure.center, handleLocal));
        const sphereBoundary: Point3[] = [];
        const edgeLabels: FigureEdgeLabel[] = [];

        for (let index = 0; index < sphereVertices.length; index++) {
            const start = sphereVertices[index];
            const end = sphereVertices[(index + 1) % sphereVertices.length];

            if (pointsAlmostEqual(start, end)) {
                continue;
            }

            for (let step = 0; step < BOUNDARY_SEGMENT_SAMPLES; step++) {
                sphereBoundary.push(slerpSpherePoints(start, end, step / BOUNDARY_SEGMENT_SAMPLES));
            }

            const midpoint = slerpSpherePoints(start, end, 0.5);
            edgeLabels.push({
                text: formatLineLength(getSphereArcLength(start, end)),
                planePoint: sphereToPlane(midpoint),
                spherePoint: midpoint,
            });
        }

        const planeBoundary = sphereBoundary.map(sphereToPlane);

        return {
            centerPlane: sphereToPlane(figure.center),
            handlePlane,
            sphereVertices,
            planeVertices,
            sphereBoundary,
            planeBoundary,
            edgeLabels,
        };
    };

    const getFigureGeometries = (): Map<string, FigureGeometry> =>
        new Map(figures.map(figure => [figure.id, getFigureGeometry(figure)]));

    const pointInPolygon = (point: Point2, polygon: Point2[]): boolean => {
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;

            const intersects =
                yi > point.y !== yj > point.y &&
                point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;

            if (intersects) {
                inside = !inside;
            }
        }

        return inside;
    };

    const getFigureAtPlanePoint = (
        worldPoint: Point2,
        geometries: Map<string, FigureGeometry>
    ): PuzzleFigure | undefined => {
        for (let index = figures.length - 1; index >= 0; index--) {
            const figure = figures[index];
            if (!figure.visible) {
                continue;
            }
            const geometry = geometries.get(figure.id);
            if (geometry && pointInPolygon(worldPoint, geometry.planeBoundary)) {
                return figure;
            }
        }

        return undefined;
    };

    const isRotationHandleHit = (
        geometry: FigureGeometry | undefined,
        canvasPoint: Point2,
        metrics: CanvasMetrics
    ): boolean => {
        if (!geometry) {
            return false;
        }

        const handlePoint = toCanvasPoint(geometry.handlePlane, metrics);
        return (
            Math.hypot(canvasPoint.x - handlePoint.x, canvasPoint.y - handlePoint.y) <= ROTATION_HANDLE_RADIUS_PX * 1.5
        );
    };

    const rotationFromPointer = (center: Point2, point: Point2): number =>
        Math.atan2(point.y - center.y, point.x - center.x) + Math.PI / 2;

    const rotateSpherePointForCamera = (point: Point3): Point3 => {
        const cosYaw = Math.cos(sphereYaw);
        const sinYaw = Math.sin(sphereYaw);
        const cosPitch = Math.cos(spherePitch);
        const sinPitch = Math.sin(spherePitch);

        const yawX = point.x * cosYaw + point.z * sinYaw;
        const yawZ = -point.x * sinYaw + point.z * cosYaw;
        const pitchY = point.y * cosPitch - yawZ * sinPitch;
        const pitchZ = point.y * sinPitch + yawZ * cosPitch;

        return {
            x: yawX,
            y: pitchY,
            z: pitchZ,
        };
    };

    const projectSpherePoint = (point: Point3, metrics: CanvasMetrics): RenderedPoint3 => {
        const rotated = rotateSpherePointForCamera(point);
        return {
            x: metrics.centerX + rotated.x * metrics.radiusPx * SPHERE_RADIUS_SCALE,
            y: metrics.centerY - rotated.y * metrics.radiusPx * SPHERE_RADIUS_SCALE,
            depth: rotated.z,
        };
    };

    const drawPlaneGrid = (context: CanvasRenderingContext2D, metrics: CanvasMetrics) => {
        context.save();
        context.beginPath();
        context.arc(metrics.centerX, metrics.centerY, metrics.radiusPx, 0, Math.PI * 2);
        context.clip();

        const gradient = context.createRadialGradient(
            metrics.centerX,
            metrics.centerY,
            metrics.radiusPx * 0.15,
            metrics.centerX,
            metrics.centerY,
            metrics.radiusPx
        );
        gradient.addColorStop(0, 'rgba(18, 31, 48, 0.98)');
        gradient.addColorStop(1, 'rgba(5, 10, 16, 0.98)');

        context.fillStyle = gradient;
        context.fillRect(0, 0, metrics.width, metrics.height);

        context.strokeStyle = 'rgba(108, 241, 255, 0.16)';
        context.lineWidth = 1;

        GRID_RADII.forEach(radius => {
            context.beginPath();
            context.arc(metrics.centerX, metrics.centerY, radius * metrics.pixelsPerUnit, 0, Math.PI * 2);
            context.stroke();
        });

        for (let index = 0; index < 8; index++) {
            const angle = (index / 8) * Math.PI * 2;
            context.beginPath();
            context.moveTo(metrics.centerX, metrics.centerY);
            context.lineTo(
                metrics.centerX + Math.cos(angle) * metrics.radiusPx,
                metrics.centerY + Math.sin(angle) * metrics.radiusPx
            );
            context.stroke();
        }

        context.restore();

        context.beginPath();
        context.arc(metrics.centerX, metrics.centerY, metrics.radiusPx, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(108, 241, 255, 0.5)';
        context.lineWidth = 2;
        context.stroke();
    };

    const drawFigureOnPlane = (
        context: CanvasRenderingContext2D,
        figure: PuzzleFigure,
        geometry: FigureGeometry,
        metrics: CanvasMetrics
    ) => {
        const canvasVertices = geometry.planeVertices.map(vertex => toCanvasPoint(vertex, metrics));
        const canvasBoundary = geometry.planeBoundary.map(point => toCanvasPoint(point, metrics));
        const selected = figure.id === selectedFigureId;

        context.beginPath();
        canvasBoundary.forEach((point, index) => {
            if (index === 0) {
                context.moveTo(point.x, point.y);
            } else {
                context.lineTo(point.x, point.y);
            }
        });
        context.closePath();
        context.fillStyle = hexToRgba(figure.color, 0.24);
        context.strokeStyle = hexToRgba(figure.color, selected ? 1 : 0.88);
        context.lineWidth = selected ? 4 : 2;
        context.lineJoin = 'round';
        context.fill();
        context.stroke();

        canvasVertices.forEach(vertex => {
            context.beginPath();
            context.arc(vertex.x, vertex.y, selected ? 5 : 4, 0, Math.PI * 2);
            context.fillStyle = hexToRgba(figure.color, 0.95);
            context.fill();
        });

        if (figure.showLengths) {
            const center = toCanvasPoint(geometry.centerPlane, metrics);
            geometry.edgeLabels.forEach(label => {
                drawCanvasLabel(
                    context,
                    toCanvasPoint(label.planePoint, metrics),
                    center,
                    label.text,
                    figure.color,
                    metrics
                );
            });
        }

        if (!selected) {
            return;
        }

        const center = toCanvasPoint(geometry.centerPlane, metrics);
        context.beginPath();
        context.arc(center.x, center.y, 5, 0, Math.PI * 2);
        context.fillStyle = 'rgba(255, 255, 255, 0.92)';
        context.fill();

        const handlePoint = toCanvasPoint(geometry.handlePlane, metrics);

        context.beginPath();
        context.moveTo(center.x, center.y);
        context.lineTo(handlePoint.x, handlePoint.y);
        context.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        context.lineWidth = 2;
        context.stroke();

        context.beginPath();
        context.arc(handlePoint.x, handlePoint.y, ROTATION_HANDLE_RADIUS_PX, 0, Math.PI * 2);
        context.fillStyle = 'rgba(3, 6, 12, 0.92)';
        context.fill();
        context.strokeStyle = hexToRgba(figure.color, 0.95);
        context.lineWidth = 3;
        context.stroke();
    };

    const drawSphereGrid = (context: CanvasRenderingContext2D, metrics: CanvasMetrics) => {
        const gradient = context.createRadialGradient(
            metrics.centerX,
            metrics.centerY,
            metrics.radiusPx * 0.2,
            metrics.centerX,
            metrics.centerY,
            metrics.radiusPx * 1.1
        );
        gradient.addColorStop(0, 'rgba(25, 38, 66, 0.95)');
        gradient.addColorStop(1, 'rgba(7, 11, 19, 0.98)');

        context.beginPath();
        context.arc(metrics.centerX, metrics.centerY, metrics.radiusPx, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();

        const strokeSampleCurve = (samples: Point3[]) => {
            for (let index = 0; index < samples.length - 1; index++) {
                const start = projectSpherePoint(samples[index], metrics);
                const end = projectSpherePoint(samples[index + 1], metrics);
                const front = (start.depth + end.depth) / 2 >= 0;

                context.beginPath();
                context.moveTo(start.x, start.y);
                context.lineTo(end.x, end.y);
                context.strokeStyle = front ? 'rgba(108, 241, 255, 0.22)' : 'rgba(108, 241, 255, 0.08)';
                context.lineWidth = front ? 1.3 : 1;
                context.stroke();
            }
        };

        const latitudeAngles = [-60, -30, 0, 30, 60].map(angle => (angle * Math.PI) / 180);
        latitudeAngles.forEach(latitude => {
            const samples: Point3[] = [];
            for (let step = 0; step <= 72; step++) {
                const longitude = (step / 72) * Math.PI * 2;
                samples.push({
                    x: Math.cos(latitude) * Math.cos(longitude),
                    y: Math.sin(latitude),
                    z: Math.cos(latitude) * Math.sin(longitude),
                });
            }
            strokeSampleCurve(samples);
        });

        for (let meridian = 0; meridian < 8; meridian++) {
            const longitude = (meridian / 8) * Math.PI * 2;
            const samples: Point3[] = [];
            for (let step = 0; step <= 72; step++) {
                const latitude = -Math.PI / 2 + (step / 72) * Math.PI;
                samples.push({
                    x: Math.cos(latitude) * Math.cos(longitude),
                    y: Math.sin(latitude),
                    z: Math.cos(latitude) * Math.sin(longitude),
                });
            }
            strokeSampleCurve(samples);
        }

        context.beginPath();
        context.arc(metrics.centerX, metrics.centerY, metrics.radiusPx, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(108, 241, 255, 0.45)';
        context.lineWidth = 2;
        context.stroke();
    };

    const drawFigureOnSphere = (
        context: CanvasRenderingContext2D,
        figure: PuzzleFigure,
        geometry: FigureGeometry,
        metrics: CanvasMetrics
    ) => {
        const boundary = geometry.sphereBoundary.map(point => projectSpherePoint(point, metrics));
        const vertices = geometry.sphereVertices.map(point => projectSpherePoint(point, metrics));
        const center = projectSpherePoint(figure.center, metrics);
        const selected = figure.id === selectedFigureId;
        const averageDepth = boundary.reduce((total, point) => total + point.depth, 0) / Math.max(boundary.length, 1);
        const onFront = averageDepth >= 0;

        context.beginPath();
        boundary.forEach((point, index) => {
            if (index === 0) {
                context.moveTo(point.x, point.y);
            } else {
                context.lineTo(point.x, point.y);
            }
        });
        context.closePath();
        context.fillStyle = hexToRgba(figure.color, onFront ? 0.2 : 0.08);
        context.strokeStyle = hexToRgba(figure.color, selected ? (onFront ? 1 : 0.65) : onFront ? 0.88 : 0.35);
        context.lineWidth = selected ? 3.5 : 2;
        context.lineJoin = 'round';
        context.fill();
        context.stroke();

        vertices.forEach(vertex => {
            context.beginPath();
            context.arc(vertex.x, vertex.y, selected ? 4.5 : 3.5, 0, Math.PI * 2);
            context.fillStyle = hexToRgba(figure.color, onFront ? 0.95 : 0.45);
            context.fill();
        });

        if (figure.showLengths) {
            geometry.edgeLabels.forEach(label => {
                const anchor = projectSpherePoint(label.spherePoint, metrics);
                drawCanvasLabel(
                    context,
                    anchor,
                    center,
                    label.text,
                    figure.color,
                    metrics,
                    anchor.depth >= 0 ? 0.92 : 0.46
                );
            });
        }

        if (!selected) {
            return;
        }

        context.beginPath();
        context.arc(center.x, center.y, 4.5, 0, Math.PI * 2);
        context.fillStyle = onFront ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.35)';
        context.fill();
    };

    const renderFigureList = () => {
        figureList.innerHTML = '';

        const bulkItem = document.createElement('li');
        bulkItem.className = 'puzzle-figure-item puzzle-figure-item--bulk';

        const bulkShowToggle = document.createElement('label');
        bulkShowToggle.className = 'puzzle-figure-toggle';
        bulkShowToggle.title = 'Show all figures';

        const bulkShowCheckbox = document.createElement('input');
        bulkShowCheckbox.type = 'checkbox';
        bulkShowCheckbox.className = 'puzzle-figure-checkbox';
        bulkShowCheckbox.checked = areAllFiguresVisible();
        bulkShowCheckbox.indeterminate = hasSomeVisibleFigures() && !bulkShowCheckbox.checked;
        bulkShowCheckbox.setAttribute('aria-label', 'Show all figures');

        const bulkShowLabel = document.createElement('span');
        bulkShowLabel.className = 'puzzle-figure-toggle-label';
        bulkShowLabel.textContent = 'Show';

        bulkShowToggle.appendChild(bulkShowCheckbox);
        bulkShowToggle.appendChild(bulkShowLabel);

        const bulkContent = document.createElement('div');
        bulkContent.className = 'puzzle-figure-content';

        const bulkName = document.createElement('span');
        bulkName.className = 'puzzle-figure-name';
        bulkName.textContent = 'All figures';

        const bulkMeta = document.createElement('span');
        bulkMeta.className = 'puzzle-figure-meta';
        bulkMeta.textContent = `${figures.length} figures`;

        bulkContent.appendChild(bulkName);
        bulkContent.appendChild(bulkMeta);

        const bulkLengthsToggle = document.createElement('label');
        bulkLengthsToggle.className = 'puzzle-figure-toggle puzzle-figure-toggle--end';
        bulkLengthsToggle.title = 'Show line lengths for all figures';

        const bulkLengthsCheckbox = document.createElement('input');
        bulkLengthsCheckbox.type = 'checkbox';
        bulkLengthsCheckbox.className = 'puzzle-figure-checkbox';
        bulkLengthsCheckbox.checked = areAllFigureLengthsVisible();
        bulkLengthsCheckbox.indeterminate = hasSomeFigureLengthsVisible() && !bulkLengthsCheckbox.checked;
        bulkLengthsCheckbox.setAttribute('aria-label', 'Show line lengths for all figures');

        const bulkLengthsLabel = document.createElement('span');
        bulkLengthsLabel.className = 'puzzle-figure-toggle-label';
        bulkLengthsLabel.textContent = 'Len';

        bulkLengthsToggle.appendChild(bulkLengthsCheckbox);
        bulkLengthsToggle.appendChild(bulkLengthsLabel);

        bulkItem.appendChild(bulkShowToggle);
        bulkItem.appendChild(bulkContent);
        bulkItem.appendChild(bulkLengthsToggle);

        bulkItem.addEventListener('click', event => {
            event.stopPropagation();
        });

        bulkShowToggle.addEventListener('click', event => {
            event.stopPropagation();
        });

        bulkLengthsToggle.addEventListener('click', event => {
            event.stopPropagation();
        });

        bulkShowCheckbox.addEventListener('change', () => {
            setAllFiguresVisible(bulkShowCheckbox.checked);
            render();
        });

        bulkLengthsCheckbox.addEventListener('change', () => {
            setAllFigureLengthsVisible(bulkLengthsCheckbox.checked);
            render();
        });

        figureList.appendChild(bulkItem);

        figures.forEach(figure => {
            const item = document.createElement('li');
            item.className = 'puzzle-figure-item';
            item.classList.toggle('active', figure.id === selectedFigureId);
            item.classList.toggle('hidden', !figure.visible);

            const visibilityToggle = document.createElement('label');
            visibilityToggle.className = 'puzzle-figure-toggle';
            visibilityToggle.title = `Show ${figure.name}`;

            const visibilityCheckbox = document.createElement('input');
            visibilityCheckbox.type = 'checkbox';
            visibilityCheckbox.className = 'puzzle-figure-checkbox';
            visibilityCheckbox.checked = figure.visible;
            visibilityCheckbox.setAttribute('aria-label', `Show ${figure.name}`);

            const visibilityLabel = document.createElement('span');
            visibilityLabel.className = 'puzzle-figure-toggle-label';
            visibilityLabel.textContent = 'Show';

            visibilityToggle.appendChild(visibilityCheckbox);
            visibilityToggle.appendChild(visibilityLabel);

            const lengthsToggle = document.createElement('label');
            lengthsToggle.className = 'puzzle-figure-toggle puzzle-figure-toggle--end';
            lengthsToggle.title = `Show line lengths for ${figure.name}`;

            const lengthsCheckbox = document.createElement('input');
            lengthsCheckbox.type = 'checkbox';
            lengthsCheckbox.className = 'puzzle-figure-checkbox';
            lengthsCheckbox.checked = figure.showLengths;
            lengthsCheckbox.setAttribute('aria-label', `Show line lengths for ${figure.name}`);

            const lengthsLabel = document.createElement('span');
            lengthsLabel.className = 'puzzle-figure-toggle-label';
            lengthsLabel.textContent = 'Len';

            lengthsToggle.appendChild(lengthsCheckbox);
            lengthsToggle.appendChild(lengthsLabel);

            const swatch = document.createElement('span');
            swatch.className = 'puzzle-figure-swatch';
            swatch.style.background = figure.color;
            swatch.style.color = figure.color;

            const content = document.createElement('div');
            content.className = 'puzzle-figure-content';

            const name = document.createElement('span');
            name.className = 'puzzle-figure-name';
            name.textContent = figure.name;

            const meta = document.createElement('span');
            meta.className = 'puzzle-figure-meta';
            meta.textContent = `${figure.valueCount} values • ${figure.visible ? 'Visible' : 'Hidden'}`;

            content.appendChild(name);
            content.appendChild(meta);

            item.appendChild(visibilityToggle);
            item.appendChild(swatch);
            item.appendChild(content);
            item.appendChild(lengthsToggle);

            item.addEventListener('click', () => {
                selectedFigureId = selectedFigureId === figure.id ? '' : figure.id;
                render();
            });

            visibilityToggle.addEventListener('click', event => {
                event.stopPropagation();
            });

            lengthsToggle.addEventListener('click', event => {
                event.stopPropagation();
            });

            visibilityCheckbox.addEventListener('change', () => {
                figure.visible = visibilityCheckbox.checked;
                if (!figure.visible && planeInteraction?.figureId === figure.id) {
                    planeInteraction = null;
                }
                render();
            });

            lengthsCheckbox.addEventListener('change', () => {
                figure.showLengths = lengthsCheckbox.checked;
                render();
            });

            figureList.appendChild(item);
        });
    };

    const updateSelectionSummary = (
        selectedFigure: PuzzleFigure | undefined,
        selectedGeometry: FigureGeometry | undefined
    ) => {
        if (!selectionSummary) {
            return;
        }

        if (!selectedFigure || !selectedGeometry || selectedGeometry.edgeLabels.length === 0) {
            selectionSummary.hidden = true;
            selectionSummary.replaceChildren();
            return;
        }

        const title = document.createElement('div');
        title.className = 'puzzle-selection-summary__title';
        title.textContent = `${selectedFigure.name} lengths`;

        const list = document.createElement('div');
        list.className = 'puzzle-selection-summary__list';

        selectedGeometry.edgeLabels.forEach((label, index) => {
            const item = document.createElement('div');
            item.className = 'puzzle-selection-summary__item';
            item.textContent = `${index + 1}. ${label.text}`;
            list.appendChild(item);
        });

        selectionSummary.hidden = false;
        selectionSummary.replaceChildren(title, list);
    };

    const updateStatuses = (geometries: Map<string, FigureGeometry>) => {
        const selectedFigure = getSelectedFigure();
        const selectedGeometry = selectedFigure ? geometries.get(selectedFigure.id) : undefined;

        updateSelectionSummary(selectedFigure, selectedGeometry);

        if (sidebarStatus) {
            sidebarStatus.textContent = selectedFigure
                ? selectedFigure.visible
                    ? `${selectedFigure.name} is selected. Drag it in the plane to move it, drag its ring handle to rotate it, and use Len in the list to label each edge.`
                    : `${selectedFigure.name} is selected but hidden. Check it in the list to show it in the plane and sphere views.`
                : 'Select a figure from the list. Checked figures are shown in the plane and sphere views, and Len labels each edge.';
        }

        if (planeStatus) {
            if (!selectedFigure) {
                planeStatus.textContent = 'Select a checked figure from the list to move or rotate it.';
            } else if (planeInteraction?.mode === 'move' && planeInteraction.figureId === selectedFigure.id) {
                planeStatus.textContent = `Moving ${selectedFigure.name} in the plane projection...`;
            } else if (planeInteraction?.mode === 'rotate' && planeInteraction.figureId === selectedFigure.id) {
                planeStatus.textContent = `Rotating ${selectedFigure.name} in the plane projection...`;
            } else if (selectedFigure.visible) {
                planeStatus.textContent = `${selectedFigure.name}: selected in the list. Drag to move, handle to rotate.`;
            } else {
                planeStatus.textContent = `${selectedFigure.name}: hidden. Check it in the list to show it.`;
            }
        }

        if (sphereStatus) {
            sphereStatus.textContent = sphereInteraction
                ? 'Orbiting sphere view...'
                : 'Drag to rotate the sphere view.';
        }
    };

    const renderPlane = (geometries: Map<string, FigureGeometry>) => {
        syncCanvasResolution(planeCanvas);
        const metrics = getMetrics(planeCanvas);

        planeContext.clearRect(0, 0, metrics.width, metrics.height);
        drawPlaneGrid(planeContext, metrics);

        getVisibleFigures().forEach(figure => {
            const geometry = geometries.get(figure.id);
            if (geometry) {
                drawFigureOnPlane(planeContext, figure, geometry, metrics);
            }
        });
    };

    const renderSphere = (geometries: Map<string, FigureGeometry>) => {
        syncCanvasResolution(sphereCanvas);
        const metrics = getMetrics(sphereCanvas);

        sphereContext.clearRect(0, 0, metrics.width, metrics.height);
        drawSphereGrid(sphereContext, metrics);

        const sortedFigures = getVisibleFigures()
            .map(figure => ({
                figure,
                depth: projectSpherePoint(figure.center, metrics).depth,
            }))
            .sort((a, b) => a.depth - b.depth);

        sortedFigures.forEach(({ figure }) => {
            const geometry = geometries.get(figure.id);
            if (geometry) {
                drawFigureOnSphere(sphereContext, figure, geometry, metrics);
            }
        });
    };

    const render = () => {
        const geometries = getFigureGeometries();
        renderFigureList();
        renderPlane(geometries);
        renderSphere(geometries);
        updateStatuses(geometries);
    };

    const updatePlaneCursor = (event: PointerEvent) => {
        if (planeInteraction) {
            planeCanvas.style.cursor = planeInteraction.mode === 'move' ? 'grabbing' : 'crosshair';
            return;
        }

        const geometries = getFigureGeometries();
        const metrics = getMetrics(planeCanvas);
        const canvasPoint = getPointerCanvasPoint(event, planeCanvas);
        const worldPoint = toWorldPoint(canvasPoint, metrics);
        const selectedFigure = getSelectedFigure();
        const selectedGeometry = selectedFigure ? geometries.get(selectedFigure.id) : undefined;
        const hitFigure = getFigureAtPlanePoint(worldPoint, geometries);

        if (selectedFigure?.visible && isRotationHandleHit(selectedGeometry, canvasPoint, metrics)) {
            planeCanvas.style.cursor = 'crosshair';
            return;
        }

        if (selectedFigure?.visible && selectedGeometry && pointInPolygon(worldPoint, selectedGeometry.planeBoundary)) {
            planeCanvas.style.cursor = 'grab';
            return;
        }

        if (hitFigure) {
            planeCanvas.style.cursor = 'default';
            return;
        }

        planeCanvas.style.cursor = 'default';
    };

    const handlePlanePointerDown = (event: PointerEvent) => {
        const geometries = getFigureGeometries();
        const metrics = getMetrics(planeCanvas);
        const canvasPoint = getPointerCanvasPoint(event, planeCanvas);
        const worldPoint = toWorldPoint(canvasPoint, metrics);
        const selectedFigure = getSelectedFigure();
        const selectedGeometry = selectedFigure ? geometries.get(selectedFigure.id) : undefined;

        if (selectedFigure?.visible && isRotationHandleHit(selectedGeometry, canvasPoint, metrics)) {
            planeInteraction = {
                mode: 'rotate',
                pointerId: event.pointerId,
                figureId: selectedFigure.id,
            };
            planeCanvas.setPointerCapture(event.pointerId);
            render();
            return;
        }

        if (
            !selectedFigure?.visible ||
            !selectedGeometry ||
            !pointInPolygon(worldPoint, selectedGeometry.planeBoundary)
        ) {
            render();
            return;
        }

        planeInteraction = {
            mode: 'move',
            pointerId: event.pointerId,
            figureId: selectedFigure.id,
            offset: subtractPoint2(worldPoint, selectedGeometry.centerPlane),
        };
        planeCanvas.setPointerCapture(event.pointerId);

        render();
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
        if (planeInteraction && planeInteraction.pointerId === event.pointerId) {
            const activeInteraction = planeInteraction;
            const figure = figures.find(item => item.id === activeInteraction.figureId);
            if (!figure || !figure.visible) {
                planeInteraction = null;
                render();
                return;
            }

            const geometries = getFigureGeometries();
            const metrics = getMetrics(planeCanvas);
            const canvasPoint = getPointerCanvasPoint(event, planeCanvas);
            const worldPoint = toWorldPoint(canvasPoint, metrics);
            const geometry = geometries.get(figure.id);

            if (activeInteraction.mode === 'move') {
                figure.center = planeToSphere(
                    clampToCircle(subtractPoint2(worldPoint, activeInteraction.offset), MOVE_LIMIT)
                );
            } else if (geometry) {
                figure.rotation = rotationFromPointer(geometry.centerPlane, worldPoint);
            }

            render();
            return;
        }

        if (sphereInteraction && sphereInteraction.pointerId === event.pointerId) {
            const deltaX = event.clientX - sphereInteraction.lastX;
            const deltaY = event.clientY - sphereInteraction.lastY;
            sphereYaw += deltaX * 0.01;
            spherePitch = Math.max(0.05, Math.min(Math.PI - 0.05, spherePitch + deltaY * 0.01));
            sphereInteraction.lastX = event.clientX;
            sphereInteraction.lastY = event.clientY;
            render();
        }
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
        if (planeInteraction && planeInteraction.pointerId === event.pointerId) {
            planeInteraction = null;
            if (planeCanvas.hasPointerCapture(event.pointerId)) {
                planeCanvas.releasePointerCapture(event.pointerId);
            }
            planeCanvas.style.cursor = 'default';
            render();
        }

        if (sphereInteraction && sphereInteraction.pointerId === event.pointerId) {
            sphereInteraction = null;
            if (sphereCanvas.hasPointerCapture(event.pointerId)) {
                sphereCanvas.releasePointerCapture(event.pointerId);
            }
            sphereCanvas.style.cursor = 'grab';
            render();
        }
    };

    const handleSpherePointerDown = (event: PointerEvent) => {
        sphereInteraction = {
            pointerId: event.pointerId,
            lastX: event.clientX,
            lastY: event.clientY,
        };
        sphereCanvas.setPointerCapture(event.pointerId);
        sphereCanvas.style.cursor = 'grabbing';
        render();
    };

    const handleSpherePointerMove = () => {
        if (!sphereInteraction) {
            sphereCanvas.style.cursor = 'grab';
        }
    };

    const handleSpherePointerLeave = () => {
        if (!sphereInteraction) {
            sphereCanvas.style.cursor = 'grab';
        }
    };

    const handleResize = () => {
        render();
    };

    planeCanvas.addEventListener('pointerdown', handlePlanePointerDown);
    planeCanvas.addEventListener('pointermove', updatePlaneCursor);
    planeCanvas.addEventListener('pointerleave', () => {
        if (!planeInteraction) {
            planeCanvas.style.cursor = 'default';
        }
    });

    sphereCanvas.addEventListener('pointerdown', handleSpherePointerDown);
    sphereCanvas.addEventListener('pointermove', handleSpherePointerMove);
    sphereCanvas.addEventListener('pointerleave', handleSpherePointerLeave);

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(planeCanvas);
        resizeObserver.observe(sphereCanvas);
    } else {
        window.addEventListener('resize', handleResize);
        resizeFallbackAttached = true;
    }

    sphereCanvas.style.cursor = 'grab';
    render();

    return {
        refresh() {
            render();
        },
        destroy() {
            planeCanvas.removeEventListener('pointerdown', handlePlanePointerDown);
            planeCanvas.removeEventListener('pointermove', updatePlaneCursor);
            sphereCanvas.removeEventListener('pointerdown', handleSpherePointerDown);
            sphereCanvas.removeEventListener('pointermove', handleSpherePointerMove);
            sphereCanvas.removeEventListener('pointerleave', handleSpherePointerLeave);
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);

            if (resizeObserver) {
                resizeObserver.disconnect();
            } else if (resizeFallbackAttached) {
                window.removeEventListener('resize', handleResize);
            }
        },
    };
}
