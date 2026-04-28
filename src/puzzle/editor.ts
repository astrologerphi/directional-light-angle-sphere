import { puzzleGroups } from '../data';

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
}

interface PuzzleEditorElements {
    planeCanvas: HTMLCanvasElement;
    sphereCanvas: HTMLCanvasElement;
    figureList: HTMLElement;
    sidebarStatus?: HTMLElement | null;
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
        const centerDot = Math.max(0.001, dotPoint3(point, center));
        return {
            x: dotPoint3(point, basis.tangentX) / centerDot,
            y: dotPoint3(point, basis.tangentY) / centerDot,
        };
    };

    const buildPuzzleFigure = (group: { x: number; y: number }[], index: number): PuzzleFigure => {
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
            name: `Shape ${index + 1}`,
            color: PUZZLE_FIGURE_COLORS[index % PUZZLE_FIGURE_COLORS.length],
            visible: true,
            valueCount: group.length,
            center,
            rotation: 0,
            scale: 1,
            handleDistance,
            baseVertices,
        };
    };

    const figures: PuzzleFigure[] = puzzleGroups.map((group, index) => buildPuzzleFigure(group, index));

    selectedFigureId = figures[0]?.id ?? '';

    const getVisibleFigures = (): PuzzleFigure[] => figures.filter(figure => figure.visible);

    const localPointToSphere = (center: Point3, localPoint: Point2): Point3 => {
        const basis = getFigureBasis(center);
        return normalizePoint3(
            addPoint3(
                center,
                addPoint3(scalePoint3(basis.tangentX, localPoint.x), scalePoint3(basis.tangentY, localPoint.y))
            )
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

        for (let index = 0; index < sphereVertices.length; index++) {
            const start = sphereVertices[index];
            const end = sphereVertices[(index + 1) % sphereVertices.length];

            if (pointsAlmostEqual(start, end)) {
                continue;
            }

            for (let step = 0; step < BOUNDARY_SEGMENT_SAMPLES; step++) {
                sphereBoundary.push(slerpSpherePoints(start, end, step / BOUNDARY_SEGMENT_SAMPLES));
            }
        }

        const planeBoundary = sphereBoundary.map(sphereToPlane);

        return {
            centerPlane: sphereToPlane(figure.center),
            handlePlane,
            sphereVertices,
            planeVertices,
            sphereBoundary,
            planeBoundary,
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

        figures.forEach(figure => {
            const item = document.createElement('li');
            item.className = 'puzzle-figure-item';
            item.classList.toggle('active', figure.id === selectedFigureId);
            item.classList.toggle('hidden', !figure.visible);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'puzzle-figure-checkbox';
            checkbox.checked = figure.visible;
            checkbox.setAttribute('aria-label', `Show ${figure.name}`);

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

            item.appendChild(checkbox);
            item.appendChild(swatch);
            item.appendChild(content);

            item.addEventListener('click', () => {
                selectedFigureId = selectedFigureId === figure.id ? '' : figure.id;
                render();
            });

            checkbox.addEventListener('click', event => {
                event.stopPropagation();
            });

            checkbox.addEventListener('change', () => {
                figure.visible = checkbox.checked;
                if (!figure.visible && planeInteraction?.figureId === figure.id) {
                    planeInteraction = null;
                }
                render();
            });

            figureList.appendChild(item);
        });
    };

    const updateStatuses = () => {
        const selectedFigure = getSelectedFigure();
        if (sidebarStatus) {
            sidebarStatus.textContent = selectedFigure
                ? selectedFigure.visible
                    ? `${selectedFigure.name} is selected. Drag it in the plane to move it, drag its ring handle to rotate it, and drag the sphere view to orbit the camera.`
                    : `${selectedFigure.name} is selected but hidden. Check it in the list to show it in the plane and sphere views.`
                : 'Select a figure from the list. Checked figures are shown in the plane and sphere views.';
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
        updateStatuses();
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
