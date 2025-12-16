# Directional Light Angle Sphere

A web application that visualizes the periodic change of directional light direction on a 3D sphere using WebGPU.

![App Screenshot](https://github.com/user-attachments/assets/23063659-04c8-43fe-b3e1-3daa03771fb4)

## Features

- **Translucent Sphere**: A 3D sphere with semi-transparent material that allows viewing both the interior and exterior
- **Scale Markers**: Latitude and longitude lines displayed on the sphere surface for spatial reference
- **Directional Light Visualization**: A line connecting the center of the sphere to the surface, representing the light direction
- **Glowing Dot**: A glowing particle at the point where the light direction intersects the sphere surface
- **Animated Trail**: The light direction moves along a figure-8 path (lemniscate), leaving a trail that gradually fades over time
- **Demo Data**: Pre-configured periodic animation showing smooth light direction changes
- **Play/Pause Control**: Interactive control to pause and resume the animation

## Technologies

- **React**: UI framework
- **TypeScript**: Type-safe development
- **WebGPU**: Modern GPU API for high-performance 3D graphics
- **Vite**: Fast build tool and development server

## Requirements

WebGPU is required to run this application. It is currently supported in:

- **Chrome 113+** (stable)
- **Edge 113+** (stable)
- **Safari 18+** (experimental, may need to be enabled in settings)
- **Firefox Nightly** (experimental, behind a flag)

### Enabling WebGPU

- **Chrome/Edge**: WebGPU is enabled by default in version 113 and later
- **Safari**: Go to Safari > Settings > Advanced > Feature Flags and enable WebGPU
- **Firefox**: Navigate to `about:config` and set `dom.webgpu.enabled` to `true`

## Installation

```bash
npm install
```

## Development

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173/`

## Build

Build for production:

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Preview Production Build

Preview the production build:

```bash
npm run preview
```

## Project Structure

```
src/
├── components/
│   ├── WebGPUVisualization.tsx    # Main WebGPU rendering component
│   └── WebGPUVisualization.css    # Component styles
├── utils/
│   ├── demoData.ts                # Demo animation data generator
│   ├── geometry.ts                # 3D geometry utilities (sphere, scale lines)
│   └── shaders.ts                 # WebGPU shader code (WGSL)
├── App.tsx                        # Main application component
├── App.css                        # Application styles
├── main.tsx                       # Application entry point
└── index.css                      # Global styles
```

## How It Works

1. **Sphere Geometry**: Generated programmatically with vertices, normals, and indices for triangle rendering
2. **Scale Lines**: Latitude and longitude lines created as line strips for spatial reference
3. **Light Direction**: Interpolated smoothly between predefined points following a figure-8 pattern
4. **Trail Effect**: Stores recent light positions and renders them with age-based opacity fading
5. **Glowing Dot**: Billboard quad rendered at the light direction point with radial gradient shader
6. **Animation Loop**: Uses `requestAnimationFrame` for smooth 60fps rendering

## Demo Data

The application uses a procedurally generated figure-8 pattern (lemniscate) on the sphere surface. The light direction smoothly interpolates between 200 points over a 20-second cycle using spherical linear interpolation (slerp) for natural motion.

## License

ISC
