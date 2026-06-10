import sphereVertexShader from './sphere.vert.wgsl';
import sphereFragmentShader from './sphere.frag.wgsl';
import lineVertexShader from './line.vert.wgsl';
import lineFragmentShader from './line.frag.wgsl';
import lightLineFragmentShader from './light-line.frag.wgsl';
import dotVertexShader from './dot.vert.wgsl';
import dotFragmentShader from './dot.frag.wgsl';
import hexagonSphereVertexShader from './hexagon-sphere.vert.wgsl';
import hexagonSphereFragmentShader from './hexagon-sphere.frag.wgsl';
import trailVertexShader from './trail.vert.wgsl';
import trailFragmentShader from './trail.frag.wgsl';
import gridFragmentShader from './grid.frag.wgsl';

// Light line uses the same vertex shader as line
const lightLineVertexShader = lineVertexShader;
// Grid uses the same vertex shader as line
const gridVertexShader = lineVertexShader;

export {
    sphereVertexShader,
    sphereFragmentShader,
    lineVertexShader,
    lineFragmentShader,
    lightLineVertexShader,
    lightLineFragmentShader,
    dotVertexShader,
    dotFragmentShader,
    hexagonSphereVertexShader,
    hexagonSphereFragmentShader,
    trailVertexShader,
    trailFragmentShader,
    gridVertexShader,
    gridFragmentShader,
};
