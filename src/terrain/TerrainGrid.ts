import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Material,
  Color3,
  DynamicTexture,
  Texture
} from '@babylonjs/core';
import { GOLF_CONSTANTS, SurfaceType } from '../core/Constants';
import { Vector3D } from '../core/Types';
import { RealisticTextures } from './RealisticTextures';

export interface DoglegWaypoint {
  x: number;
  z: number;
  width: number;
}

export interface StampedFeatureRecord {
  centerX: number;
  centerZ: number;
  width: number;
  length: number;
  rotationRad: number;
  surfaceType: SurfaceType;
  depthProfile: number;
  lipHeight: number;
  isKidney?: boolean;
  doglegPoints?: DoglegWaypoint[];
}

export class TerrainGrid {
  public readonly width: number;
  public readonly length: number;
  public readonly cols: number; // width + 1
  public readonly rows: number; // length + 1

  public heights: Float32Array;
  public surfaceTypes: Uint8Array;

  public terrainMesh: Mesh | null = null;
  public bunkerSandOverlayMesh: Mesh | null = null;
  public bunkerLipWallMesh: Mesh | null = null;
  public teeBoxOverlayMesh: Mesh | null = null;
  public splatTexture: DynamicTexture | null = null;
  public stampedFeatures: StampedFeatureRecord[] = [];
  private scene: Scene;

  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;
  private colors: Float32Array;
  private indices: Uint32Array;

  private static patternTiles: Record<string, HTMLCanvasElement> | null = null;

  private matBunkerSandOverlay!: StandardMaterial;
  private matBunkerLipWall!: StandardMaterial;
  private matTeeBoxOverlay!: StandardMaterial;

  constructor(scene: Scene, width = GOLF_CONSTANTS.DEFAULT_MAP_WIDTH, length = GOLF_CONSTANTS.DEFAULT_MAP_LENGTH) {
    this.scene = scene;
    this.width = Math.floor(width);
    this.length = Math.floor(length);
    this.cols = this.width + 1;
    this.rows = this.length + 1;

    const totalVerts = this.cols * this.rows;
    this.heights = new Float32Array(totalVerts);
    this.surfaceTypes = new Uint8Array(totalVerts);

    this.positions = new Float32Array(totalVerts * 3);
    this.normals = new Float32Array(totalVerts * 3);
    this.uvs = new Float32Array(totalVerts * 2);
    this.colors = new Float32Array(totalVerts * 4);
    this.indices = new Uint32Array(this.width * this.length * 6);

    this.initStaticIndexAndUVBuffers();
    this.ensurePatternTiles();
    this.initHighResPhotoMaterials();
    this.generateInitialNaturalTerrain();
  }

  private initHighResPhotoMaterials() {
    /**
     * Converts a 2048x2048 photo into a 1024x1024 flat-field equalized, 100% seamless texture.
     * Uses a 2-pass separable sliding-window box filter (radius R) to remove all low-frequency
     * blotches, internal sub-tile patches, and edge illumination gradients while preserving 100%
     * of the fine photographic grass blades and fine quartz sand grains.
     */
    const createSeamlessPhotoTexture = (
      url: string,
      name: string,
      kernelRadius: number,
      detailGain: number
    ): DynamicTexture => {
      const size = 1024;
      const dynTex = new DynamicTexture(name, size, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      dynTex.wrapU = Texture.WRAP_ADDRESSMODE;
      dynTex.wrapV = Texture.WRAP_ADDRESSMODE;
      dynTex.anisotropicFilteringLevel = 16;

      const img = new Image();
      img.src = url;
      img.onload = () => {
        const ctx = dynTex.getContext() as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0, size, size);

        const imgData = ctx.getImageData(0, 0, size, size);
        const src = imgData.data;
        const numPixels = size * size;

        // Compute global mean RGB
        let sumR = 0, sumG = 0, sumB = 0;
        for (let i = 0; i < numPixels * 4; i += 4) {
          sumR += src[i];
          sumG += src[i + 1];
          sumB += src[i + 2];
        }
        const meanR = sumR / numPixels;
        const meanG = sumG / numPixels;
        const meanB = sumB / numPixels;

        // Pass 1: Horizontal toroidal sliding-window average
        const R = kernelRadius;
        const winSize = 2 * R + 1;
        const hBlur = new Float32Array(numPixels * 3);

        for (let y = 0; y < size; y++) {
          const rowOff = y * size;
          let rAcc = 0, gAcc = 0, bAcc = 0;
          for (let dx = -R; dx <= R; dx++) {
            const wx = (dx + size) & (size - 1);
            const p = (rowOff + wx) * 4;
            rAcc += src[p];
            gAcc += src[p + 1];
            bAcc += src[p + 2];
          }
          for (let x = 0; x < size; x++) {
            const outIdx = (rowOff + x) * 3;
            hBlur[outIdx] = rAcc / winSize;
            hBlur[outIdx + 1] = gAcc / winSize;
            hBlur[outIdx + 2] = bAcc / winSize;

            const xSub = (x - R + size) & (size - 1);
            const xAdd = (x + R + 1) & (size - 1);
            const pSub = (rowOff + xSub) * 4;
            const pAdd = (rowOff + xAdd) * 4;
            rAcc += src[pAdd] - src[pSub];
            gAcc += src[pAdd + 1] - src[pSub + 1];
            bAcc += src[pAdd + 2] - src[pSub + 2];
          }
        }

        // Pass 2: Vertical toroidal sliding-window average + High-Pass Flat-Field reconstruction
        const eq = new Uint8ClampedArray(numPixels * 4);
        for (let x = 0; x < size; x++) {
          let rAcc = 0, gAcc = 0, bAcc = 0;
          for (let dy = -R; dy <= R; dy++) {
            const wy = (dy + size) & (size - 1);
            const p = (wy * size + x) * 3;
            rAcc += hBlur[p];
            gAcc += hBlur[p + 1];
            bAcc += hBlur[p + 2];
          }
          for (let y = 0; y < size; y++) {
            const pIdx = (y * size + x) * 4;
            const locR = rAcc / winSize;
            const locG = gAcc / winSize;
            const locB = bAcc / winSize;

            eq[pIdx] = Math.max(0, Math.min(255, Math.round(meanR + (src[pIdx] - locR) * detailGain)));
            eq[pIdx + 1] = Math.max(0, Math.min(255, Math.round(meanG + (src[pIdx + 1] - locG) * detailGain)));
            eq[pIdx + 2] = Math.max(0, Math.min(255, Math.round(meanB + (src[pIdx + 2] - locB) * detailGain)));
            eq[pIdx + 3] = 255;

            const ySub = (y - R + size) & (size - 1);
            const yAdd = (y + R + 1) & (size - 1);
            const pSub = (ySub * size + x) * 3;
            const pAdd = (yAdd * size + x) * 3;
            rAcc += hBlur[pAdd] - hBlur[pSub];
            gAcc += hBlur[pAdd + 1] - hBlur[pSub + 1];
            bAcc += hBlur[pAdd + 2] - hBlur[pSub + 2];
          }
        }

        // Pass 3: Tight 28-pixel toroidal border cross-fade so wrap boundaries are 100% seamless
        const border = 28;
        const half = size >> 1;
        for (let y = 0; y < size; y++) {
          const dy = Math.min(y, size - 1 - y);
          for (let x = 0; x < size; x++) {
            const dx = Math.min(x, size - 1 - x);
            const edgeDist = Math.min(dx, dy);
            const idx = (y * size + x) * 4;
            if (edgeDist < border) {
              const t = edgeDist / border;
              const w = 0.5 * (1.0 - Math.cos(t * Math.PI));
              const sx = (x + half) & (size - 1);
              const sy = (y + half) & (size - 1);
              const sIdx = (sy * size + sx) * 4;
              src[idx] = Math.round(eq[idx] * w + eq[sIdx] * (1.0 - w));
              src[idx + 1] = Math.round(eq[idx + 1] * w + eq[sIdx + 1] * (1.0 - w));
              src[idx + 2] = Math.round(eq[idx + 2] * w + eq[sIdx + 2] * (1.0 - w));
            } else {
              src[idx] = eq[idx];
              src[idx + 1] = eq[idx + 1];
              src[idx + 2] = eq[idx + 2];
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        dynTex.update(false);
      };
      return dynTex;
    };

    // 1. High-Res Seamless Bunker Sand Material (bunker_sand_01.jpg)
    const sandTex = createSeamlessPhotoTexture('/textures/bunker_sand_01.jpg', 'seamlessBunkerSandPhoto', 12, 0.62);

    this.matBunkerSandOverlay = new StandardMaterial('matBunkerSandPhoto', this.scene);
    this.matBunkerSandOverlay.diffuseTexture = sandTex;
    this.matBunkerSandOverlay.specularColor = new Color3(0.05, 0.05, 0.04);
    this.matBunkerSandOverlay.specularPower = 64;
    this.matBunkerSandOverlay.backFaceCulling = false;
    this.matBunkerSandOverlay.zOffset = -2;

    // 2. High-Res Seamless Inside Tee Box Turf Material (short_grass_01.jpg)
    const teeGrassTex = createSeamlessPhotoTexture('/textures/short_grass_01.jpg', 'seamlessTeeGrassPhoto', 10, 0.72);

    // 3. Smooth 3D Bunker Revetted Sod Wall & Overhanging Turf Lip Material
    this.matBunkerLipWall = new StandardMaterial('matBunkerLipWall', this.scene);
    this.matBunkerLipWall.diffuseTexture = teeGrassTex;
    this.matBunkerLipWall.specularColor = new Color3(0.04, 0.05, 0.03);
    this.matBunkerLipWall.specularPower = 48;
    this.matBunkerLipWall.backFaceCulling = false;
    this.matBunkerLipWall.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.matBunkerLipWall.zOffset = -3;

    this.matTeeBoxOverlay = new StandardMaterial('matTeeBoxPhoto', this.scene);
    this.matTeeBoxOverlay.diffuseTexture = teeGrassTex;
    this.matTeeBoxOverlay.specularColor = new Color3(0.05, 0.06, 0.04);
    this.matTeeBoxOverlay.specularPower = 64;
    this.matTeeBoxOverlay.backFaceCulling = false;
    this.matTeeBoxOverlay.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.matTeeBoxOverlay.zOffset = -2;
  }

  private ensurePatternTiles() {
    if (!TerrainGrid.patternTiles) {
      TerrainGrid.patternTiles = {
        rough: RealisticTextures.createSeamlessSurfacePattern('rough'),
        first_cut: RealisticTextures.createSeamlessSurfacePattern('first_cut'),
        fairway: RealisticTextures.createSeamlessSurfacePattern('fairway'),
        fringe: RealisticTextures.createSeamlessSurfacePattern('fringe'),
        green: RealisticTextures.createSeamlessSurfacePattern('green'),
        sand: RealisticTextures.createSeamlessSurfacePattern('sand'),
        water_bed: RealisticTextures.createSeamlessSurfacePattern('water_bed')
      };
    }
  }

  /**
   * Evaluates the kidney shape factor k(theta) for angle theta in [0, 2*PI).
   * Produces a classic curved kidney / bean bunker silhouette with a concave bay at theta = +PI/2.
   */
  public static kidneyRadiusFactor(theta: number): number {
    return 1.0 - 0.22 * Math.sin(theta) + 0.12 * Math.cos(2.0 * theta);
  }

  /**
   * Computes normalized kidney distance for a local point (localX, localZ) relative to (halfW, halfL).
   */
  public static computeKidneyDist(localX: number, localZ: number, halfW: number, halfL: number): { dist: number; theta: number } {
    const nx = localX / Math.max(1, halfW);
    const nz = localZ / Math.max(1, halfL);
    const rEll = Math.sqrt(nx * nx + nz * nz);
    const theta = Math.atan2(nz, nx);
    const k = TerrainGrid.kidneyRadiusFactor(theta);
    return { dist: rEll / Math.max(0.35, k), theta };
  }

  private initStaticIndexAndUVBuffers() {
    const cols = this.cols;
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const vIdx = z * cols + x;
        this.positions[vIdx * 3] = x;
        this.positions[vIdx * 3 + 2] = z;
        this.uvs[vIdx * 2] = x / this.width;
        this.uvs[vIdx * 2 + 1] = z / this.length;
      }
    }

    let iIdx = 0;
    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.width; x++) {
        const idx00 = z * cols + x;
        const idx10 = z * cols + (x + 1);
        const idx01 = (z + 1) * cols + x;
        const idx11 = (z + 1) * cols + (x + 1);

        this.indices[iIdx++] = idx00;
        this.indices[iIdx++] = idx01;
        this.indices[iIdx++] = idx10;

        this.indices[iIdx++] = idx10;
        this.indices[iIdx++] = idx01;
        this.indices[iIdx++] = idx11;
      }
    }
  }

  /**
   * Generates the natural topography for Hole 1 (Dogleg-Right Valley Hole):
   * - Elevated Tee Bluff around (X=95, Z=42) (~6.8m bluff + 1.3m tee pad = ~8.1m)
   * - Sweeping descent from the tee down into a small valley corridor (~2.0m-2.2m) bending right
   * - Green pocket at (X=148, Z=360) sitting slightly lower (~1.25m) than the approach fairway (~2.2m)
   */
  public generateInitialNaturalTerrain() {
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const idx = z * this.cols + x;

        let doglegCenterX = 95;
        if (z > 60 && z <= 210) {
          const t = (z - 60) / 150;
          doglegCenterX = 95 + t * t * 14;
        } else if (z > 210) {
          const t = Math.min(1.0, (z - 210) / 160);
          doglegCenterX = 109 + (3 * t * t - 2 * t * t * t) * 41;
        }

        const distFromCorridor = Math.abs(x - doglegCenterX);

        // 1. Elevated Tee Bluff around (95, 42)
        const dxTee = (x - 95) / 42;
        const dzTee = (z - 38) / 40;
        const teeBluff = 4.6 * Math.exp(-(dxTee * dxTee + dzTee * dzTee));

        // 2. Valley floor profile along Z
        const valleyDip = -0.65 * Math.exp(-Math.pow((z - 195) / 85, 2));

        // 3. Lower Putting Green pocket around (148, 360)
        const dxGreen = (x - 148) / 28;
        const dzGreen = (z - 360) / 30;
        const greenPocket = -0.95 * Math.exp(-(dxGreen * dxGreen + dzGreen * dzGreen));

        // 4. Gentle framing valley hills outside the playable dogleg corridor
        const corridorMargin = Math.max(0, distFromCorridor - 26);
        const valleyWalls =
          Math.pow(corridorMargin / 46, 1.8) * 3.8 +
          Math.sin(x * 0.04) * Math.cos(z * 0.03) * 0.35 * Math.min(1.0, corridorMargin / 20);

        const microRoll = Math.sin(x * 0.025 + 0.5) * Math.cos(z * 0.022) * 0.14;

        let h = 2.2 + teeBluff + valleyDip + greenPocket + valleyWalls + microRoll;

        const edgeDistX = Math.min(x, this.width - x);
        const edgeDistZ = Math.min(z, this.length - z);
        const edgeDist = Math.min(edgeDistX, edgeDistZ);
        if (edgeDist < 18) {
          const t = edgeDist / 18;
          const smoothT = t * t * (3 - 2 * t);
          h = 2.2 * (1 - smoothT) + h * smoothT;
        }

        this.heights[idx] = h;
        this.surfaceTypes[idx] = SurfaceType.ROUGH;
      }
    }
  }

  public getElevation(worldX: number, worldZ: number): number {
    const clampedX = Math.max(0, Math.min(this.width - 0.0001, worldX));
    const clampedZ = Math.max(0, Math.min(this.length - 0.0001, worldZ));

    const x0 = Math.floor(clampedX);
    const z0 = Math.floor(clampedZ);
    const x1 = Math.min(this.cols - 1, x0 + 1);
    const z1 = Math.min(this.rows - 1, z0 + 1);

    const fx = clampedX - x0;
    const fz = clampedZ - z0;

    const h00 = this.heights[z0 * this.cols + x0];
    const h10 = this.heights[z0 * this.cols + x1];
    const h01 = this.heights[z1 * this.cols + x0];
    const h11 = this.heights[z1 * this.cols + x1];

    if (fx + fz <= 1.0) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    } else {
      return h11 + (1.0 - fx) * (h01 - h11) + (1.0 - fz) * (h10 - h11);
    }
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

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
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
            this.heights[idx] = Math.max(-4.5, this.heights[idx] - strength * falloff);
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
      }
    }

    this.rebuildMesh();
  }

  /**
   * Evaluates a smooth 4-point cubic Bezier spine with organic AAA fairway width modulation
   * and smooth parabolic rounded ends (zero circular stamp cutouts).
   */
  private evaluateSpline(points: DoglegWaypoint[], t: number): {
    x: number;
    z: number;
    leftW: number;
    rightW: number;
    tx: number;
    tz: number;
  } {
    const p0 = points[0];
    const p1 = points[1];
    const p2 = points[2];
    const p3 = points[3];

    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;

    const x = b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x;
    const z = b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z;
    const baseWidth = b0 * p0.width + b1 * p1.width + b2 * p2.width + b3 * p3.width;

    // C1-continuous elliptical quadrant tapers at t=0 and t=1: sqrt(2u - u^2) has derivative 0 at u=1,
    // guaranteeing a 100% smooth rounded fairway nose with ZERO sharp corners!
    const uStart = Math.min(1.0, Math.max(0.0, t / 0.15));
    const uEnd = Math.min(1.0, Math.max(0.0, (1.0 - t) / 0.15));
    const startTaper = Math.sqrt(Math.max(0, 2.0 * uStart - uStart * uStart));
    const endTaper = Math.sqrt(Math.max(0, 2.0 * uEnd - uEnd * uEnd));
    const envelope = startTaper * endTaper;

    // Authentic AAA PGA-style organic fairway contour (drive landing swell, dogleg pinch, approach bay)
    const driveSwell = 0.16 * Math.exp(-Math.pow((t - 0.34) / 0.16, 2));
    const doglegPinchRight = -0.18 * Math.exp(-Math.pow((t - 0.46) / 0.11, 2));
    const outerElbowSwellLeft = 0.14 * Math.exp(-Math.pow((t - 0.58) / 0.15, 2));
    const waterPinchRight = -0.16 * Math.exp(-Math.pow((t - 0.76) / 0.12, 2));
    const approachLobe = 0.10 * Math.exp(-Math.pow((t - 0.84) / 0.10, 2));

    const leftMod = 1.0 + driveSwell + outerElbowSwellLeft + 0.04 * Math.sin(t * Math.PI * 3.0);
    const rightMod = 1.0 + driveSwell + doglegPinchRight + waterPinchRight + approachLobe;

    const leftW = baseWidth * 0.5 * envelope * leftMod;
    const rightW = baseWidth * 0.5 * envelope * rightMod;

    const d0 = -3 * u * u;
    const d1 = 3 * u * u - 6 * u * t;
    const d2 = 6 * u * t - 3 * t * t;
    const d3 = 3 * t * t;
    let tx = d0 * p0.x + d1 * p1.x + d2 * p2.x + d3 * p3.x;
    let tz = d0 * p0.z + d1 * p1.z + d2 * p2.z + d3 * p3.z;
    const len = Math.sqrt(tx * tx + tz * tz) || 1;
    tx /= len;
    tz /= len;

    return { x, z, leftW, rightW, tx, tz };
  }

  /**
   * Stamps a continuous, organic AAA Dogleg Fairway shape along a 4-point cubic Bezier spline.
   */
  public stampDoglegFairway(points: DoglegWaypoint[]) {
    if (points.length < 4) return;

    const samples = 200;
    const spine = [];
    for (let i = 0; i <= samples; i++) {
      spine.push(this.evaluateSpline(points, i / samples));
    }

    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        let minNormDist = 999;

        for (let i = 2; i < samples - 1; i++) {
          const sp = spine[i];
          const dx = x - sp.x;
          const dz = z - sp.z;
          // Project onto tangent (tx, tz) and left-normal (-tz, tx)
          const lat = dx * (-sp.tz) + dz * sp.tx;
          const lon = dx * sp.tx + dz * sp.tz;
          const halfW = Math.max(1.5, lat >= 0 ? sp.leftW : sp.rightW);
          const d = Math.sqrt((lat / halfW) * (lat / halfW) + (lon / (halfW * 1.2)) * (lon / (halfW * 1.2)));
          if (d < minNormDist) minNormDist = d;
        }

        const idx = z * this.cols + x;
        if (minNormDist <= 1.0) {
          if (this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
            this.surfaceTypes[idx] = SurfaceType.FAIRWAY;
          }
        } else if (minNormDist <= 1.18 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
          this.surfaceTypes[idx] = SurfaceType.FIRST_CUT;
        }
      }
    }

    this.stampedFeatures.push({
      centerX: points[1].x,
      centerZ: points[1].z,
      width: points[1].width,
      length: Math.abs(points[3].z - points[0].z),
      rotationRad: 0,
      surfaceType: SurfaceType.FAIRWAY,
      depthProfile: 0,
      lipHeight: 0,
      doglegPoints: points
    });

    this.redrawSplatTexture();
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
    // If stamping a Fairway preset, convert it into a sculpted 4-point AAA spline fairway
    if (surfaceType === SurfaceType.FAIRWAY) {
      const halfL = length * 0.5;
      const cosR = Math.cos(rotationRad);
      const sinR = Math.sin(rotationRad);
      const makePt = (zOff: number, xCurve: number, wScale: number): DoglegWaypoint => ({
        x: centerX + xCurve * cosR + zOff * sinR,
        z: centerZ - xCurve * sinR + zOff * cosR,
        width: width * wScale
      });
      this.stampDoglegFairway([
        makePt(-halfL, 0, 0.78),
        makePt(-halfL * 0.3, width * 0.12, 1.05),
        makePt(halfL * 0.35, width * 0.22, 0.96),
        makePt(halfL, width * 0.18, 0.82)
      ]);
      return;
    }

    const effWidth = surfaceType === SurfaceType.BUNKER ? Math.max(12, width) : width;
    const effLength = surfaceType === SurfaceType.BUNKER ? Math.max(16, length) : length;

    const halfW = effWidth * 0.5;
    const halfL = effLength * 0.5;
    const maxDim = Math.max(effWidth, effLength) * 1.1;

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

        const idx = z * this.cols + x;

        if (surfaceType === SurfaceType.BUNKER) {
          const { dist: kidneyDist } = TerrainGrid.computeKidneyDist(localX, localZ, halfW, halfL);

          if (kidneyDist <= 1.18) {
            const effDepth = Math.min(-1.25, depthProfile || -1.35);
            // Depress the 1m terrain grid across the entire sand cavity & inner wall (kidneyDist <= 0.98)
            // and blend back to natural ground under the raised lip mound (0.98..1.18) so the 1m grid never pokes through!
            if (kidneyDist <= 0.98) {
              const normR = kidneyDist / 0.98;
              const bowlProfile = Math.cos(normR * Math.PI * 0.30);
              this.heights[idx] = baseElevation + effDepth * bowlProfile;
              this.surfaceTypes[idx] = SurfaceType.BUNKER;
            } else {
              const t = (kidneyDist - 0.98) / 0.20;
              const smoothBlend = 0.5 * (1.0 - Math.cos(Math.min(1.0, t) * Math.PI));
              const edgeDepth = effDepth * Math.cos(Math.PI * 0.30);
              this.heights[idx] = (baseElevation + edgeDepth) * (1.0 - smoothBlend) + this.heights[idx] * smoothBlend;
            }
          }
          continue;
        }

        const normDist = Math.sqrt(Math.pow(localX / halfW, 2) + Math.pow(localZ / halfL, 2));
        if (normDist <= 1.35) {
          if (surfaceType === SurfaceType.GREEN) {
            if (normDist <= 1.0) {
              const blend = Math.cos(normDist * Math.PI * 0.5);
              const readableSlope = (localX / halfW) * 0.26 + (localZ / halfL) * 0.22;
              const targetGreenY = baseElevation + readableSlope;
              this.heights[idx] = this.heights[idx] * (1 - blend) + targetGreenY * blend;
              this.surfaceTypes[idx] = SurfaceType.GREEN;
            } else if (normDist <= 1.22 && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            }
          } else if (surfaceType === SurfaceType.FRINGE) {
            if (normDist <= 1.0 && this.surfaceTypes[idx] !== SurfaceType.BUNKER) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            }
          } else if (surfaceType === SurfaceType.FIRST_CUT) {
            if (normDist <= 1.0 && this.surfaceTypes[idx] !== SurfaceType.BUNKER) {
              this.surfaceTypes[idx] = SurfaceType.FIRST_CUT;
            }
          } else if (surfaceType === SurfaceType.TEE) {
            const liftHeight = Math.max(1.1, depthProfile || 1.2);
            if (normDist <= 0.92) {
              this.heights[idx] = baseElevation + liftHeight;
              this.surfaceTypes[idx] = SurfaceType.TEE;
            } else if (normDist <= 1.35) {
              const bankT = (normDist - 0.92) / 0.43;
              const smoothBank = 0.5 * (1 + Math.cos(bankT * Math.PI));
              this.heights[idx] = this.heights[idx] * (1 - smoothBank) + (baseElevation + liftHeight) * smoothBank;
              if (normDist <= 1.02) {
                this.surfaceTypes[idx] = SurfaceType.TEE;
              }
            }
          } else if (surfaceType === SurfaceType.WATER) {
            if (normDist <= 1.0) {
              const basin = Math.cos(normDist * Math.PI * 0.5);
              this.heights[idx] = Math.min(this.heights[idx], baseElevation + depthProfile * basin);
              this.surfaceTypes[idx] = SurfaceType.WATER;
            } else if (normDist <= 1.18) {
              const shoreT = (normDist - 1.0) / 0.18;
              this.heights[idx] = this.heights[idx] * shoreT + baseElevation * (1 - shoreT);
            }
          } else {
            if (normDist <= 1.0) {
              this.surfaceTypes[idx] = surfaceType;
            }
          }
        }
      }
    }

    this.stampedFeatures.push({
      centerX,
      centerZ,
      width: effWidth,
      length: effLength,
      rotationRad,
      surfaceType,
      depthProfile,
      lipHeight,
      isKidney: surfaceType === SurfaceType.BUNKER
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

    this.splatTexture = new DynamicTexture(
      'terrainSplatTexture',
      { width: 2048, height: 4096 },
      this.scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    this.splatTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.splatTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.splatTexture.anisotropicFilteringLevel = 16;

    const turfNormalTex = RealisticTextures.createSeamlessTurfNormalTexture(this.scene);
    turfNormalTex.uScale = 110;
    turfNormalTex.vScale = 230;
    turfNormalTex.level = 0.55;

    const microDetailTex = RealisticTextures.createSeamlessMicroDetailTexture(this.scene);
    microDetailTex.uScale = 110;
    microDetailTex.vScale = 230;

    const mat = new StandardMaterial('terrainMat', this.scene);
    mat.diffuseTexture = this.splatTexture;
    mat.ambientTexture = microDetailTex;
    mat.bumpTexture = turfNormalTex;
    mat.specularColor = new Color3(0.05, 0.06, 0.04);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    mesh.material = mat;

    this.redrawSplatTexture();
    this.rebuildMesh();

    return mesh;
  }

  public redrawSplatTexture() {
    if (!this.splatTexture) return;
    this.ensurePatternTiles();
    const tiles = TerrainGrid.patternTiles!;

    const ctx = this.splatTexture.getContext() as CanvasRenderingContext2D;
    const canvasW = 2048;
    const canvasH = 4096;

    const sX = canvasW / this.width;
    const sZ = canvasH / this.length;

    const makeScaledPattern = (source: HTMLCanvasElement, scale = 0.25): CanvasPattern => {
      const pat = ctx.createPattern(source, 'repeat')!;
      if (typeof DOMMatrix !== 'undefined' && pat.setTransform) {
        pat.setTransform(new DOMMatrix().scale(scale, scale));
      }
      return pat;
    };

    const roughPattern = makeScaledPattern(tiles.rough, 0.25);
    const firstCutPattern = makeScaledPattern(tiles.first_cut, 0.25);
    const fairwayPattern = makeScaledPattern(tiles.fairway, 0.25);
    const fringePattern = makeScaledPattern(tiles.fringe, 0.25);
    const greenPattern = makeScaledPattern(tiles.green, 0.25);
    const waterBedPattern = makeScaledPattern(tiles.water_bed, 0.25);
    const sandPattern = makeScaledPattern(tiles.sand, 0.20);
    const teeGrassPattern = makeScaledPattern(tiles.green, 0.20);

    ctx.fillStyle = roughPattern;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const layerPriority = (st: SurfaceType): number => {
      switch (st) {
        case SurfaceType.ROUGH: return 0;
        case SurfaceType.FIRST_CUT: return 1;
        case SurfaceType.FAIRWAY: return 2;
        case SurfaceType.FRINGE: return 3;
        case SurfaceType.GREEN: return 4;
        case SurfaceType.TEE: return 5;
        case SurfaceType.WATER: return 6;
        case SurfaceType.BUNKER: return 7;
        default: return 2;
      }
    };

    const sortedFeatures = [...this.stampedFeatures].sort(
      (a, b) => layerPriority(a.surfaceType) - layerPriority(b.surfaceType)
    );

    for (const feat of sortedFeatures) {
      this.drawFeatureOnCanvas(ctx, feat, sX, sZ, {
        firstCutPattern,
        fairwayPattern,
        fringePattern,
        greenPattern,
        sandPattern,
        teeGrassPattern,
        waterBedPattern
      });
    }

    this.splatTexture.update(false);
  }

  /**
   * Draws a continuous, organic AAA Dogleg Fairway shape on the course splat canvas.
   * Uses parabolic envelope tapering at both ends so the fairway is a single organic contour
   * (zero circular stamp additions or subtractions).
   */
  private drawDoglegFairwayOnCanvas(
    ctx: CanvasRenderingContext2D,
    points: DoglegWaypoint[],
    sX: number,
    sZ: number,
    firstCutPattern: CanvasPattern,
    fairwayPattern: CanvasPattern
  ) {
    const samples = 260;

    const traceOrganicFairwayOutline = () => {
      const leftPts: { x: number; z: number }[] = [];
      const rightPts: { x: number; z: number }[] = [];

      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const sp = this.evaluateSpline(points, t);

        const nx = -sp.tz;
        const nz = sp.tx;

        leftPts.push({ x: (sp.x + nx * sp.leftW) * sX, z: (sp.z + nz * sp.leftW) * sZ });
        rightPts.push({ x: (sp.x - nx * sp.rightW) * sX, z: (sp.z - nz * sp.rightW) * sZ });
      }

      ctx.beginPath();
      ctx.moveTo(leftPts[0].x, leftPts[0].z);
      for (let i = 1; i <= samples; i++) {
        ctx.lineTo(leftPts[i].x, leftPts[i].z);
      }
      for (let i = samples; i >= 0; i--) {
        ctx.lineTo(rightPts[i].x, rightPts[i].z);
      }
      ctx.closePath();
    };

    // 1. Continuous First Cut Collar (+3.8m uniform parallel offset around the entire organic fairway contour)
    ctx.save();
    traceOrganicFairwayOutline();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.8 * 2 * sX;
    ctx.strokeStyle = firstCutPattern;
    ctx.stroke();
    ctx.fillStyle = firstCutPattern;
    ctx.fill();
    ctx.restore();

    // 2. Continuous AAA Dogleg Fairway Body
    traceOrganicFairwayOutline();
    ctx.fillStyle = fairwayPattern;
    ctx.fill();

    // 3. Championship Mowing Stripes clipped cleanly inside the organic fairway contour
    ctx.save();
    traceOrganicFairwayOutline();
    ctx.clip();

    const stripeStep = 4.6 * sZ;
    for (let z = 45 * sZ; z <= 370 * sZ; z += stripeStep * 2) {
      ctx.fillStyle = 'rgba(225, 255, 180, 0.08)';
      ctx.fillRect(0, z, 220 * sX, stripeStep);
      ctx.fillStyle = 'rgba(10, 35, 8, 0.06)';
      ctx.fillRect(0, z + stripeStep, 220 * sX, stripeStep);
    }
    ctx.restore();
  }

  private drawFeatureOnCanvas(
    ctx: CanvasRenderingContext2D,
    feat: StampedFeatureRecord,
    sX: number,
    sZ: number,
    patterns: {
      firstCutPattern: CanvasPattern;
      fairwayPattern: CanvasPattern;
      fringePattern: CanvasPattern;
      greenPattern: CanvasPattern;
      sandPattern: CanvasPattern;
      teeGrassPattern: CanvasPattern;
      waterBedPattern: CanvasPattern;
    }
  ) {
    if (feat.doglegPoints && feat.doglegPoints.length >= 4) {
      this.drawDoglegFairwayOnCanvas(
        ctx,
        feat.doglegPoints,
        sX,
        sZ,
        patterns.firstCutPattern,
        patterns.fairwayPattern
      );
      return;
    }

    const cx = feat.centerX * sX;
    const cz = feat.centerZ * sZ;
    const halfW = (feat.width * 0.5) * sX;
    const halfL = (feat.length * 0.5) * sZ;

    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(feat.rotationRad);

    if (feat.surfaceType === SurfaceType.FIRST_CUT) {
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.FRINGE) {
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.GREEN) {
      const fringeW = halfW + 2.6 * sX;
      const fringeL = halfL + 2.6 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, fringeW, fringeL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

      ctx.strokeStyle = 'rgba(18, 52, 16, 0.30)';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.greenPattern;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.clip();

      const greenStripe = 1.8 * sZ;
      const gCount = Math.ceil((halfL * 2) / greenStripe);
      for (let i = -gCount; i <= gCount; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(215, 255, 195, 0.06)' : 'rgba(10, 45, 18, 0.045)';
        ctx.fillRect(-halfW * 1.4, i * greenStripe, halfW * 2.8, greenStripe);
      }
      ctx.restore();

    } else if (feat.surfaceType === SurfaceType.BUNKER) {
      // Only fill the interior sand cavity on splatTexture; the 128-segment polar 3D meshes render the smooth lip & sand
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const theta = (i / 96) * Math.PI * 2;
        const r = 0.90 * TerrainGrid.kidneyRadiusFactor(theta);
        const px = Math.cos(theta) * halfW * r;
        const pz = Math.sin(theta) * halfL * r;
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.closePath();
      ctx.fillStyle = patterns.sandPattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.TEE) {
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.24, halfL * 1.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.06, halfL * 1.06, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.teeGrassPattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.WATER) {
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.12, halfL * 1.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#384634';
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.04, halfL * 1.04, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.waterBedPattern;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Builds ultra-smooth, curve-aligned Polar 3D Meshes for:
   * 1. Kidney Bunkers:
   *    - 96-segment Polar Sand Bed Mesh (bunker_sand_01.jpg tiled every 1.15m x 1.15m)
   *    - 96-segment Polar 3D Revetted Sod Wall & Overhanging Turf Lip Mesh (zero 1m grid jaggedness!)
   * 2. Elevated Tee Boxes:
   *    - 64-segment Smooth Polar Tee Turf Mesh (short_grass_01.jpg tiled every 0.45m x 0.45m for fine short grass!)
   */
  private rebuildHighResSurfaceOverlays() {
    if (this.bunkerSandOverlayMesh) {
      this.bunkerSandOverlayMesh.dispose();
      this.bunkerSandOverlayMesh = null;
    }
    if (this.bunkerLipWallMesh) {
      this.bunkerLipWallMesh.dispose();
      this.bunkerLipWallMesh = null;
    }
    if (this.teeBoxOverlayMesh) {
      this.teeBoxOverlayMesh.dispose();
      this.teeBoxOverlayMesh = null;
    }

    const sandPositions: number[] = [];
    const sandNormals: number[] = [];
    const sandUVs: number[] = [];
    const sandIndices: number[] = [];
    let sandVCount = 0;

    const wallPositions: number[] = [];
    const wallNormals: number[] = [];
    const wallUVs: number[] = [];
    const wallColors: number[] = [];
    const wallIndices: number[] = [];
    let wallVCount = 0;

    const teePositions: number[] = [];
    const teeNormals: number[] = [];
    const teeUVs: number[] = [];
    const teeColors: number[] = [];
    const teeIndices: number[] = [];
    let teeVCount = 0;

    for (const feat of this.stampedFeatures) {
      if (feat.surfaceType === SurfaceType.BUNKER) {
        const halfW = feat.width * 0.5;
        const halfL = feat.length * 0.5;
        const cosR = Math.cos(feat.rotationRad);
        const sinR = Math.sin(feat.rotationRad);
        const effDepth = Math.min(-1.25, feat.depthProfile || -1.35);
        const baseLip = Math.max(0.58, feat.lipHeight || 0.70);

        const angSegs = 128;
        const sandRings = 12;
        const maxSandRho = 0.91;

        // Precompute rim reference elevation around the perimeter at rho = 1.26 (undisturbed natural ground)
        const rimElevations = new Float32Array(angSegs + 1);
        for (let a = 0; a <= angSegs; a++) {
          const theta = (a / angSegs) * Math.PI * 2;
          const k = TerrainGrid.kidneyRadiusFactor(theta);
          const lx1 = Math.cos(theta) * halfW * k * 1.26;
          const lz1 = Math.sin(theta) * halfL * k * 1.26;
          rimElevations[a] = this.getElevation(
            feat.centerX + lx1 * cosR - lz1 * sinR,
            feat.centerZ + lx1 * sinR + lz1 * cosR
          );
        }

        // Smooth rim elevations angularly so the bunker lip is a 100% smooth 3D ribbon
        const smoothRim = new Float32Array(angSegs + 1);
        const smoothOuter = new Float32Array(angSegs + 1);
        for (let a = 0; a <= angSegs; a++) {
          let sumRim = 0;
          for (let da = -8; da <= 8; da++) {
            const idx = (a + da + angSegs) % angSegs;
            sumRim += rimElevations[idx];
          }
          smoothRim[a] = sumRim / 17;
          smoothOuter[a] = smoothRim[a];
        }

        // A. 128-Segment Smooth Polar Kidney Sand Bed Mesh
        const sandStartV = sandVCount;
        for (let rIdx = 0; rIdx <= sandRings; rIdx++) {
          const rho = (rIdx / sandRings) * maxSandRho;
          const normR = rho / maxSandRho;
          const bowlFactor = Math.cos(normR * Math.PI * 0.34);

          for (let a = 0; a <= angSegs; a++) {
            const theta = (a / angSegs) * Math.PI * 2;
            const k = TerrainGrid.kidneyRadiusFactor(theta);
            const lx = Math.cos(theta) * halfW * k * rho;
            const lz = Math.sin(theta) * halfL * k * rho;

            const wx = feat.centerX + lx * cosR - lz * sinR;
            const wz = feat.centerZ + lx * sinR + lz * cosR;
            const wy = smoothRim[a] + effDepth * bowlFactor + 0.03;

            sandPositions.push(wx, wy, wz);
            const tilt = Math.sin(normR * Math.PI * 0.34) * 0.25;
            const nxLocal = -Math.cos(theta) * tilt;
            const nzLocal = -Math.sin(theta) * tilt;
            const nx = nxLocal * cosR - nzLocal * sinR;
            const nz = nxLocal * sinR + nzLocal * cosR;
            const ny = Math.sqrt(Math.max(0.5, 1.0 - nx * nx - nz * nz));
            sandNormals.push(nx, ny, nz);

            // Tile flat-field-equalized bunker_sand_01.jpg every 1.8m x 1.8m for fine, natural quartz sand
            sandUVs.push(wx / 1.8, wz / 1.8);
            sandVCount++;
          }
        }

        const stride = angSegs + 1;
        for (let rIdx = 0; rIdx < sandRings; rIdx++) {
          for (let a = 0; a < angSegs; a++) {
            const i00 = sandStartV + rIdx * stride + a;
            const i10 = i00 + 1;
            const i01 = i00 + stride;
            const i11 = i01 + 1;
            sandIndices.push(i00, i01, i10, i10, i01, i11);
          }
        }

        // B. 128-Segment Smooth Polar 3D Revetted Sod Wall & Overhanging Turf Lip Mesh
        const wallRings = 18;
        const minWallRho = 0.82;
        const maxWallRho = 1.28;
        const wallStartV = wallVCount;

        for (let rIdx = 0; rIdx <= wallRings; rIdx++) {
          const u = rIdx / wallRings;
          const rho = minWallRho + u * (maxWallRho - minWallRho);

          for (let a = 0; a <= angSegs; a++) {
            const theta = (a / angSegs) * Math.PI * 2;
            const k = TerrainGrid.kidneyRadiusFactor(theta);
            const lx = Math.cos(theta) * halfW * k * rho;
            const lz = Math.sin(theta) * halfL * k * rho;

            const wx = feat.centerX + lx * cosR - lz * sinR;
            const wz = feat.centerZ + lx * sinR + lz * cosR;

            const rimY = smoothRim[a];
            const outerGroundY = Math.max(smoothOuter[a], this.getElevation(wx, wz));
            const sandEdgeY = rimY + effDepth * Math.cos(Math.PI * 0.34) + 0.03;
            const dirBoost = 0.82 + 0.25 * Math.sin(theta);
            const lipCrestY = rimY + baseLip * dirBoost;

            let wy: number;
            let rC: number, gC: number, bC: number, alphaC: number;
            let nxLocal = 0, nzLocal = 0, ny = 1.0;

            if (rho <= 1.00) {
              const t = Math.max(0, Math.min(1, (rho - minWallRho) / (1.00 - minWallRho)));
              const sCurve = t * t * (3.0 - 2.0 * t);
              wy = (sandEdgeY - 0.03) * (1.0 - sCurve) + lipCrestY * sCurve;

              const wallSteepness = Math.sin(t * Math.PI) * 0.72;
              nxLocal = -Math.cos(theta) * wallSteepness;
              nzLocal = -Math.sin(theta) * wallSteepness;
              ny = Math.sqrt(Math.max(0.25, 1.0 - wallSteepness * wallSteepness));

              if (t < 0.25) {
                rC = 0.38; gC = 0.30; bC = 0.20;
              } else if (t < 0.82) {
                const sodBands = 0.90 + 0.10 * Math.sin(t * Math.PI * 10.0);
                rC = 0.46 * sodBands;
                gC = 0.36 * sodBands;
                bC = 0.23 * sodBands;
              } else {
                const gt = (t - 0.82) / 0.18;
                rC = 0.46 * (1 - gt) + 0.44 * gt;
                gC = 0.36 * (1 - gt) + 0.72 * gt;
                bC = 0.23 * (1 - gt) + 0.32 * gt;
              }
              // Smoothly feather inner sand-to-wall transition over first 20% of wall so sand rim is 100% smooth
              alphaC = t < 0.22 ? (t / 0.22) : 1.0;
            } else {
              // Rounded outer grassy bunker lip mound sloping smoothly into surrounding turf
              const t = Math.max(0, Math.min(1, (rho - 1.00) / (maxWallRho - 1.00)));
              const mound = 0.5 * (1.0 + Math.cos(t * Math.PI));
              wy = (outerGroundY + 0.008) * (1.0 - mound) + lipCrestY * mound;

              const outSlope = Math.sin(t * Math.PI) * 0.35;
              nxLocal = Math.cos(theta) * outSlope;
              nzLocal = Math.sin(theta) * outSlope;
              ny = Math.sqrt(Math.max(0.5, 1.0 - outSlope * outSlope));

              rC = 0.44 * (1 - t) + 0.54 * t;
              gC = 0.72 * (1 - t) + 0.82 * t;
              bC = 0.32 * (1 - t) + 0.40 * t;
              alphaC = t < 0.28 ? 1.0 : Math.max(0, 1.0 - (t - 0.28) / 0.72);
            }

            const nx = nxLocal * cosR - nzLocal * sinR;
            const nz = nxLocal * sinR + nzLocal * cosR;

            wallPositions.push(wx, wy, wz);
            wallNormals.push(nx, ny, nz);
            wallUVs.push(wx / 1.1, wz / 1.1);
            wallColors.push(rC, gC, bC, alphaC);
            wallVCount++;
          }
        }

        for (let rIdx = 0; rIdx < wallRings; rIdx++) {
          for (let a = 0; a < angSegs; a++) {
            const i00 = wallStartV + rIdx * stride + a;
            const i10 = i00 + 1;
            const i01 = i00 + stride;
            const i11 = i01 + 1;
            wallIndices.push(i00, i01, i10, i10, i01, i11);
          }
        }

      } else if (feat.surfaceType === SurfaceType.TEE) {
        // C. 96-Segment Smooth Polar Tee Box Turf Mesh (short_grass_01.jpg tiled every 0.95m x 0.95m)
        const halfW = feat.width * 0.5;
        const halfL = feat.length * 0.5;
        const cosR = Math.cos(feat.rotationRad);
        const sinR = Math.sin(feat.rotationRad);

        const angSegs = 96;
        const teeRings = 14;
        const maxTeeRho = 1.32;
        const teeStartV = teeVCount;
        const centerY = this.getElevation(feat.centerX, feat.centerZ);

        // Precompute angularly smoothed outer base elevation at rho = 1.35
        const rawOuterTee = new Float32Array(angSegs + 1);
        for (let a = 0; a <= angSegs; a++) {
          const theta = (a / angSegs) * Math.PI * 2;
          const lx = Math.cos(theta) * halfW * 1.35;
          const lz = Math.sin(theta) * halfL * 1.35;
          rawOuterTee[a] = this.getElevation(
            feat.centerX + lx * cosR - lz * sinR,
            feat.centerZ + lx * sinR + lz * cosR
          );
        }
        const smoothOuterTee = new Float32Array(angSegs + 1);
        for (let a = 0; a <= angSegs; a++) {
          let sum = 0;
          for (let da = -6; da <= 6; da++) {
            sum += rawOuterTee[(a + da + angSegs) % angSegs];
          }
          smoothOuterTee[a] = sum / 13;
        }

        for (let rIdx = 0; rIdx <= teeRings; rIdx++) {
          const rho = (rIdx / teeRings) * maxTeeRho;
          const alpha = rho <= 1.05 ? 1.0 : Math.max(0, 1.0 - (rho - 1.05) / (maxTeeRho - 1.05));

          for (let a = 0; a <= angSegs; a++) {
            const theta = (a / angSegs) * Math.PI * 2;
            const lx = Math.cos(theta) * halfW * rho;
            const lz = Math.sin(theta) * halfL * rho;

            const wx = feat.centerX + lx * cosR - lz * sinR;
            const wz = feat.centerZ + lx * sinR + lz * cosR;
            const gridY = this.getElevation(wx, wz);

            let analyticalY = centerY;
            if (rho > 0.92) {
              const bankT = Math.min(1.0, (rho - 0.92) / (maxTeeRho - 0.92));
              const smoothBank = 0.5 * (1.0 + Math.cos(bankT * Math.PI));
              analyticalY = smoothOuterTee[a] * (1.0 - smoothBank) + centerY * smoothBank;
            }
            const wy = Math.max(gridY + 0.008, analyticalY + 0.012);

            teePositions.push(wx, wy, wz);
            teeNormals.push(0, 1, 0);
            // Tile flat-field-equalized short_grass_01.jpg every 0.95m x 0.95m for fine short grass with zero blockiness
            teeUVs.push(wx / 0.95, wz / 0.95);
            teeColors.push(0.95, 1.0, 0.93, alpha);
            teeVCount++;
          }
        }

        const stride = angSegs + 1;
        for (let rIdx = 0; rIdx < teeRings; rIdx++) {
          for (let a = 0; a < angSegs; a++) {
            const i00 = teeStartV + rIdx * stride + a;
            const i10 = i00 + 1;
            const i01 = i00 + stride;
            const i11 = i01 + 1;
            teeIndices.push(i00, i01, i10, i10, i01, i11);
          }
        }
      }
    }

    if (sandIndices.length > 0) {
      this.bunkerSandOverlayMesh = new Mesh('BunkerSandPhotoOverlay', this.scene);
      this.bunkerSandOverlayMesh.isPickable = false;
      this.bunkerSandOverlayMesh.receiveShadows = true;
      const vd = new VertexData();
      vd.positions = new Float32Array(sandPositions);
      vd.normals = new Float32Array(sandNormals);
      vd.uvs = new Float32Array(sandUVs);
      vd.indices = new Uint32Array(sandIndices);
      vd.applyToMesh(this.bunkerSandOverlayMesh, false);
      this.bunkerSandOverlayMesh.material = this.matBunkerSandOverlay;
    }

    if (wallIndices.length > 0) {
      this.bunkerLipWallMesh = new Mesh('BunkerLipWallOverlay', this.scene);
      this.bunkerLipWallMesh.isPickable = false;
      this.bunkerLipWallMesh.receiveShadows = true;
      this.bunkerLipWallMesh.hasVertexAlpha = true;
      const vd = new VertexData();
      vd.positions = new Float32Array(wallPositions);
      vd.normals = new Float32Array(wallNormals);
      vd.uvs = new Float32Array(wallUVs);
      vd.colors = new Float32Array(wallColors);
      vd.indices = new Uint32Array(wallIndices);
      vd.applyToMesh(this.bunkerLipWallMesh, false);
      this.bunkerLipWallMesh.material = this.matBunkerLipWall;
    }

    if (teeIndices.length > 0) {
      this.teeBoxOverlayMesh = new Mesh('TeeBoxPhotoOverlay', this.scene);
      this.teeBoxOverlayMesh.isPickable = false;
      this.teeBoxOverlayMesh.receiveShadows = true;
      this.teeBoxOverlayMesh.hasVertexAlpha = true;
      const vd = new VertexData();
      vd.positions = new Float32Array(teePositions);
      vd.normals = new Float32Array(teeNormals);
      vd.uvs = new Float32Array(teeUVs);
      vd.colors = new Float32Array(teeColors);
      vd.indices = new Uint32Array(teeIndices);
      vd.applyToMesh(this.teeBoxOverlayMesh, false);
      this.teeBoxOverlayMesh.material = this.matTeeBoxOverlay;
    }
  }

  public rebuildMesh() {
    if (!this.terrainMesh) return;

    const cols = this.cols;
    const rows = this.rows;

    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const vIdx = z * cols + x;
        const pIdx = vIdx * 3;
        const cIdx = vIdx * 4;

        const hC = this.heights[vIdx];
        this.positions[pIdx + 1] = hC;

        const hL = x > 0 ? this.heights[vIdx - 1] : hC;
        const hR = x < cols - 1 ? this.heights[vIdx + 1] : hC;
        const hD = z > 0 ? this.heights[vIdx - cols] : hC;
        const hU = z < rows - 1 ? this.heights[vIdx + cols] : hC;

        let nx = (hL - hR) * 0.5;
        let ny = 1.0;
        let nz = (hD - hU) * 0.5;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
        nx /= len;
        ny /= len;
        nz /= len;

        this.normals[pIdx] = nx;
        this.normals[pIdx + 1] = ny;
        this.normals[pIdx + 2] = nz;

        const laplacian = ((hL + hR + hD + hU) * 0.25) - hC;
        const cavityAO = Math.max(0.82, Math.min(1.04, 1.0 - laplacian * 0.18));
        this.colors[cIdx] = cavityAO;
        this.colors[cIdx + 1] = cavityAO;
        this.colors[cIdx + 2] = cavityAO;
        this.colors[cIdx + 3] = 1.0;
      }
    }

    const vertexData = new VertexData();
    vertexData.positions = this.positions;
    vertexData.normals = this.normals;
    vertexData.uvs = this.uvs;
    vertexData.colors = this.colors;
    vertexData.indices = this.indices;
    vertexData.applyToMesh(this.terrainMesh, true);

    this.rebuildHighResSurfaceOverlays();
  }
}
