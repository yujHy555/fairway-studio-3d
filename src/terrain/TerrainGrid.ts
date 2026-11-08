import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture
} from '@babylonjs/core';
import { GOLF_CONSTANTS, SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { Vector3D } from '../core/Types';

export interface StampedFeatureRecord {
  centerX: number;
  centerZ: number;
  width: number;
  length: number;
  rotationRad: number;
  surfaceType: SurfaceType;
  depthProfile: number;
  lipHeight: number;
}

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
  public splatTexture: DynamicTexture | null = null;
  public stampedFeatures: StampedFeatureRecord[] = [];
  private scene: Scene;

  constructor(scene: Scene, width = GOLF_CONSTANTS.DEFAULT_MAP_WIDTH, length = GOLF_CONSTANTS.DEFAULT_MAP_LENGTH) {
    this.scene = scene;
    this.width = Math.floor(width);
    this.length = Math.floor(length);
    this.cols = this.width + 1;
    this.rows = this.length + 1;

    const totalVerts = this.cols * this.rows;
    this.heights = new Float32Array(totalVerts);
    this.surfaceTypes = new Uint8Array(totalVerts);

    this.generateInitialNaturalTerrain();
  }

  private generateInitialNaturalTerrain() {
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const idx = z * this.cols + x;
        this.surfaceTypes[idx] = SurfaceType.ROUGH;

        // Natural undulation
        const wave1 = Math.sin(x * 0.04) * Math.cos(z * 0.03) * 1.4;
        const wave2 = Math.sin(x * 0.09 + 1.2) * Math.sin(z * 0.07) * 0.6;
        const centerDistX = Math.abs(x - this.width * 0.5) / (this.width * 0.5);
        const rimLift = Math.pow(centerDistX, 2) * 2.0;

        this.heights[idx] = Math.max(0, wave1 + wave2 + rimLift);
      }
    }
  }

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

  public getSurfaceAt(worldX: number, worldZ: number): SurfaceType {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.round(worldX)));
    const cz = Math.max(0, Math.min(this.rows - 1, Math.round(worldZ)));
    return this.surfaceTypes[cz * this.cols + cx] as SurfaceType;
  }

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

    const flattenHeight = targetFlattenHeight ?? this.getElevation(centerX, centerZ);

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dz = z - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > radius) continue;

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

    if (this.splatTexture && (mode === 'paint' || targetSurface !== undefined)) {
      const ctx = this.splatTexture.getContext() as CanvasRenderingContext2D;
      const sX = 1024 / this.width;
      const sZ = 2048 / this.length;
      const cx = centerX * sX;
      const cz = centerZ * sZ;
      const rX = radius * sX;
      const rZ = radius * sZ;

      const props = SURFACE_PROPERTIES[targetSurface];
      const r = Math.round(props.color[0] * 255);
      const g = Math.round(props.color[1] * 255);
      const b = Math.round(props.color[2] * 255);

      const grad = ctx.createRadialGradient(cx, cz, rX * 0.2, cx, cz, rX);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.85)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.0)`);

      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cz, rX, rZ, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      this.splatTexture.update(false);
    }

    this.rebuildMesh();
  }

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

        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;

        const normDist = Math.sqrt(Math.pow(localX / halfW, 2) + Math.pow(localZ / halfL, 2));

        if (normDist <= 1.25) {
          const idx = z * this.cols + x;

          if (surfaceType === SurfaceType.BUNKER) {
            if (normDist <= 0.85) {
              const bowlFactor = 1.0 - Math.pow(normDist / 0.85, 2);
              const targetH = baseElevation + depthProfile * bowlFactor;
              this.heights[idx] = targetH;
              this.surfaceTypes[idx] = SurfaceType.BUNKER;
            } else if (normDist <= 1.0) {
              // Steep inner bank slope
              const t = (normDist - 0.85) / 0.15;
              this.heights[idx] = baseElevation + depthProfile * (1 - t) * 0.3 + lipHeight * t * 0.5;
              this.surfaceTypes[idx] = SurfaceType.BUNKER;
            } else {
              // Raised grassy revetted lip ridge
              const lipFactor = Math.sin((normDist - 1.0) * Math.PI / 0.28);
              this.heights[idx] += lipHeight * lipFactor;
            }
          } else if (surfaceType === SurfaceType.GREEN) {
            if (normDist <= 1.0) {
              const blend = Math.cos(normDist * Math.PI * 0.5);
              this.heights[idx] = this.heights[idx] * (1 - blend) + (baseElevation + depthProfile) * blend;
              this.surfaceTypes[idx] = SurfaceType.GREEN;
            } else if (normDist <= 1.20 && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
              // 2m-3m Green Fringe Collar
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            }
          } else if (surfaceType === SurfaceType.FAIRWAY) {
            if (normDist <= 1.0) {
              this.surfaceTypes[idx] = SurfaceType.FAIRWAY;
            } else if (normDist <= 1.15 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
              // 3m Fairway First Cut border
              this.surfaceTypes[idx] = SurfaceType.FIRST_CUT;
            }
          } else if (surfaceType === SurfaceType.FRINGE) {
            if (normDist <= 1.0) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            }
          } else if (surfaceType === SurfaceType.FIRST_CUT) {
            if (normDist <= 1.0) {
              this.surfaceTypes[idx] = SurfaceType.FIRST_CUT;
            }
          } else if (surfaceType === SurfaceType.TEE) {
            if (normDist <= 1.0) {
              const blend = 1.0 - Math.pow(normDist, 4);
              this.heights[idx] = this.heights[idx] * (1 - blend) + (baseElevation + 0.2) * blend;
              this.surfaceTypes[idx] = SurfaceType.TEE;
            }
          } else if (surfaceType === SurfaceType.WATER) {
            if (normDist <= 1.0) {
              const basin = 1.0 - Math.pow(normDist, 2);
              this.heights[idx] = Math.min(this.heights[idx], baseElevation + depthProfile * basin);
              this.surfaceTypes[idx] = SurfaceType.WATER;
            }
          } else {
            if (normDist <= 1.0) {
              this.surfaceTypes[idx] = surfaceType;
            }
          }
        }
      }
    }

    // Record feature for high-resolution smooth vector splat map rendering
    this.stampedFeatures.push({
      centerX,
      centerZ,
      width,
      length,
      rotationRad,
      surfaceType,
      depthProfile,
      lipHeight
    });

    this.redrawSplatTexture();
    this.rebuildMesh();
  }

  public buildMesh(): Mesh {
    if (this.terrainMesh) {
      this.terrainMesh.dispose();
    }

    const mesh = new Mesh('GolfTerrain', this.scene);
    this.terrainMesh = mesh;

    // High-resolution Dynamic Texture for mathematically smooth, anti-aliased surface borders
    this.splatTexture = new DynamicTexture(
      'terrainSplatTexture',
      { width: 1024, height: 2048 },
      this.scene,
      true,
      Texture.BILINEAR_SAMPLINGMODE,
      undefined,
      false
    );
    this.splatTexture.wrapU = DynamicTexture.CLAMP_ADDRESSMODE;
    this.splatTexture.wrapV = DynamicTexture.CLAMP_ADDRESSMODE;

    const mat = new StandardMaterial('terrainMat', this.scene);
    mat.diffuseTexture = this.splatTexture;
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    mat.specularPower = 32;
    mat.backFaceCulling = false;
    mesh.material = mat;

    this.redrawSplatTexture();
    this.rebuildMesh();

    return mesh;
  }

  /**
   * Renders mathematically smooth, anti-aliased curved borders for all
   * fairways, first-cut margins, greens, fringe collars, bunkers, and tee boxes.
   */
  public redrawSplatTexture() {
    if (!this.splatTexture) return;

    const ctx = this.splatTexture.getContext() as CanvasRenderingContext2D;
    const canvasW = 1024;
    const canvasH = 2048;

    const sX = canvasW / this.width;
    const sZ = canvasH / this.length;

    // 1. Lush deep rough grass background
    ctx.fillStyle = '#2f5e23';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle natural organic turf texture
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let i = 0; i < 400; i++) {
      const rx = (Math.sin(i * 12.3) * 0.5 + 0.5) * canvasW;
      const rz = (Math.cos(i * 34.5) * 0.5 + 0.5) * canvasH;
      ctx.fillRect(rx, rz, 4, 4);
    }

    // 2. Draw all stamped features with smooth anti-aliased vector curves
    for (const feat of this.stampedFeatures) {
      this.drawFeatureOnCanvas(ctx, feat, sX, sZ);
    }

    this.splatTexture.update(false);
  }

  private drawFeatureOnCanvas(
    ctx: CanvasRenderingContext2D,
    feat: StampedFeatureRecord,
    sX: number,
    sZ: number
  ) {
    const cx = feat.centerX * sX;
    const cz = feat.centerZ * sZ;
    const halfW = (feat.width * 0.5) * sX;
    const halfL = (feat.length * 0.5) * sZ;

    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(feat.rotationRad);

    if (feat.surfaceType === SurfaceType.FAIRWAY) {
      // 1. First Cut outer border (3.2m wider) - perfectly smooth curve
      const fcW = halfW + 3.2 * sX;
      const fcL = halfL + 3.2 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, fcW, fcL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3f782c'; // Smooth intermediate first cut
      ctx.fill();

      // 2. Main Fairway body - super smooth anti-aliased boundary
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#5ab843'; // Crisp bright fairway green
      ctx.fill();

      // 3. Elegant Fairway Mowing Stripes (clipped to fairway ellipse)
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.clip();

      const stripeStep = 4.0 * sZ;
      const numStripes = Math.ceil(halfL * 2 / stripeStep);
      for (let i = -numStripes; i <= numStripes; i++) {
        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        }
        ctx.fillRect(-halfW * 1.5, i * stripeStep, halfW * 3.0, stripeStep);
      }
      ctx.restore();

    } else if (feat.surfaceType === SurfaceType.GREEN) {
      // 1. Fringe Collar (2.5m wider) - super smooth curve
      const fringeW = halfW + 2.5 * sX;
      const fringeL = halfL + 2.5 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, fringeW, fringeL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#469c4c'; // Green fringe collar
      ctx.fill();

      // 2. Championship Putting Green
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3ec26c'; // Tournament emerald green
      ctx.fill();

      // Subtle tournament green gradient/concentric highlight
      const greenGrad = ctx.createRadialGradient(0, 0, halfW * 0.2, 0, 0, halfW);
      greenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
      greenGrad.addColorStop(1, 'rgba(0, 0, 0, 0.04)');
      ctx.fillStyle = greenGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.BUNKER) {
      // 1. Raised grassy berm lip shadow / revetment outline (1.2m wider)
      const bermW = halfW + 1.2 * sX;
      const bermL = halfL + 1.2 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, bermW, bermL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#224718'; // Deep lush turf shadow framing the bunker
      ctx.fill();

      // 2. Steep sod-wall inner lip face (0.6m wider)
      const lipW = halfW + 0.6 * sX;
      const lipL = halfL + 0.6 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, lipW, lipL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#8f7b52'; // Shaded sandy sod face
      ctx.fill();

      // 3. Main bunker sand floor with rich, warm PGA Tour golden sand
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      const sandGrad = ctx.createRadialGradient(0, 0, halfW * 0.15, 0, 0, halfW);
      sandGrad.addColorStop(0, '#f2e0ad'); // Sunlit golden championship sand
      sandGrad.addColorStop(0.75, '#e4cd93'); // Gentle sand rake texture
      sandGrad.addColorStop(1, '#c2aa72'); // Shaded base rim
      ctx.fillStyle = sandGrad;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.TEE) {
      // Tee box border
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW + 0.6 * sX, halfL + 0.6 * sZ, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#397829';
      ctx.fill();

      // Tee box turf
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#5ab846';
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.WATER) {
      // 1. Gentle wet grass shoreline border
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW + 1.2 * sX, halfL + 1.2 * sZ, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2d5a35'; // Wet grass bank
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, halfW + 0.4 * sX, halfL + 0.4 * sZ, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1e382b'; // Dark shoreline silt
      ctx.fill();

      // 2. Deep lake basin silt (under translucent water plane)
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0f2f3d'; // Deep aquatic silt
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Advanced Low-Poly Texture & Multi-Surface Blending
   * Computes smooth transitions, mowing stripes, bunker feathering, and slope-based rock cliffs.
   */
  public rebuildMesh() {
    if (!this.terrainMesh) return;

    const quadCount = this.width * this.length;
    const vertexCount = quadCount * 6;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(vertexCount);

    let vIdx = 0;
    let pIdx = 0;
    let uIdx = 0;
    let cIdx = 0;

    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.width; x++) {
        const idx00 = z * this.cols + x;
        const idx10 = z * this.cols + (x + 1);
        const idx01 = (z + 1) * this.cols + x;
        const idx11 = (z + 1) * this.cols + (x + 1);

        const y00 = this.heights[idx00];
        const y10 = this.heights[idx10];
        const y01 = this.heights[idx01];
        const y11 = this.heights[idx11];

        // Triangle 1: (0,0), (0,1), (1,0)
        const ax1 = 0, ay1 = y01 - y00, az1 = 1;
        const bx1 = 1, by1 = y10 - y00, bz1 = 0;
        let nx1 = ay1 * bz1 - az1 * by1;
        let ny1 = az1 * bx1 - ax1 * bz1;
        let nz1 = ax1 * by1 - ay1 * bx1;
        const l1 = Math.sqrt(nx1 * nx1 + ny1 * ny1 + nz1 * nz1) || 1;
        nx1 /= l1; ny1 /= l1; nz1 /= l1;

        const tri1Verts = [
          { px: x, py: y00, pz: z },
          { px: x, py: y01, pz: z + 1 },
          { px: x + 1, py: y10, pz: z }
        ];

        const slopeShade1 = Math.max(0.70, ny1);

        for (const tv of tri1Verts) {
          positions[pIdx] = tv.px;
          positions[pIdx + 1] = tv.py;
          positions[pIdx + 2] = tv.pz;

          normals[pIdx] = nx1;
          normals[pIdx + 1] = ny1;
          normals[pIdx + 2] = nz1;

          uvs[uIdx] = tv.px / this.width;
          uvs[uIdx + 1] = tv.pz / this.length;

          colors[cIdx] = slopeShade1;
          colors[cIdx + 1] = slopeShade1;
          colors[cIdx + 2] = slopeShade1;
          colors[cIdx + 3] = 1.0;

          indices[vIdx] = vIdx;
          vIdx++;
          pIdx += 3;
          uIdx += 2;
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
          { px: x + 1, py: y10, pz: z },
          { px: x, py: y01, pz: z + 1 },
          { px: x + 1, py: y11, pz: z + 1 }
        ];

        const slopeShade2 = Math.max(0.70, ny2);

        for (const tv of tri2Verts) {
          positions[pIdx] = tv.px;
          positions[pIdx + 1] = tv.py;
          positions[pIdx + 2] = tv.pz;

          normals[pIdx] = nx2;
          normals[pIdx + 1] = ny2;
          normals[pIdx + 2] = nz2;

          uvs[uIdx] = tv.px / this.width;
          uvs[uIdx + 1] = tv.pz / this.length;

          colors[cIdx] = slopeShade2;
          colors[cIdx + 1] = slopeShade2;
          colors[cIdx + 2] = slopeShade2;
          colors[cIdx + 3] = 1.0;

          indices[vIdx] = vIdx;
          vIdx++;
          pIdx += 3;
          uIdx += 2;
          cIdx += 4;
        }
      }
    }

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.colors = colors;
    vertexData.indices = indices;
    vertexData.applyToMesh(this.terrainMesh, true);
  }
}
