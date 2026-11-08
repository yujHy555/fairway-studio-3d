import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture
} from '@babylonjs/core';
import { RealisticTextures } from './RealisticTextures';

/**
 * Realistic Surrounding Valley & Mountain Backdrop
 * Generates a smooth, continuous landscape (1200m x 1200m) framing the playable golf course
 * with seamless tiled turf/forest textures and zero overlap inside the playable course grid.
 */
export class ProceduralBackdrop {
  private scene: Scene;
  public backdropMesh: Mesh | null = null;

  private readonly worldSize = 1100;
  private readonly resolution = 120;

  // Full playable course bounds (0..220 x 0..460) so backdrop never pokes through bunkers or ponds
  private readonly courseMinX = 0;
  private readonly courseMaxX = 220;
  private readonly courseMinZ = 0;
  private readonly courseMaxZ = 460;

  constructor(scene: Scene) {
    this.scene = scene;
    this.buildBackdrop();
  }

  private fbm(x: number, z: number): number {
    let total = 0;
    let amplitude = 1.0;
    let frequency = 0.0045;
    let maxValue = 0;

    for (let i = 0; i < 4; i++) {
      total +=
        (Math.sin(x * frequency) * Math.cos(z * frequency) +
          Math.cos(x * frequency * 0.72 + 1.4) * Math.sin(z * frequency * 0.85)) *
        amplitude;
      maxValue += amplitude * 2;
      amplitude *= 0.5;
      frequency *= 2.05;
    }

    return (total / maxValue) * 42.0;
  }

  public getElevation(wx: number, wz: number): number {
    return this.sampleHeight(wx, wz);
  }

  private sampleHeight(wx: number, wz: number): number {
    const dx = Math.max(0, Math.max(this.courseMinX - wx, wx - this.courseMaxX));
    const dz = Math.max(0, Math.max(this.courseMinZ - wz, wz - this.courseMaxZ));
    const distFromCourse = Math.sqrt(dx * dx + dz * dz);

    // Keep strictly below -8.0m anywhere inside or within 4m of the playable course
    // so deep bunkers and water hazards never intersect the backdrop!
    if (distFromCourse < 4.0) {
      return -8.0;
    }

    // Smooth blend from course rim (y = 2.2m at edge) up into surrounding hills
    const t = Math.min(1.0, Math.max(0, (distFromCourse - 4.0) / 110.0));
    const smoothT = t * t * (3.0 - 2.0 * t);

    const rimMatch = Math.min(1.0, (distFromCourse - 4.0) / 16.0);
    const baseHeight = -8.0 * (1.0 - rimMatch) + 1.8 * rimMatch;
    const rawHills = Math.max(0, this.fbm(wx, wz) + 14.0);

    return baseHeight + rawHills * smoothT;
  }

  public buildBackdrop() {
    if (this.backdropMesh) {
      this.backdropMesh.dispose();
    }

    const cols = this.resolution + 1;
    const rows = this.resolution + 1;
    const step = this.worldSize / this.resolution;
    const originX = 110 - this.worldSize * 0.5;
    const originZ = 230 - this.worldSize * 0.5;

    const totalVerts = cols * rows;
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const colors = new Float32Array(totalVerts * 4);
    const indices: number[] = [];

    for (let r = 0; r < rows; r++) {
      const wz = originZ + r * step;
      for (let c = 0; c < cols; c++) {
        const wx = originX + c * step;
        const vIdx = r * cols + c;
        const wy = this.sampleHeight(wx, wz);

        positions[vIdx * 3] = wx;
        positions[vIdx * 3 + 1] = wy;
        positions[vIdx * 3 + 2] = wz;

        uvs[vIdx * 2] = (wx - originX) / 40.0;
        uvs[vIdx * 2 + 1] = (wz - originZ) / 40.0;

        // Smooth elevation & slope-aware natural coloring
        const eps = 3.0;
        const hL = this.sampleHeight(wx - eps, wz);
        const hR = this.sampleHeight(wx + eps, wz);
        const hD = this.sampleHeight(wx, wz - eps);
        const hU = this.sampleHeight(wx, wz + eps);
        let nx = (hL - hR) / (2 * eps);
        let ny = 1.0;
        let nz = (hD - hU) / (2 * eps);
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        normals[vIdx * 3] = nx;
        normals[vIdx * 3 + 1] = ny;
        normals[vIdx * 3 + 2] = nz;

        const slope = 1.0 - ny;
        let rC = 0.78, gC = 0.88, bC = 0.74;
        if (slope > 0.28) {
          // Exposed mountain granite outcroppings
          const rockBlend = Math.min(1.0, (slope - 0.28) * 3.5);
          rC = rC * (1 - rockBlend) + 0.65 * rockBlend;
          gC = gC * (1 - rockBlend) + 0.64 * rockBlend;
          bC = bC * (1 - rockBlend) + 0.62 * rockBlend;
        }

        colors[vIdx * 4] = rC;
        colors[vIdx * 4 + 1] = gC;
        colors[vIdx * 4 + 2] = bC;
        colors[vIdx * 4 + 3] = 1.0;
      }
    }

    for (let r = 0; r < this.resolution; r++) {
      for (let c = 0; c < this.resolution; c++) {
        const x0 = originX + c * step;
        const x1 = originX + (c + 1) * step;
        const z0 = originZ + r * step;
        const z1 = originZ + (r + 1) * step;

        // Completely omit quads inside the playable course rectangle so there is zero overlap
        if (
          x0 >= this.courseMinX + 4 &&
          x1 <= this.courseMaxX - 4 &&
          z0 >= this.courseMinZ + 4 &&
          z1 <= this.courseMaxZ - 4
        ) {
          continue;
        }

        const idx00 = r * cols + c;
        const idx10 = r * cols + (c + 1);
        const idx01 = (r + 1) * cols + c;
        const idx11 = (r + 1) * cols + (c + 1);

        indices.push(idx00, idx01, idx10);
        indices.push(idx10, idx01, idx11);
      }
    }

    const mesh = new Mesh('ProceduralBackdropMesh', this.scene);
    mesh.isPickable = false;
    mesh.receiveShadows = true;

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.colors = colors;
    vertexData.indices = new Uint32Array(indices);
    vertexData.applyToMesh(mesh, false);

    // Seamless tiled rough grass texture on backdrop hills
    const roughCanvas = RealisticTextures.createSeamlessSurfacePattern('rough');
    const backdropTex = new DynamicTexture('backdropGrassTex', 256, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    backdropTex.wrapU = Texture.WRAP_ADDRESSMODE;
    backdropTex.wrapV = Texture.WRAP_ADDRESSMODE;
    const ctx = backdropTex.getContext() as CanvasRenderingContext2D;
    ctx.drawImage(roughCanvas, 0, 0);
    backdropTex.update(true);

    const mat = new StandardMaterial('backdropMat', this.scene);
    mat.diffuseTexture = backdropTex;
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    mat.backFaceCulling = false;
    mesh.material = mat;

    this.backdropMesh = mesh;
  }
}
