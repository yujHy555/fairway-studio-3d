import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Color3,
  Vector3
} from '@babylonjs/core';
import { GOLF_CONSTANTS, SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { Vector3D } from '../core/Types';

export class TerrainGrid {
  public readonly width: number;
  public readonly length: number;
  public readonly cols: number; // width + 1
  public readonly rows: number; // length + 1

  // Heights and Surface IDs at each 1m grid vertex
  public heights: Float32Array;
  public surfaceTypes: Uint8Array;

  // Babylon mesh representation
  public terrainMesh: Mesh | null = null;
  public gridOverlayMesh: Mesh | null = null;
  private scene: Scene;

  // Tracking modified bounding box for fast updates
  private isDirty = true;

  constructor(scene: Scene, width = GOLF_CONSTANTS.DEFAULT_MAP_WIDTH, length = GOLF_CONSTANTS.DEFAULT_MAP_LENGTH) {
    this.scene = scene;
    this.width = Math.floor(width);
    this.length = Math.floor(length);
    this.cols = this.width + 1;
    this.rows = this.length + 1;

    const totalVerts = this.cols * this.rows;
    this.heights = new Float32Array(totalVerts);
    this.surfaceTypes = new Uint8Array(totalVerts);

    // Default entire terrain to Rough with subtle natural rolling undulation
    this.generateInitialNaturalTerrain();
  }

  private getIndex(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.round(x)));
    const cz = Math.max(0, Math.min(this.rows - 1, Math.round(z)));
    return cz * this.cols + cx;
  }

  /**
   * Initializes terrain with gentle rolling low-poly topography
   */
  private generateInitialNaturalTerrain() {
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const idx = z * this.cols + x;
        // Default to rough grass
        this.surfaceTypes[idx] = SurfaceType.ROUGH;

        // Gentle natural undulation (wavelength ~80m, amp ~1.5m)
        const wave1 = Math.sin(x * 0.04) * Math.cos(z * 0.03) * 1.4;
        const wave2 = Math.sin(x * 0.09 + 1.2) * Math.sin(z * 0.07) * 0.6;
        // Slight natural drainage tilt towards center
        const centerDistX = Math.abs(x - this.width * 0.5) / (this.width * 0.5);
        const rimLift = Math.pow(centerDistX, 2) * 2.0;

        this.heights[idx] = Math.max(0, wave1 + wave2 + rimLift);
      }
    }
  }

  /**
   * Samples terrain elevation at any continuous world coordinate (x, z)
   * using bilinear interpolation.
   */
  public getElevation(worldX: number, worldZ: number): number {
    const x = Math.max(0, Math.min(this.width - 0.001, worldX));
    const z = Math.max(0, Math.min(this.length - 0.001, worldZ));

    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const z0 = Math.floor(z);
    const z1 = z0 + 1;

    const fx = x - x0;
    const fz = z - z0;

    const h00 = this.heights[z0 * this.cols + x0];
    const h10 = this.heights[z0 * this.cols + x1];
    const h01 = this.heights[z1 * this.cols + x0];
    const h11 = this.heights[z1 * this.cols + x1];

    const hTop = h00 * (1 - fx) + h10 * fx;
    const hBottom = h01 * (1 - fx) + h11 * fx;

    return hTop * (1 - fz) + hBottom * fz;
  }

  /**
   * Returns surface type at continuous world coordinate (x, z)
   */
  public getSurfaceAt(worldX: number, worldZ: number): SurfaceType {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.round(worldX)));
    const cz = Math.max(0, Math.min(this.rows - 1, Math.round(worldZ)));
    return this.surfaceTypes[cz * this.cols + cx] as SurfaceType;
  }

  /**
   * Computes surface normal at (x, z) for slope calculation and ball bounce
   */
  public getNormal(worldX: number, worldZ: number): Vector3D {
    const eps = 0.5;
    const hL = this.getElevation(worldX - eps, worldZ);
    const hR = this.getElevation(worldX + eps, worldZ);
    const hD = this.getElevation(worldX, worldZ - eps);
    const hU = this.getElevation(worldX, worldZ + eps);

    const nx = (hL - hR) / (2 * eps);
    const ny = 1.0;
    const nz = (hD - hU) / (2 * eps);

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /**
   * Modifies terrain using interactive brush
   */
  public applySculptBrush(
    centerX: number,
    centerZ: number,
    radius: number,
    strength: number,
    mode: 'raise' | 'lower' | 'flatten' | 'smooth' | 'paint',
    targetSurface: SurfaceType = SurfaceType.FAIRWAY,
    targetFlattenHeight?: number
  ) {
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(this.cols - 1, Math.ceil(centerX + radius));
    const minZ = Math.max(0, Math.floor(centerZ - radius));
    const maxZ = Math.min(this.rows - 1, Math.ceil(centerZ + radius));

    let flattenHeight = targetFlattenHeight ?? this.getElevation(centerX, centerZ);

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dz = z - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > radius) continue;

        // Smooth cosine falloff
        const falloff = 0.5 * (1.0 + Math.cos((dist / radius) * Math.PI));
        const idx = z * this.cols + x;

        switch (mode) {
          case 'raise':
            this.heights[idx] += strength * falloff;
            break;
          case 'lower':
            this.heights[idx] = Math.max(-4.0, this.heights[idx] - strength * falloff);
            break;
          case 'flatten':
            this.heights[idx] = this.heights[idx] * (1 - falloff * strength) + flattenHeight * (falloff * strength);
            break;
          case 'smooth': {
            // Average with 4-neighborhood
            const nL = x > 0 ? this.heights[idx - 1] : this.heights[idx];
            const nR = x < this.cols - 1 ? this.heights[idx + 1] : this.heights[idx];
            const nD = z > 0 ? this.heights[idx - this.cols] : this.heights[idx];
            const nU = z < this.rows - 1 ? this.heights[idx + this.cols] : this.heights[idx];
            const avg = (nL + nR + nD + nU) * 0.25;
            this.heights[idx] = this.heights[idx] * (1 - falloff * strength) + avg * (falloff * strength);
            break;
          }
          case 'paint':
            if (falloff > 0.25) {
              this.surfaceTypes[idx] = targetSurface;
            }
            break;
        }

        if (mode !== 'paint' && targetSurface !== undefined && falloff > 0.4) {
          this.surfaceTypes[idx] = targetSurface;
        }
      }
    }

    this.isDirty = true;
    this.rebuildMesh();
  }

  /**
   * Automatic Feature Stamp with geometric blending (Bunkers, Greens, Tees, Fairways, Water)
   */
  public stampFeature(
    centerX: number,
    centerZ: number,
    width: number,
    length: number,
    rotationRad: number,
    surfaceType: SurfaceType,
    depthProfile: number = 0,
    lipHeight: number = 0
  ) {
    const halfW = width * 0.5;
    const halfL = length * 0.5;
    const maxDim = Math.max(width, length) * 0.8;

    const minX = Math.max(0, Math.floor(centerX - maxDim));
    const maxX = Math.min(this.cols - 1, Math.ceil(centerX + maxDim));
    const minZ = Math.max(0, Math.floor(centerZ - maxDim));
    const maxZ = Math.min(this.rows - 1, Math.ceil(centerZ + maxDim));

    const cosR = Math.cos(-rotationRad);
    const sinR = Math.sin(-rotationRad);

    const baseElevation = this.getElevation(centerX, centerZ);

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dz = z - centerZ;

        // Transform into local feature coordinate system
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;

        // Normalized distance in oriented ellipse
        const normDist = Math.sqrt(Math.pow(localX / halfW, 2) + Math.pow(localZ / halfL, 2));

        if (normDist <= 1.25) {
          const idx = z * this.cols + x;

          if (surfaceType === SurfaceType.BUNKER) {
            // Bunker carving: Deep bowl inside + raised lip around edge
            if (normDist <= 1.0) {
              const bowlFactor = 1.0 - Math.pow(normDist, 2);
              const targetH = baseElevation + depthProfile * bowlFactor;
              this.heights[idx] = this.heights[idx] * 0.3 + targetH * 0.7;
              this.surfaceTypes[idx] = SurfaceType.BUNKER;
            } else {
              // Outer lip rim (raised lip helps frame bunkers visually)
              const lipFactor = Math.sin((normDist - 1.0) * Math.PI / 0.25);
              this.heights[idx] += lipHeight * lipFactor * 0.5;
            }
          } else if (surfaceType === SurfaceType.GREEN) {
            // Green: smooth plateau at base elevation with subtle crown
            if (normDist <= 1.0) {
              const blend = Math.cos(normDist * Math.PI * 0.5);
              this.heights[idx] = this.heights[idx] * (1 - blend) + (baseElevation + depthProfile) * blend;
              this.surfaceTypes[idx] = SurfaceType.GREEN;
            }
          } else if (surfaceType === SurfaceType.TEE) {
            // Tee: laser flat rectangular/oval pad
            if (normDist <= 1.0) {
              const blend = 1.0 - Math.pow(normDist, 4);
              this.heights[idx] = this.heights[idx] * (1 - blend) + (baseElevation + 0.2) * blend;
              this.surfaceTypes[idx] = SurfaceType.TEE;
            }
          } else if (surfaceType === SurfaceType.WATER) {
            // Water basin: steep excavated cavity
            if (normDist <= 1.0) {
              const basin = 1.0 - Math.pow(normDist, 2);
              this.heights[idx] = Math.min(this.heights[idx], baseElevation + depthProfile * basin);
              this.surfaceTypes[idx] = SurfaceType.WATER;
            }
          } else {
            // Fairway or other surface
            if (normDist <= 1.0) {
              this.surfaceTypes[idx] = surfaceType;
            }
          }
        }
      }
    }

    this.isDirty = true;
    this.rebuildMesh();
  }

  /**
   * Builds the faceted low-poly mesh and vertex color buffers
   */
  public buildMesh(): Mesh {
    if (this.terrainMesh) {
      this.terrainMesh.dispose();
    }

    const mesh = new Mesh('GolfTerrain', this.scene);
    this.terrainMesh = mesh;

    this.rebuildMesh();

    const mat = new StandardMaterial('terrainMat', this.scene);
    mat.specularColor = new Color3(0.05, 0.05, 0.05); // Matte low-poly finish
    mat.backFaceCulling = false;
    mesh.material = mat;

    return mesh;
  }

  /**
   * Regenerates vertex data for low-poly flat shading or smooth shading
   */
  public rebuildMesh() {
    if (!this.terrainMesh) return;

    // Build faceted low-poly triangles: each quad is split into 2 triangles with independent flat normals
    // This gives the signature AAA low-poly aesthetic!
    const quadCount = this.width * this.length;
    const vertexCount = quadCount * 6; // 2 triangles per quad = 6 vertices

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(vertexCount);

    let vIdx = 0;
    let pIdx = 0;
    let cIdx = 0;

    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.width; x++) {
        // 4 corners of current 1m x 1m quad
        const idx00 = z * this.cols + x;
        const idx10 = z * this.cols + (x + 1);
        const idx01 = (z + 1) * this.cols + x;
        const idx11 = (z + 1) * this.cols + (x + 1);

        const y00 = this.heights[idx00];
        const y10 = this.heights[idx10];
        const y01 = this.heights[idx01];
        const y11 = this.heights[idx11];

        const s00 = this.surfaceTypes[idx00];
        const s10 = this.surfaceTypes[idx10];
        const s01 = this.surfaceTypes[idx01];
        const s11 = this.surfaceTypes[idx11];

        // Triangle 1: (0,0), (0,1), (1,0)
        // Compute flat normal for Tri 1
        const ax1 = 0, ay1 = y01 - y00, az1 = 1;
        const bx1 = 1, by1 = y10 - y00, bz1 = 0;
        let nx1 = ay1 * bz1 - az1 * by1;
        let ny1 = az1 * bx1 - ax1 * bz1;
        let nz1 = ax1 * by1 - ay1 * bx1;
        const l1 = Math.sqrt(nx1 * nx1 + ny1 * ny1 + nz1 * nz1) || 1;
        nx1 /= l1; ny1 /= l1; nz1 /= l1;

        // Tri 1 vertices
        const tri1Verts = [
          { px: x, py: y00, pz: z, s: s00 },
          { px: x, py: y01, pz: z + 1, s: s01 },
          { px: x + 1, py: y10, pz: z, s: s10 }
        ];

        for (const tv of tri1Verts) {
          positions[pIdx] = tv.px;
          positions[pIdx + 1] = tv.py;
          positions[pIdx + 2] = tv.pz;

          normals[pIdx] = nx1;
          normals[pIdx + 1] = ny1;
          normals[pIdx + 2] = nz1;

          const rgb = SURFACE_PROPERTIES[tv.s as SurfaceType].color;
          // Add subtle per-triangle low-poly color jitter
          const jitter = (Math.sin(tv.px * 12.3 + tv.pz * 45.6) * 0.03);
          colors[cIdx] = Math.max(0, Math.min(1, rgb[0] + jitter));
          colors[cIdx + 1] = Math.max(0, Math.min(1, rgb[1] + jitter));
          colors[cIdx + 2] = Math.max(0, Math.min(1, rgb[2] + jitter));
          colors[cIdx + 3] = 1.0;

          indices[vIdx] = vIdx;
          vIdx++;
          pIdx += 3;
          cIdx += 4;
        }

        // Triangle 2: (1,0), (0,1), (1,1)
        const ax2 = -1, ay2 = y01 - y10, az2 = 1;
        const bx2 = 0, by2 = y11 - y10, bz2 = 1;
        let nx2 = ay2 * bz2 - az2 * by2;
        let ny2 = az2 * bx2 - ax2 * bz2;
        let nz2 = ax2 * by2 - ay2 * bx2;
        const l2 = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1;
        nx2 /= l2; ny2 /= l2; nz2 /= l2;

        const tri2Verts = [
          { px: x + 1, py: y10, pz: z, s: s10 },
          { px: x, py: y01, pz: z + 1, s: s01 },
          { px: x + 1, py: y11, pz: z + 1, s: s11 }
        ];

        for (const tv of tri2Verts) {
          positions[pIdx] = tv.px;
          positions[pIdx + 1] = tv.py;
          positions[pIdx + 2] = tv.pz;

          normals[pIdx] = nx2;
          normals[pIdx + 1] = ny2;
          normals[pIdx + 2] = nz2;

          const rgb = SURFACE_PROPERTIES[tv.s as SurfaceType].color;
          const jitter = (Math.cos(tv.px * 32.1 + tv.pz * 65.4) * 0.03);
          colors[cIdx] = Math.max(0, Math.min(1, rgb[0] + jitter));
          colors[cIdx + 1] = Math.max(0, Math.min(1, rgb[1] + jitter));
          colors[cIdx + 2] = Math.max(0, Math.min(1, rgb[2] + jitter));
          colors[cIdx + 3] = 1.0;

          indices[vIdx] = vIdx;
          vIdx++;
          pIdx += 3;
          cIdx += 4;
        }
      }
    }

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.indices = indices;
    vertexData.applyToMesh(this.terrainMesh, true);

    this.isDirty = false;
  }
}
