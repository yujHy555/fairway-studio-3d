import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
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
  baseElevation?: number;
  isKidney?: boolean;
  bunkerShapeIndex?: number;
  doglegPoints?: DoglegWaypoint[];
}

export class TerrainGrid {
  public readonly width: number;
  public readonly length: number;
  public readonly cols: number; // width + 1
  public readonly rows: number; // length + 1

  public baseHeights: Float32Array;
  public heights: Float32Array;
  public surfaceTypes: Uint8Array;
  public subdividedCells: Uint8Array;

  public terrainMesh: Mesh | null = null;
  public splatTexture: DynamicTexture | null = null;
  public stampedFeatures: StampedFeatureRecord[] = [];
  private scene: Scene;

  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;
  private colors: Float32Array;
  private indices: Uint32Array;

  private static patternTiles: Record<string, HTMLCanvasElement> | null = null;
  private teePhotoTile: HTMLCanvasElement | null = null;
  private sandPhotoTile: HTMLCanvasElement | null = null;
  private highResGrassDetailTex: DynamicTexture | null = null;

  constructor(scene: Scene, width = GOLF_CONSTANTS.DEFAULT_MAP_WIDTH, length = GOLF_CONSTANTS.DEFAULT_MAP_LENGTH) {
    this.scene = scene;
    this.width = Math.floor(width);
    this.length = Math.floor(length);
    this.cols = this.width + 1;
    this.rows = this.length + 1;

    const totalVerts = this.cols * this.rows;
    this.baseHeights = new Float32Array(totalVerts);
    this.heights = new Float32Array(totalVerts);
    this.surfaceTypes = new Uint8Array(totalVerts);
    this.subdividedCells = new Uint8Array(this.width * this.length);

    this.positions = new Float32Array(totalVerts * 3);
    this.normals = new Float32Array(totalVerts * 3);
    this.uvs = new Float32Array(totalVerts * 2);
    this.colors = new Float32Array(totalVerts * 4);
    this.indices = new Uint32Array(this.width * this.length * 6);

    this.ensurePatternTiles();
    this.initHighResPhotoPatterns();
    this.generateInitialNaturalTerrain();
  }

  /**
   * Loads /textures/short_grass_01.jpg and /textures/bunker_sand_01.jpg directly into the
   * course terrain material (splatTexture + highResGrassDetailTex) with ZERO draped overlay meshes.
   * Uses a wide-radius (R=48) flat-field equalizer so macro brightness blocks are removed while
   * 100% of the natural grass blades and sand grains remain crisp and clearly visible.
   */
  private initHighResPhotoPatterns() {
    const buildEqualizedPhotoCanvas = (
      img: HTMLImageElement,
      size: number,
      kernelRadius: number,
      detailGain: number
    ): { canvas: HTMLCanvasElement; imgData: ImageData } => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, size, size);

      const imgData = ctx.getImageData(0, 0, size, size);
      const src = imgData.data;
      const numPixels = size * size;

      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < numPixels * 4; i += 4) {
        sumR += src[i];
        sumG += src[i + 1];
        sumB += src[i + 2];
      }
      const meanR = sumR / numPixels;
      const meanG = sumG / numPixels;
      const meanB = sumB / numPixels;

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

      const border = 36;
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
      return { canvas, imgData };
    };

    // 1. Load short_grass_01.jpg for the Tee Box inside material & close-up grass blade detail
    const grassImg = new Image();
    grassImg.src = '/textures/short_grass_01.jpg';
    grassImg.onload = () => {
      // Smooth color base for the course-wide splatTexture (prevents low-res 20cm splat blotches)
      const { canvas } = buildEqualizedPhotoCanvas(grassImg, 512, 8, 0.32);
      this.teePhotoTile = canvas;

      // Populate the 1024x1024 high-res grass blade detail texture on GolfTerrain's material
      // Kernel radius 14 removes macro blotches while preserving crisp short_grass_01.jpg grass blades at full clarity
      if (this.highResGrassDetailTex) {
        const dSize = 1024;
        const { imgData: hiData } = buildEqualizedPhotoCanvas(grassImg, dSize, 14, 1.80);
        const dCtx = this.highResGrassDetailTex.getContext() as CanvasRenderingContext2D;
        const outImg = dCtx.createImageData(dSize, dSize);
        const hPx = hiData.data;
        const oPx = outImg.data;
        const nPx = dSize * dSize;

        let gSum = 0;
        for (let i = 0; i < nPx * 4; i += 4) {
          gSum += hPx[i] * 0.25 + hPx[i + 1] * 0.65 + hPx[i + 2] * 0.10;
        }
        const gMean = gSum / nPx;

        for (let i = 0; i < nPx * 4; i += 4) {
          const lum = hPx[i] * 0.25 + hPx[i + 1] * 0.65 + hPx[i + 2] * 0.10;
          const val = Math.max(155, Math.min(255, Math.round(224 + (lum - gMean) * 1.95)));
          oPx[i] = val;
          oPx[i + 1] = Math.min(255, Math.round(val * 1.02));
          oPx[i + 2] = Math.round(val * 0.97);
          oPx[i + 3] = 255;
        }
        dCtx.putImageData(outImg, 0, 0);
        this.highResGrassDetailTex.update(false);
      }

      this.redrawSplatTexture();
    };

    // 2. Load bunker_sand_01.jpg for the Bunker Sand material
    const sandImg = new Image();
    sandImg.src = '/textures/bunker_sand_01.jpg';
    sandImg.onload = () => {
      const { canvas } = buildEqualizedPhotoCanvas(sandImg, 512, 18, 1.20);
      this.sandPhotoTile = canvas;
      this.redrawSplatTexture();
    };
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
   * Produces varied, organic PGA Tour 2K-style bunker silhouettes matching real championship course architecture:
   * 0: Coastal Links Multi-Lobe Hazard with deep finger indentations and organic bays
   * 1: Tri-lobed greenside bunker with deep finger bays wrapping around green collars (user favorite)
   * 2: Scalloped multi-bay fairway pinch bunker with asymmetric fingers and flared tongue
   * 3: Organic amoeba hazard with undulating bays and natural inlets
   * 4: Quad-lobed clover apron hazard with deep scalloped bays
   */
  public static getBunkerRadiusFactor(theta: number, shapeIndex: number = 0): number {
    const s = ((shapeIndex % 5) + 5) % 5;
    switch (s) {
      case 1:
        // Tri-lobed greenside bunker (distinctive organic lobes hugging green contours)
        return 0.96 - 0.20 * Math.sin(theta) + 0.22 * Math.cos(3.0 * theta) - 0.10 * Math.sin(2.0 * theta) + 0.08 * Math.cos(4.0 * theta);
      case 2:
        // Scalloped multi-bay fairway bunker with asymmetric fingers
        return 0.98 - 0.20 * Math.cos(theta) + 0.22 * Math.sin(3.0 * theta) + 0.12 * Math.cos(4.0 * theta) - 0.09 * Math.sin(2.0 * theta);
      case 3:
        // Organic amoeba hazard with undulating bays and natural inlets
        return 0.96 + 0.20 * Math.sin(3.0 * theta) * (0.85 + 0.25 * Math.cos(theta)) + 0.16 * Math.cos(4.0 * theta) - 0.10 * Math.sin(5.0 * theta);
      case 4:
        // Quad-lobed clover apron hazard with deep scalloped bays
        return 0.95 - 0.14 * Math.cos(theta) + 0.18 * Math.sin(2.0 * theta) + 0.15 * Math.cos(4.0 * theta) - 0.08 * Math.sin(3.0 * theta) + 0.06 * Math.cos(5.0 * theta);
      case 0:
      default:
        // Coastal links multi-lobe hazard with deep finger bays (no kidney/heart shape!)
        return 0.96 + 0.22 * Math.cos(3.0 * theta) - 0.14 * Math.sin(2.0 * theta) + 0.11 * Math.cos(5.0 * theta) - 0.08 * Math.sin(4.0 * theta);
    }
  }

  public static kidneyRadiusFactor(theta: number): number {
    return TerrainGrid.getBunkerRadiusFactor(theta, 0);
  }

  /**
   * Computes normalized bunker distance for a local point (localX, localZ) relative to (halfW, halfL)
   * supporting varied organic shape harmonics.
   */
  public static computeKidneyDist(
    localX: number,
    localZ: number,
    halfW: number,
    halfL: number,
    shapeIndex: number = 0
  ): { dist: number; theta: number } {
    const nx = localX / Math.max(1, halfW);
    const nz = localZ / Math.max(1, halfL);
    const rEll = Math.sqrt(nx * nx + nz * nz);
    const theta = Math.atan2(nz, nx);
    const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIndex);
    return { dist: rEll / Math.max(0.35, k), theta };
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

        this.baseHeights[idx] = h;
        this.heights[idx] = h;
        this.surfaceTypes[idx] = SurfaceType.ROUGH;
      }
    }
  }

  /**
   * Bilinear interpolation of the underlying base terrain height (excluding analytical Tee/Bunker features).
   */
  public getBaseElevation(worldX: number, worldZ: number): number {
    const clampedX = Math.max(0, Math.min(this.width - 0.0001, worldX));
    const clampedZ = Math.max(0, Math.min(this.length - 0.0001, worldZ));

    const x0 = Math.floor(clampedX);
    const z0 = Math.floor(clampedZ);
    const x1 = Math.min(this.cols - 1, x0 + 1);
    const z1 = Math.min(this.rows - 1, z0 + 1);

    const fx = clampedX - x0;
    const fz = clampedZ - z0;

    const h00 = this.baseHeights[z0 * this.cols + x0];
    const h10 = this.baseHeights[z0 * this.cols + x1];
    const h01 = this.baseHeights[z1 * this.cols + x0];
    const h11 = this.baseHeights[z1 * this.cols + x1];

    return (
      (1.0 - fx) * (1.0 - fz) * h00 +
      fx * (1.0 - fz) * h10 +
      (1.0 - fx) * fz * h01 +
      fx * fz * h11
    );
  }

  /**
   * Evaluates the continuous analytical elevation at (worldX, worldZ) including smooth
   * 3D Kidney Bunker bowls/lips and Elevated Tee Box plateaus/banks.
   */
  public evaluateAnalyticalElevation(worldX: number, worldZ: number): number {
    let h = this.getBaseElevation(worldX, worldZ);

    for (const feat of this.stampedFeatures) {
      if (feat.surfaceType === SurfaceType.TEE) {
        const halfW = feat.width * 0.5;
        const halfL = feat.length * 0.5;
        const dx = worldX - feat.centerX;
        const dz = worldZ - feat.centerZ;
        if (Math.abs(dx) > feat.width && Math.abs(dz) > feat.length) continue;

        const cosR = Math.cos(-feat.rotationRad);
        const sinR = Math.sin(-feat.rotationRad);
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;
        const normDist = Math.sqrt((localX / halfW) * (localX / halfW) + (localZ / halfL) * (localZ / halfL));

        if (normDist < 1.38) {
          const liftHeight = Math.max(1.1, feat.depthProfile || 1.25);
          const topY = (feat.baseElevation ?? h) + liftHeight;
          if (normDist <= 0.88) {
            h = topY;
          } else {
            const t = (normDist - 0.88) / 0.50;
            const smoothBank = 0.5 * (1.0 + Math.cos(t * Math.PI));
            h = h * (1.0 - smoothBank) + topY * smoothBank;
          }
        }
      } else if (feat.surfaceType === SurfaceType.BUNKER) {
        const halfW = feat.width * 0.5;
        const halfL = feat.length * 0.5;
        const dx = worldX - feat.centerX;
        const dz = worldZ - feat.centerZ;
        const maxR = Math.max(halfW, halfL) * 2.2;
        if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) continue;

        const cosR = Math.cos(-feat.rotationRad);
        const sinR = Math.sin(-feat.rotationRad);
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;
        const shapeIdx = feat.bunkerShapeIndex ?? (Math.floor(feat.centerX * 0.35 + feat.centerZ * 0.65) % 5);

        // Exact metric radius and organic contour harmonic
        const theta = Math.atan2(localZ / Math.max(1, halfL), localX / Math.max(1, halfW));
        const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIdx);
        const baseRad = Math.hypot(halfW * Math.cos(theta), halfL * Math.sin(theta)) * k;
        const rMeters = Math.hypot(localX, localZ);

        // Constant uniform physical metric dimensions across all angles:
        // Sand bed radius: 84% of base contour
        const rSand = baseRad * 0.84;
        // Refined, narrower revetted sod lip (0.80m uniform width)
        const lipWidth = 0.80;
        const rLipRim = rSand + lipWidth;
        const rCollar = rLipRim + 0.85;

        if (rMeters < rCollar) {
          const effDepth = Math.max(-0.95, Math.min(-0.65, feat.depthProfile || -0.80));
          const centerBaseY = feat.baseElevation ?? h;
          // Unified rim height: consistent revetted sod rim rise above local terrain and base
          const rimY = Math.max(centerBaseY - 0.20, h) + 0.12;
          const sandFloorY = centerBaseY + effDepth;
          const sandEdgeY = sandFloorY + 0.32;

          if (rMeters <= rSand) {
            // Gentle concave sand basin
            const normR = rMeters / Math.max(0.5, rSand);
            const bowl = Math.cos(normR * Math.PI * 0.22);
            h = sandFloorY + (sandEdgeY - sandFloorY) * (1.0 - bowl);
          } else if (rMeters <= rLipRim) {
            // Constant 0.80m wide revetted sod lip with consistent elevation rise across all slopes
            const tLip = (rMeters - rSand) / lipWidth;
            const sCurve = 0.5 * (1.0 - Math.cos(tLip * Math.PI));
            h = sandEdgeY * (1.0 - sCurve) + rimY * sCurve;
          } else {
            // Smooth collar blend into surrounding terrain
            const tCollar = (rMeters - rLipRim) / 0.85;
            const blend = 0.5 * (1.0 - Math.cos(tCollar * Math.PI));
            h = rimY * (1.0 - blend) + h * blend;
          }
        }
      } else if (feat.surfaceType === SurfaceType.WATER) {
        const halfW = feat.width * 0.5;
        const halfL = feat.length * 0.5;
        const dx = worldX - feat.centerX;
        const dz = worldZ - feat.centerZ;
        const maxR = Math.max(halfW, halfL) * 1.6;
        if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) continue;

        const cosR = Math.cos(-feat.rotationRad);
        const sinR = Math.sin(-feat.rotationRad);
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;
        const normDist = Math.sqrt((localX / halfW) * (localX / halfW) + (localZ / halfL) * (localZ / halfL));

        if (normDist < 1.32) {
          const rimY = (feat.baseElevation ?? h) + 0.06;
          const waterSurfaceY = (feat.baseElevation ?? h) - 0.20;
          const effDepth = Math.min(-1.6, feat.depthProfile || -2.2);

          if (normDist <= 0.95) {
            const normR = normDist / 0.95;
            const basin = Math.cos(normR * Math.PI * 0.5);
            h = waterSurfaceY + effDepth * basin;
          } else if (normDist <= 1.03) {
            const t = (normDist - 0.95) / 0.08;
            const sCurve = 0.5 * (1.0 - Math.cos(t * Math.PI));
            h = waterSurfaceY * (1.0 - sCurve) + rimY * sCurve;
          } else {
            const t = (normDist - 1.03) / 0.29;
            const bankBlend = 0.5 * (1.0 + Math.cos(t * Math.PI));
            h = h * (1.0 - bankBlend) + rimY * bankBlend;
          }
        }
      }
    }

    return h;
  }

  /**
   * Computes vertex height for a 0.25m subdivided cell (cx, cz) at sub-indices (iu, iv) in [0..4],
   * snapping outer boundary edges to exact linear interpolation whenever the neighbor cell is un-subdivided
   * so the entire single-mesh terrain is 100% watertight with zero T-junction holes.
   */
  private getSubCellVertexHeight(cx: number, cz: number, iu: number, iv: number): number {
    const u = iu * 0.25;
    const v = iv * 0.25;
    const wx = cx + u;
    const wz = cz + v;

    if (iu === 0 && (cx === 0 || this.subdividedCells[cz * this.width + (cx - 1)] === 0)) {
      return (1.0 - v) * this.heights[cz * this.cols + cx] + v * this.heights[(cz + 1) * this.cols + cx];
    }
    if (iu === 4 && (cx === this.width - 1 || this.subdividedCells[cz * this.width + (cx + 1)] === 0)) {
      return (1.0 - v) * this.heights[cz * this.cols + (cx + 1)] + v * this.heights[(cz + 1) * this.cols + (cx + 1)];
    }
    if (iv === 0 && (cz === 0 || this.subdividedCells[(cz - 1) * this.width + cx] === 0)) {
      return (1.0 - u) * this.heights[cz * this.cols + cx] + u * this.heights[cz * this.cols + (cx + 1)];
    }
    if (iv === 4 && (cz === this.length - 1 || this.subdividedCells[(cz + 1) * this.width + cx] === 0)) {
      return (1.0 - u) * this.heights[(cz + 1) * this.cols + cx] + u * this.heights[(cz + 1) * this.cols + (cx + 1)];
    }

    return this.evaluateAnalyticalElevation(wx, wz);
  }

  /**
   * Returns the exact mathematical Y coordinate of the rendered GolfTerrain triangle at (worldX, worldZ),
   * matching both regular 1m triangles and 0.25m subdivided Tee Box / Bunker triangles 1:1.
   */
  public getElevation(worldX: number, worldZ: number): number {
    const clampedX = Math.max(0, Math.min(this.width - 0.0001, worldX));
    const clampedZ = Math.max(0, Math.min(this.length - 0.0001, worldZ));

    const cx = Math.floor(clampedX);
    const cz = Math.floor(clampedZ);

    if (this.subdividedCells[cz * this.width + cx] === 1) {
      const subX = (clampedX - cx) * 4.0;
      const subZ = (clampedZ - cz) * 4.0;
      const iu = Math.min(3, Math.floor(subX));
      const iv = Math.min(3, Math.floor(subZ));
      const fx = subX - iu;
      const fz = subZ - iv;

      const h00 = this.getSubCellVertexHeight(cx, cz, iu, iv);
      const h10 = this.getSubCellVertexHeight(cx, cz, iu + 1, iv);
      const h01 = this.getSubCellVertexHeight(cx, cz, iu, iv + 1);
      const h11 = this.getSubCellVertexHeight(cx, cz, iu + 1, iv + 1);

      if (Math.abs(h00 - h11) < Math.abs(h10 - h01)) {
        // Diagonal (0,0)-(1,1)
        if (fx >= fz) {
          return h00 + fx * (h10 - h00) + fz * (h11 - h10);
        } else {
          return h00 + fx * (h11 - h01) + fz * (h01 - h00);
        }
      } else {
        // Diagonal (1,0)-(0,1)
        if (fx + fz <= 1.0) {
          return h00 + fx * (h10 - h00) + fz * (h01 - h00);
        } else {
          return h11 + (1.0 - fx) * (h01 - h11) + (1.0 - fz) * (h10 - h11);
        }
      }
    }

    const x0 = cx;
    const z0 = cz;
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
    const eps = 0.22;
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

    const flattenHeight = targetFlattenHeight ?? this.getBaseElevation(centerX, centerZ);

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
            this.baseHeights[idx] += strength * falloff;
            break;
          case 'lower':
            this.baseHeights[idx] = Math.max(-4.5, this.baseHeights[idx] - strength * falloff);
            break;
          case 'flatten':
            this.baseHeights[idx] = this.baseHeights[idx] * (1 - falloff * strength) + flattenHeight * (falloff * strength);
            break;
          case 'smooth': {
            const nL = x > 0 ? this.baseHeights[idx - 1] : this.baseHeights[idx];
            const nR = x < this.cols - 1 ? this.baseHeights[idx + 1] : this.baseHeights[idx];
            const nD = z > 0 ? this.baseHeights[idx - this.cols] : this.baseHeights[idx];
            const nU = z < this.rows - 1 ? this.baseHeights[idx + this.cols] : this.baseHeights[idx];
            const avg = (nL + nR + nD + nU) * 0.25;
            this.baseHeights[idx] = this.baseHeights[idx] * (1 - falloff * strength) + avg * (falloff * strength);
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
    lipHeight: number = 0,
    baseElevation?: number,
    bunkerShapeIndex?: number
  ) {
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
    const effBunkerShape = bunkerShapeIndex !== undefined
      ? bunkerShapeIndex
      : (Math.floor(centerX * 0.35 + centerZ * 0.65) % 5);

    const halfW = effWidth * 0.5;
    const halfL = effLength * 0.5;
    const maxDim = Math.max(effWidth, effLength) * 1.1;

    const minX = Math.max(0, Math.floor(centerX - maxDim));
    const maxX = Math.min(this.cols - 1, Math.ceil(centerX + maxDim));
    const minZ = Math.max(0, Math.floor(centerZ - maxDim));
    const maxZ = Math.min(this.rows - 1, Math.ceil(centerZ + maxDim));

    const cosR = Math.cos(-rotationRad);
    const sinR = Math.sin(-rotationRad);

    const effBaseElevation = baseElevation ?? this.getBaseElevation(centerX, centerZ);

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dz = z - centerZ;

        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;

        const idx = z * this.cols + x;

        if (surfaceType === SurfaceType.BUNKER) {
          const theta = Math.atan2(localZ / Math.max(1, halfL), localX / Math.max(1, halfW));
          const k = TerrainGrid.getBunkerRadiusFactor(theta, effBunkerShape);
          const baseRad = Math.hypot(halfW * Math.cos(theta), halfL * Math.sin(theta)) * k;
          const rMeters = Math.hypot(localX, localZ);
          const rSand = baseRad * 0.84;
          const lipWidth = 1.25;

          if (rMeters <= rSand) {
            this.surfaceTypes[idx] = SurfaceType.BUNKER;
          } else if (rMeters <= rSand + lipWidth && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
            this.surfaceTypes[idx] = SurfaceType.FRINGE;
          }
          continue;
        }

        const normDist = Math.sqrt(Math.pow(localX / halfW, 2) + Math.pow(localZ / halfL, 2));
        // Approximate perpendicular distance in meters from the (halfW, halfL) boundary
        const ang = Math.atan2(localZ / halfL, localX / halfW);
        const radAtAng = Math.sqrt(Math.pow(halfW * Math.cos(ang), 2) + Math.pow(halfL * Math.sin(ang), 2));
        const distFromEdgeMeters = (normDist - 1.0) * radAtAng;

        if (distFromEdgeMeters <= 4.8) {
          if (surfaceType === SurfaceType.GREEN) {
            if (normDist <= 1.0) {
              const blend = Math.cos(normDist * Math.PI * 0.5);
              const readableSlope = (localX / halfW) * 0.26 + (localZ / halfL) * 0.22;
              const targetGreenY = effBaseElevation + readableSlope;
              this.baseHeights[idx] = this.baseHeights[idx] * (1 - blend) + targetGreenY * blend;
              this.surfaceTypes[idx] = SurfaceType.GREEN;
            } else if (distFromEdgeMeters <= 2.2 && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER && this.surfaceTypes[idx] !== SurfaceType.FAIRWAY) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            } else if (distFromEdgeMeters <= 4.2 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
              this.surfaceTypes[idx] = SurfaceType.FIRST_CUT;
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
            const teeEdgeMeters = (normDist - 0.90) * radAtAng;
            if (normDist <= 0.90) {
              this.surfaceTypes[idx] = SurfaceType.TEE;
            } else if (teeEdgeMeters <= 0.48 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            } else if (teeEdgeMeters <= 0.98 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
              this.surfaceTypes[idx] = SurfaceType.FIRST_CUT;
            }
          } else if (surfaceType === SurfaceType.WATER) {
            const waterEdgeMeters = (normDist - 0.95) * radAtAng;
            if (normDist <= 0.95) {
              this.surfaceTypes[idx] = SurfaceType.WATER;
            } else if (waterEdgeMeters <= 2.20 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
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
      baseElevation: effBaseElevation,
      isKidney: surfaceType === SurfaceType.BUNKER,
      bunkerShapeIndex: surfaceType === SurfaceType.BUNKER ? effBunkerShape : undefined
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
      { width: 4096, height: 4096 },
      this.scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    this.splatTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.splatTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.splatTexture.anisotropicFilteringLevel = 16;

    // Initialize high-res grass blade detail texture (populated from short_grass_01.jpg)
    this.highResGrassDetailTex = new DynamicTexture(
      'highResGrassDetailTex',
      1024,
      this.scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    this.highResGrassDetailTex.wrapU = Texture.WRAP_ADDRESSMODE;
    this.highResGrassDetailTex.wrapV = Texture.WRAP_ADDRESSMODE;
    this.highResGrassDetailTex.anisotropicFilteringLevel = 16;
    // Tile every ~2.9m x 2.9m across the 220m x 460m course so close-up grass blades on the tee box are clearly visible and fine
    this.highResGrassDetailTex.uScale = 75;
    this.highResGrassDetailTex.vScale = 156;

    // Fill initial neutral white until short_grass_01.jpg finishes loading
    const dCtx = this.highResGrassDetailTex.getContext() as CanvasRenderingContext2D;
    dCtx.fillStyle = '#f2f5f0';
    dCtx.fillRect(0, 0, 1024, 1024);
    this.highResGrassDetailTex.update(false);

    const turfNormalTex = RealisticTextures.createSeamlessTurfNormalTexture(this.scene);
    turfNormalTex.uScale = 220;
    turfNormalTex.vScale = 460;
    turfNormalTex.level = 0.22;

    const mat = new StandardMaterial('terrainMat', this.scene);
    mat.diffuseTexture = this.splatTexture;
    mat.ambientTexture = this.highResGrassDetailTex;
    mat.bumpTexture = turfNormalTex;
    mat.specularColor = new Color3(0.05, 0.06, 0.04);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    mesh.material = mat;

    // Trigger reload of photo patterns into the newly created textures
    this.initHighResPhotoPatterns();
    this.redrawSplatTexture();
    this.rebuildMesh();

    return mesh;
  }

  public redrawSplatTexture() {
    if (!this.splatTexture) return;
    this.ensurePatternTiles();
    const tiles = TerrainGrid.patternTiles!;

    const ctx = this.splatTexture.getContext() as CanvasRenderingContext2D;
    const canvasW = 4096;
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

    // Use the equalized 2048x2048 bunker_sand_01.jpg and short_grass_01.jpg photo patterns directly on the terrain material
    const sandPattern = this.sandPhotoTile
      ? makeScaledPattern(this.sandPhotoTile, 0.32)
      : makeScaledPattern(tiles.sand, 0.20);
    const teeGrassPattern = this.teePhotoTile
      ? makeScaledPattern(this.teePhotoTile, 0.30)
      : makeScaledPattern(tiles.green, 0.20);

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
   * Computes a closed polygon offset outward by a constant `offsetMeters` along the true unit outward normal
   * at every vertex in meter space. Guarantees 100% uniform ring width all the way around any shape
   * (Ellipse, Kidney Bunker, Dogleg Fairway, Tee Box, or Water Hazard) without ever getting wider or thinner!
   */
  private computeUniformOffsetPolygon(
    closedPts: { x: number; z: number }[],
    offsetMeters: number
  ): { x: number; z: number }[] {
    const n = closedPts.length;
    if (n < 3 || Math.abs(offsetMeters) < 1e-5) return closedPts;

    // Determine signed area to ensure outward normal always points away from interior
    let signedArea2 = 0;
    for (let i = 0; i < n; i++) {
      const p0 = closedPts[i];
      const p1 = closedPts[(i + 1) % n];
      signedArea2 += p0.x * p1.z - p1.x * p0.z;
    }
    const orient = signedArea2 >= 0 ? 1.0 : -1.0;

    const result: { x: number; z: number }[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = closedPts[(i - 1 + n) % n];
      const curr = closedPts[i];
      const next = closedPts[(i + 1) % n];

      let dx1 = curr.x - prev.x;
      let dz1 = curr.z - prev.z;
      const len1 = Math.hypot(dx1, dz1) || 1;
      dx1 /= len1;
      dz1 /= len1;

      let dx2 = next.x - curr.x;
      let dz2 = next.z - curr.z;
      const len2 = Math.hypot(dx2, dz2) || 1;
      dx2 /= len2;
      dz2 /= len2;

      const n1x = orient * dz1;
      const n1z = -orient * dx1;
      const n2x = orient * dz2;
      const n2z = -orient * dx2;

      let nx = n1x + n2x;
      let nz = n1z + n2z;
      const nLen = Math.hypot(nx, nz);
      if (nLen > 1e-5) {
        nx /= nLen;
        nz /= nLen;
      } else {
        nx = n1x;
        nz = n1z;
      }

      result[i] = {
        x: curr.x + nx * offsetMeters,
        z: curr.z + nz * offsetMeters
      };
    }

    return result;
  }

  /**
   * Traces a closed polygon specified in local feature meters `(lx, lz)` onto the splat canvas
   * by transforming into true world meters `(wx, wz)` first and then scaling by `(sX, sZ)`.
   * Eliminates all non-square canvas rotation skew so textures align 1:1 with 3D geometry!
   */
  private traceLocalMeterPolygon(
    ctx: CanvasRenderingContext2D,
    localPts: { x: number; z: number }[],
    centerX: number,
    centerZ: number,
    rotationRad: number,
    sX: number,
    sZ: number
  ) {
    const cosR = Math.cos(rotationRad);
    const sinR = Math.sin(rotationRad);
    ctx.beginPath();
    for (let i = 0; i < localPts.length; i++) {
      const lx = localPts[i].x;
      const lz = localPts[i].z;
      const wx = centerX + lx * cosR - lz * sinR;
      const wz = centerZ + lx * sinR + lz * cosR;
      const px = wx * sX;
      const pz = wz * sZ;
      if (i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.closePath();
  }

  private generateEllipseMeterPoints(halfW: number, halfL: number, segs = 160): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < segs; i++) {
      const theta = (i / segs) * Math.PI * 2;
      pts.push({
        x: Math.cos(theta) * halfW,
        z: Math.sin(theta) * halfL
      });
    }
    return pts;
  }

  private generateKidneyMeterPoints(
    halfW: number,
    halfL: number,
    scale = 0.88,
    shapeIndex = 0,
    segs = 192
  ): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < segs; i++) {
      const theta = (i / segs) * Math.PI * 2;
      const r = scale * TerrainGrid.getBunkerRadiusFactor(theta, shapeIndex);
      pts.push({
        x: Math.cos(theta) * halfW * r,
        z: Math.sin(theta) * halfL * r
      });
    }
    return pts;
  }

  /**
   * Draws a continuous, organic AAA Dogleg Fairway shape on the course splat canvas
   * with a 100% uniform-width First-Cut / Fringe collar around the entire perimeter.
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
    const leftPtsMeters: { x: number; z: number }[] = [];
    const rightPtsMeters: { x: number; z: number }[] = [];

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const sp = this.evaluateSpline(points, t);

      const nx = -sp.tz;
      const nz = sp.tx;

      leftPtsMeters.push({ x: sp.x + nx * sp.leftW, z: sp.z + nz * sp.leftW });
      rightPtsMeters.push({ x: sp.x - nx * sp.rightW, z: sp.z - nz * sp.rightW });
    }

    const fairwayLoopMeters: { x: number; z: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      fairwayLoopMeters.push(leftPtsMeters[i]);
    }

    // Smooth 180-deg elliptical rounded end-cap at the green end (t = 1) — eliminates sharp geometric corners
    const spEnd = this.evaluateSpline(points, 1.0);
    const nEndX = -spEnd.tz;
    const nEndZ = spEnd.tx;
    const midEndX = spEnd.x + nEndX * (spEnd.leftW - spEnd.rightW) * 0.5;
    const midEndZ = spEnd.z + nEndZ * (spEnd.leftW - spEnd.rightW) * 0.5;
    const rEnd = (spEnd.leftW + spEnd.rightW) * 0.5;
    const dEnd = rEnd * 0.68;
    const capSegs = 36;
    for (let k = 1; k < capSegs; k++) {
      const phi = (k / capSegs) * Math.PI;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      fairwayLoopMeters.push({
        x: midEndX + nEndX * (cosP * rEnd) + spEnd.tx * (sinP * dEnd),
        z: midEndZ + nEndZ * (cosP * rEnd) + spEnd.tz * (sinP * dEnd)
      });
    }

    for (let i = samples; i >= 0; i--) {
      fairwayLoopMeters.push(rightPtsMeters[i]);
    }

    // Smooth 180-deg elliptical rounded end-cap at the tee end (t = 0) — eliminates sharp geometric corners
    const spStart = this.evaluateSpline(points, 0.0);
    const nStartX = -spStart.tz;
    const nStartZ = spStart.tx;
    const midStartX = spStart.x + nStartX * (spStart.leftW - spStart.rightW) * 0.5;
    const midStartZ = spStart.z + nStartZ * (spStart.leftW - spStart.rightW) * 0.5;
    const rStart = (spStart.leftW + spStart.rightW) * 0.5;
    const dStart = rStart * 0.68;
    for (let k = 1; k < capSegs; k++) {
      const phi = (k / capSegs) * Math.PI;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      fairwayLoopMeters.push({
        x: midStartX - nStartX * (cosP * rStart) - spStart.tx * (sinP * dStart),
        z: midStartZ - nStartZ * (cosP * rStart) - spStart.tz * (sinP * dStart)
      });
    }

    // 1. Continuous Uniform +3.2m First-Cut Ring surrounding the ENTIRE fairway loop
    // (Strictly constant uniform width everywhere with ZERO pinching at joins or ends!)
    const fairwayFringeRing = this.computeUniformOffsetPolygon(fairwayLoopMeters, 3.2);
    this.traceLocalMeterPolygon(ctx, fairwayFringeRing, 0, 0, 0, sX, sZ);
    ctx.fillStyle = firstCutPattern;
    ctx.fill();

    // 2. Continuous AAA Dogleg Fairway Body
    this.traceLocalMeterPolygon(ctx, fairwayLoopMeters, 0, 0, 0, sX, sZ);
    ctx.fillStyle = fairwayPattern;
    ctx.fill();

    // 3. Championship Mowing Stripes clipped cleanly inside the organic fairway contour
    ctx.save();
    this.traceLocalMeterPolygon(ctx, fairwayLoopMeters, 0, 0, 0, sX, sZ);
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

    const halfW = feat.width * 0.5;
    const halfL = feat.length * 0.5;

    if (feat.surfaceType === SurfaceType.FIRST_CUT) {
      const pts = this.generateEllipseMeterPoints(halfW, halfL, 128);
      this.traceLocalMeterPolygon(ctx, pts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.FRINGE) {
      const pts = this.generateEllipseMeterPoints(halfW, halfL, 128);
      this.traceLocalMeterPolygon(ctx, pts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.GREEN) {
      const baseGreenPts = this.generateEllipseMeterPoints(halfW, halfL, 160);
      const fringeRingPts = this.computeUniformOffsetPolygon(baseGreenPts, 2.2);
      const firstCutRingPts = this.computeUniformOffsetPolygon(baseGreenPts, 4.4);

      // 1. Uniform First-Cut outer ring (+4.4m) around the entire green perimeter
      this.traceLocalMeterPolygon(ctx, firstCutRingPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      // 2. Continuous 360-degree Uniform Fringe ring (+2.2m) around the entire green perimeter (no gaps)
      this.traceLocalMeterPolygon(ctx, fringeRingPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();
      ctx.strokeStyle = 'rgba(18, 52, 16, 0.28)';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // 3. Championship Green Putting Surface
      this.traceLocalMeterPolygon(ctx, baseGreenPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.greenPattern;
      ctx.fill();

      ctx.save();
      this.traceLocalMeterPolygon(ctx, baseGreenPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.clip();

      const greenStripe = 1.8 * sZ;
      const gCount = Math.ceil((halfL * 2) / (1.8));
      const minZ = (feat.centerZ - halfL * 1.4) * sZ;
      const minX = (feat.centerX - halfW * 1.4) * sX;
      const spanX = halfW * 2.8 * sX;
      for (let i = 0; i <= gCount * 2; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(215, 255, 195, 0.06)' : 'rgba(10, 45, 18, 0.045)';
        ctx.fillRect(minX, minZ + i * greenStripe, spanX, greenStripe);
      }
      ctx.restore();

    } else if (feat.surfaceType === SurfaceType.BUNKER) {
      // PGA Tour 2K25 organic bunker style: varied multi-lobed silhouettes, narrower 0.80m lip & silky smooth texture blending
      const shapeIdx = feat.bunkerShapeIndex ?? (Math.floor(feat.centerX * 0.35 + feat.centerZ * 0.65) % 5);
      const baseSandPts = this.generateKidneyMeterPoints(halfW, halfL, 0.84, shapeIdx, 192);
      const subtleCollarPts = this.computeUniformOffsetPolygon(baseSandPts, 0.80);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // 1. Smooth manicured turf collar around the bunker edge (+0.80m)
      this.traceLocalMeterPolygon(ctx, subtleCollarPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

      // 2. Pure sand bed filled seamlessly with equalized bunker_sand_01.jpg
      this.traceLocalMeterPolygon(ctx, baseSandPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.sandPattern;
      ctx.fill();

      // 3. Super smooth sand-to-grass blend transition (zero jagged edges, zero fake dark rectangular artifacts)
      // Real soft 3D lip shadows are cast dynamically by CascadedShadowGenerator
      ctx.save();
      this.traceLocalMeterPolygon(ctx, subtleCollarPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.clip();
      this.traceLocalMeterPolygon(ctx, baseSandPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.strokeStyle = patterns.sandPattern;
      ctx.lineWidth = 1.2 * sX;
      ctx.stroke();
      ctx.restore();

    } else if (feat.surfaceType === SurfaceType.TEE) {
      // Base inside Tee Box plateau (0.90x) in local meters with narrower fringe & first-cut rings
      const baseTeePts = this.generateEllipseMeterPoints(halfW * 0.90, halfL * 0.90, 144);
      const teeFringePts = this.computeUniformOffsetPolygon(baseTeePts, 0.48);
      const teeFirstCutPts = this.computeUniformOffsetPolygon(baseTeePts, 0.98);

      // 1. Uniform Outer First-Cut ring (+1.40m uniform width outside the fringe)
      this.traceLocalMeterPolygon(ctx, teeFirstCutPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      // 2. Uniform Manicured Fringe ring (+1.35m uniform width around the tee box perimeter)
      this.traceLocalMeterPolygon(ctx, teeFringePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();
      ctx.strokeStyle = 'rgba(18, 52, 16, 0.28)';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // 3. Inside Tee Box surface with short_grass_01.jpg texture
      this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.teeGrassPattern;
      ctx.fill();

      // Subtle championship tee-box mowing stripes clipped inside the tee plateau
      ctx.save();
      this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.clip();
      const teeStripe = 1.6 * sX;
      const minX = (feat.centerX - halfW * 1.2) * sX;
      const minZ = (feat.centerZ - halfL * 1.2) * sZ;
      const spanZ = halfL * 2.4 * sZ;
      const tCount = Math.ceil((halfW * 2.4) / 1.6);
      for (let i = 0; i <= tCount; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(220, 255, 195, 0.055)' : 'rgba(12, 42, 14, 0.045)';
        ctx.fillRect(minX + i * teeStripe, minZ, teeStripe, spanZ);
      }
      ctx.restore();

      this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.strokeStyle = 'rgba(25, 68, 22, 0.32)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

    } else if (feat.surfaceType === SurfaceType.WATER) {
      // Base water edge at 0.95 matches the 3D water mesh & analytical shoreline 1:1
      const baseWaterPts = this.generateEllipseMeterPoints(halfW * 0.95, halfL * 0.95, 160);
      const waterFringePts = this.computeUniformOffsetPolygon(baseWaterPts, 2.15);
      const shoreBankPts = this.computeUniformOffsetPolygon(baseWaterPts, 0.72);
      const deepBedPts = this.computeUniformOffsetPolygon(baseWaterPts, -1.65);

      // 1. Uniform +2.15m Water Fringe collar around the pond bank
      this.traceLocalMeterPolygon(ctx, waterFringePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

      // 2. Uniform +0.72m natural moist stone/pebble shoreline bank ring
      this.traceLocalMeterPolygon(ctx, shoreBankPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = '#4e5444';
      ctx.fill();

      // 3. Shallow sandy/pebble water shelf right inside the water's edge
      this.traceLocalMeterPolygon(ctx, baseWaterPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = '#2d5a58';
      ctx.fill();

      // 4. Deep aquatic pond bed in the interior
      this.traceLocalMeterPolygon(ctx, deepBedPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      ctx.fillStyle = patterns.waterBedPattern;
      ctx.fill();
    }
  }

  /**
   * Rebuilds the single watertight GolfTerrain mesh, subdividing cells inside Bunker and Tee Box
   * regions to 0.25m (4x4 micro-quads) with exact boundary stitching into neighboring 1m cells.
   * Zero floating/draped overlay meshes — eliminating all mesh holes and ball submersion!
   */
  public rebuildMesh() {
    if (!this.terrainMesh) return;

    const cols = this.cols;
    const rows = this.rows;

    // 1. Update integer grid heights from continuous analytical elevation
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        this.heights[z * cols + x] = this.evaluateAnalyticalElevation(x, z);
      }
    }

    // 2. Mark cells within Bunker and Tee Box regions for 0.25m (4x4) high-resolution subdivision
    this.subdividedCells.fill(0);
    let subCellCount = 0;

    for (let cz = 0; cz < this.length; cz++) {
      const midZ = cz + 0.5;
      for (let cx = 0; cx < this.width; cx++) {
        const midX = cx + 0.5;
        let isSub = false;

        for (const feat of this.stampedFeatures) {
          if (feat.surfaceType === SurfaceType.BUNKER) {
            const halfW = feat.width * 0.5;
            const halfL = feat.length * 0.5;
            const dx = midX - feat.centerX;
            const dz = midZ - feat.centerZ;
            const maxR = Math.max(halfW, halfL) * 2.2;
            if (Math.abs(dx) <= maxR && Math.abs(dz) <= maxR) {
              const cosR = Math.cos(-feat.rotationRad);
              const sinR = Math.sin(-feat.rotationRad);
              const lx = dx * cosR - dz * sinR;
              const lz = dx * sinR + dz * cosR;
              const { dist } = TerrainGrid.computeKidneyDist(lx, lz, halfW, halfL);
              if (dist <= 1.55) {
                isSub = true;
                break;
              }
            }
          } else if (feat.surfaceType === SurfaceType.TEE || feat.surfaceType === SurfaceType.WATER) {
            const halfW = feat.width * 0.5;
            const halfL = feat.length * 0.5;
            const dx = midX - feat.centerX;
            const dz = midZ - feat.centerZ;
            const maxR = Math.max(halfW, halfL) * 1.6;
            if (Math.abs(dx) <= maxR && Math.abs(dz) <= maxR) {
              const cosR = Math.cos(-feat.rotationRad);
              const sinR = Math.sin(-feat.rotationRad);
              const lx = dx * cosR - dz * sinR;
              const lz = dx * sinR + dz * cosR;
              const normDist = Math.sqrt((lx / halfW) * (lx / halfW) + (lz / halfL) * (lz / halfL));
              if (normDist <= 1.48) {
                isSub = true;
                break;
              }
            }
          }
        }

        if (isSub) {
          this.subdividedCells[cz * this.width + cx] = 1;
          subCellCount++;
        }
      }
    }

    const baseVerts = cols * rows;
    const totalVerts = baseVerts + subCellCount * 25;
    const regularCellCount = this.width * this.length - subCellCount;
    const totalIndices = regularCellCount * 6 + subCellCount * 16 * 6;

    this.positions = new Float32Array(totalVerts * 3);
    this.normals = new Float32Array(totalVerts * 3);
    this.uvs = new Float32Array(totalVerts * 2);
    this.colors = new Float32Array(totalVerts * 4);
    this.indices = new Uint32Array(totalIndices);

    // 3. Populate base integer grid vertices [0 .. baseVerts - 1]
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const vIdx = z * cols + x;
        const pIdx = vIdx * 3;
        const uIdx = vIdx * 2;
        const cIdx = vIdx * 4;

        const hC = this.heights[vIdx];
        this.positions[pIdx] = x;
        this.positions[pIdx + 1] = hC;
        this.positions[pIdx + 2] = z;

        this.uvs[uIdx] = x / this.width;
        this.uvs[uIdx + 1] = z / this.length;

        const hL = x > 0 ? this.heights[vIdx - 1] : hC;
        const hR = x < cols - 1 ? this.heights[vIdx + 1] : hC;
        const hD = z > 0 ? this.heights[vIdx - cols] : hC;
        const hU = z < rows - 1 ? this.heights[vIdx + cols] : hC;

        let nx = (hL - hR) * 0.5;
        let ny = 1.0;
        let nz = (hD - hU) * 0.5;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;

        this.normals[pIdx] = nx / len;
        this.normals[pIdx + 1] = ny / len;
        this.normals[pIdx + 2] = nz / len;

        const laplacian = ((hL + hR + hD + hU) * 0.25) - hC;
        const cavityAO = Math.max(0.84, Math.min(1.03, 1.0 - laplacian * 0.16));
        this.colors[cIdx] = cavityAO;
        this.colors[cIdx + 1] = cavityAO;
        this.colors[cIdx + 2] = cavityAO;
        this.colors[cIdx + 3] = 1.0;
      }
    }

    // 4. Emit regular 1m cells and 0.25m subdivided Tee/Bunker cells into the single mesh
    let nextV = baseVerts;
    let iIdx = 0;
    const eps = 0.20;

    for (let cz = 0; cz < this.length; cz++) {
      for (let cx = 0; cx < this.width; cx++) {
        if (this.subdividedCells[cz * this.width + cx] === 0) {
          const idx00 = cz * cols + cx;
          const idx10 = cz * cols + (cx + 1);
          const idx01 = (cz + 1) * cols + cx;
          const idx11 = (cz + 1) * cols + (cx + 1);

          this.indices[iIdx++] = idx00;
          this.indices[iIdx++] = idx01;
          this.indices[iIdx++] = idx10;

          this.indices[iIdx++] = idx10;
          this.indices[iIdx++] = idx01;
          this.indices[iIdx++] = idx11;
        } else {
          const cellStartV = nextV;

          for (let iv = 0; iv <= 4; iv++) {
            const wz = cz + iv * 0.25;
            for (let iu = 0; iu <= 4; iu++) {
              const wx = cx + iu * 0.25;
              const wy = this.getSubCellVertexHeight(cx, cz, iu, iv);

              const pIdx = nextV * 3;
              const uIdx = nextV * 2;
              const cIdx = nextV * 4;

              this.positions[pIdx] = wx;
              this.positions[pIdx + 1] = wy;
              this.positions[pIdx + 2] = wz;

              this.uvs[uIdx] = wx / this.width;
              this.uvs[uIdx + 1] = wz / this.length;

              const hL = this.evaluateAnalyticalElevation(wx - eps, wz);
              const hR = this.evaluateAnalyticalElevation(wx + eps, wz);
              const hD = this.evaluateAnalyticalElevation(wx, wz - eps);
              const hU = this.evaluateAnalyticalElevation(wx, wz + eps);

              let nx = (hL - hR) / (2 * eps);
              let ny = 1.0;
              let nz = (hD - hU) / (2 * eps);
              const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;

              this.normals[pIdx] = nx / len;
              this.normals[pIdx + 1] = ny / len;
              this.normals[pIdx + 2] = nz / len;

              this.colors[cIdx] = 1.0;
              this.colors[cIdx + 1] = 1.0;
              this.colors[cIdx + 2] = 1.0;
              this.colors[cIdx + 3] = 1.0;

              nextV++;
            }
          }

          for (let iv = 0; iv < 4; iv++) {
            for (let iu = 0; iu < 4; iu++) {
              const i00 = cellStartV + iv * 5 + iu;
              const i10 = i00 + 1;
              const i01 = i00 + 5;
              const i11 = i01 + 1;

              const h00 = this.positions[i00 * 3 + 1];
              const h10 = this.positions[i10 * 3 + 1];
              const h01 = this.positions[i01 * 3 + 1];
              const h11 = this.positions[i11 * 3 + 1];

              if (Math.abs(h00 - h11) < Math.abs(h10 - h01)) {
                this.indices[iIdx++] = i00;
                this.indices[iIdx++] = i11;
                this.indices[iIdx++] = i10;

                this.indices[iIdx++] = i00;
                this.indices[iIdx++] = i01;
                this.indices[iIdx++] = i11;
              } else {
                this.indices[iIdx++] = i00;
                this.indices[iIdx++] = i01;
                this.indices[iIdx++] = i10;

                this.indices[iIdx++] = i10;
                this.indices[iIdx++] = i01;
                this.indices[iIdx++] = i11;
              }
            }
          }
        }
      }
    }

    const vertexData = new VertexData();
    vertexData.positions = this.positions;
    vertexData.normals = this.normals;
    vertexData.uvs = this.uvs;
    vertexData.colors = this.colors;
    vertexData.indices = this.indices;
    vertexData.applyToMesh(this.terrainMesh, true);
  }
}
