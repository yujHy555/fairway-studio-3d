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
import { RealisticTextures } from './RealisticTextures';

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

  // Pre-allocated smooth indexed geometry buffers for fast updates
  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;
  private colors: Float32Array;
  private indices: Uint32Array;

  // Seamless tile pattern canvases for realistic grass, sand, and water bed
  private static patternTiles: Record<string, HTMLCanvasElement> | null = null;

  constructor(scene: Scene, width = GOLF_CONSTANTS.DEFAULT_MAP_WIDTH, length = GOLF_CONSTANTS.DEFAULT_MAP_LENGTH) {
    this.scene = scene;
    this.width = Math.floor(width);
    this.length = Math.floor(length);
    this.cols = this.width + 1;
    this.rows = this.length + 1;

    const totalVerts = this.cols * this.rows;
    this.heights = new Float32Array(totalVerts);
    this.surfaceTypes = new Uint8Array(totalVerts);

    // Pre-allocate shared-vertex buffers (101,881 vertices instead of 607,200 faceted vertices)
    this.positions = new Float32Array(totalVerts * 3);
    this.normals = new Float32Array(totalVerts * 3);
    this.uvs = new Float32Array(totalVerts * 2);
    this.colors = new Float32Array(totalVerts * 4);
    this.indices = new Uint32Array(this.width * this.length * 6);

    this.initStaticIndexAndUVBuffers();
    this.ensurePatternTiles();
    this.generateInitialNaturalTerrain();
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

  private initStaticIndexAndUVBuffers() {
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const vIdx = z * this.cols + x;
        this.positions[vIdx * 3] = x;
        this.positions[vIdx * 3 + 2] = z;

        this.uvs[vIdx * 2] = x / this.width;
        this.uvs[vIdx * 2 + 1] = z / this.length;

        this.colors[vIdx * 4] = 1.0;
        this.colors[vIdx * 4 + 1] = 1.0;
        this.colors[vIdx * 4 + 2] = 1.0;
        this.colors[vIdx * 4 + 3] = 1.0;
      }
    }

    let iIdx = 0;
    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.width; x++) {
        const idx00 = z * this.cols + x;
        const idx10 = z * this.cols + (x + 1);
        const idx01 = (z + 1) * this.cols + x;
        const idx11 = (z + 1) * this.cols + (x + 1);

        // Triangle 1: (0,0), (0,1), (1,0)
        this.indices[iIdx++] = idx00;
        this.indices[iIdx++] = idx01;
        this.indices[iIdx++] = idx10;

        // Triangle 2: (1,0), (0,1), (1,1)
        this.indices[iIdx++] = idx10;
        this.indices[iIdx++] = idx01;
        this.indices[iIdx++] = idx11;
      }
    }
  }

  private generateInitialNaturalTerrain() {
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const idx = z * this.cols + x;
        this.surfaceTypes[idx] = SurfaceType.ROUGH;

        // Smooth rolling championship golf valley undulation
        const wave1 = Math.sin(x * 0.035) * Math.cos(z * 0.025) * 1.25;
        const wave2 = Math.sin(x * 0.075 + 1.2) * Math.sin(z * 0.055) * 0.45;
        const centerDistX = Math.abs(x - this.width * 0.5) / (this.width * 0.5);
        const rimLift = Math.pow(centerDistX, 2) * 2.2;

        this.heights[idx] = Math.max(0.2, wave1 + wave2 + rimLift + 0.6);
      }
    }
  }

  /**
   * Exact barycentric triangle elevation matching the GPU triangle mesh diagonal split:
   * Triangle 1 (fx + fz <= 1): (x0, z0), (x0, z1), (x1, z0)
   * Triangle 2 (fx + fz > 1):  (x1, z0), (x0, z1), (x1, z1)
   * Guarantees zero ball floating and zero ground penetration at all coordinates.
   */
  public getElevation(worldX: number, worldZ: number): number {
    const x = Math.max(0, Math.min(this.width - 0.0001, worldX));
    const z = Math.max(0, Math.min(this.length - 0.0001, worldZ));

    const x0 = Math.floor(x);
    const x1 = Math.min(this.cols - 1, x0 + 1);
    const z0 = Math.floor(z);
    const z1 = Math.min(this.rows - 1, z0 + 1);

    const fx = x - x0;
    const fz = z - z0;

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
    // Ensure bunkers have sufficient footprint on the 1m grid so sand bowls carve cleanly without bridging
    const effWidth = surfaceType === SurfaceType.BUNKER ? Math.max(9, width) : width;
    const effLength = surfaceType === SurfaceType.BUNKER ? Math.max(9, length) : length;

    const halfW = effWidth * 0.5;
    const halfL = effLength * 0.5;
    const maxDim = Math.max(effWidth, effLength) * 0.85;

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

        if (normDist <= 1.35) {
          const idx = z * this.cols + x;

          if (surfaceType === SurfaceType.BUNKER) {
            const effDepth = Math.min(-0.85, depthProfile || -1.1);
            const effLip = Math.max(0.28, lipHeight || 0.35);

            if (normDist <= 0.94) {
              // Deep smooth concave sand bowl extending across full inner footprint
              const bowlFactor = Math.cos((normDist / 0.94) * Math.PI * 0.5);
              const flatBottom = Math.min(1.0, bowlFactor * 1.35);
              this.heights[idx] = baseElevation + effDepth * flatBottom;
              this.surfaceTypes[idx] = SurfaceType.BUNKER;
            } else if (normDist <= 1.12) {
              // Steep revetted sod lip rising from sand edge up to berm crest
              const t = (normDist - 0.94) / 0.18;
              const smoothT = t * t * (3 - 2 * t);
              this.heights[idx] = baseElevation + effLip * smoothT;
              this.surfaceTypes[idx] = t < 0.55 ? SurfaceType.BUNKER : this.surfaceTypes[idx];
            } else {
              // Outer grassy berm blending smoothly back into surrounding terrain
              const t = (normDist - 1.12) / 0.23;
              const bermFactor = Math.max(0, Math.cos(t * Math.PI * 0.5));
              const targetBerm = baseElevation + effLip * bermFactor;
              this.heights[idx] = this.heights[idx] * (1 - bermFactor) + targetBerm * bermFactor;
            }
          } else if (surfaceType === SurfaceType.GREEN) {
            if (normDist <= 1.0) {
              const blend = Math.cos(normDist * Math.PI * 0.5);
              this.heights[idx] = this.heights[idx] * (1 - blend) + (baseElevation + depthProfile) * blend;
              this.surfaceTypes[idx] = SurfaceType.GREEN;
            } else if (normDist <= 1.20 && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
              this.surfaceTypes[idx] = SurfaceType.FRINGE;
            }
          } else if (surfaceType === SurfaceType.FAIRWAY) {
            if (normDist <= 1.0 && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
              this.surfaceTypes[idx] = SurfaceType.FAIRWAY;
            } else if (normDist <= 1.15 && this.surfaceTypes[idx] === SurfaceType.ROUGH) {
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
            if (normDist <= 1.0) {
              const blend = 1.0 - Math.pow(normDist, 4);
              this.heights[idx] = this.heights[idx] * (1 - blend) + (baseElevation + 0.2) * blend;
              this.surfaceTypes[idx] = SurfaceType.TEE;
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

    // Record feature for high-resolution seamless vector & pattern splat rendering
    this.stampedFeatures.push({
      centerX,
      centerZ,
      width: effWidth,
      length: effLength,
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

    // 2048x4096 High-Resolution Course Splat Texture with Trilinear + 16x Anisotropic Filtering
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

    // High-frequency seamless tiled 3D turf & sand grain normal map + micro-blade texture (110x230 tiling = 2m per tile!)
    const turfNormalTex = RealisticTextures.createSeamlessTurfNormalTexture(this.scene);
    turfNormalTex.uScale = 110;
    turfNormalTex.vScale = 230;
    turfNormalTex.level = 0.62;

    const microDetailTex = RealisticTextures.createSeamlessMicroDetailTexture(this.scene);
    microDetailTex.uScale = 110;
    microDetailTex.vScale = 230;

    const mat = new StandardMaterial('terrainMat', this.scene);
    mat.diffuseTexture = this.splatTexture;
    mat.ambientTexture = microDetailTex;
    mat.bumpTexture = turfNormalTex;
    mat.specularColor = new Color3(0.06, 0.07, 0.05);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    mesh.material = mat;

    this.redrawSplatTexture();
    this.rebuildMesh();

    return mesh;
  }

  /**
   * Renders mathematically smooth, anti-aliased curved borders filled with
   * seamless repeating grass, bentgrass, fescue rough, and raked quartz sand textures.
   */
  public redrawSplatTexture() {
    if (!this.splatTexture) return;
    this.ensurePatternTiles();
    const tiles = TerrainGrid.patternTiles!;

    const ctx = this.splatTexture.getContext() as CanvasRenderingContext2D;
    const canvasW = 2048;
    const canvasH = 4096;

    const sX = canvasW / this.width;
    const sZ = canvasH / this.length;

    const makeScaledPattern = (canvas: HTMLCanvasElement, scale = 0.25): CanvasPattern => {
      const pat = ctx.createPattern(canvas, 'repeat')!;
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
    const sandPattern = makeScaledPattern(tiles.sand, 0.22);
    const waterBedPattern = makeScaledPattern(tiles.water_bed, 0.25);

    // 1. Base Layer: Seamless Deep Rough Fescue/Ryegrass across entire course
    ctx.fillStyle = roughPattern;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Sort features by layer priority so Hazards (Water/Bunkers) and Greens always render cleanly
    // above Fairways and Rough, preventing green grass from ever showing inside a bunker!
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
        waterBedPattern
      });
    }

    // Must pass invertY = false so Canvas Y [0..canvasH] maps 1:1 to Mesh UV V [0..1] (z / length)!
    this.splatTexture.update(false);
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
      waterBedPattern: CanvasPattern;
    }
  ) {
    const cx = feat.centerX * sX;
    const cz = feat.centerZ * sZ;
    const halfW = (feat.width * 0.5) * sX;
    const halfL = (feat.length * 0.5) * sZ;

    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(feat.rotationRad);

    if (feat.surfaceType === SurfaceType.FAIRWAY) {
      // 1. First Cut outer border (3.5m wider) with seamless intermediate grass pattern
      const fcW = halfW + 3.5 * sX;
      const fcL = halfL + 3.5 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, fcW, fcL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      // Subtle edge shadow between rough and first cut
      ctx.strokeStyle = 'rgba(12, 32, 8, 0.25)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // 2. Main Fairway body with seamless fairway grass pattern
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fairwayPattern;
      ctx.fill();

      // 3. Championship Fairway Mowing Stripes (clipped to fairway ellipse)
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.clip();

      const stripeStep = 4.5 * sZ;
      const numStripes = Math.ceil((halfL * 2) / stripeStep);
      for (let i = -numStripes; i <= numStripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(220, 255, 175, 0.085)' : 'rgba(10, 35, 8, 0.065)';
        ctx.fillRect(-halfW * 1.5, i * stripeStep, halfW * 3.0, stripeStep);
      }
      ctx.restore();

    } else if (feat.surfaceType === SurfaceType.FIRST_CUT) {
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
      // 1. Fringe Collar (2.6m wider) with seamless collar turf
      const fringeW = halfW + 2.6 * sX;
      const fringeL = halfL + 2.6 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, fringeW, fringeL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

      ctx.strokeStyle = 'rgba(18, 52, 16, 0.30)';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // 2. Championship Putting Green with seamless ultra-fine bentgrass pattern
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.greenPattern;
      ctx.fill();

      // 3. Tournament Narrow Putting Green Mowing Stripes
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
      // 1. Outer revetted grassy berm shadow ring (1.28x radius)
      const bermW = halfW * 1.24;
      const bermL = halfL * 1.24;
      ctx.beginPath();
      ctx.ellipse(0, 0, bermW, bermL, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18, 42, 12, 0.55)';
      ctx.fill();

      // 2. Steep sod-wall revetted face (1.14x radius - covers entire upper rim wall)
      const lipW = halfW * 1.14;
      const lipL = halfL * 1.14;
      ctx.beginPath();
      ctx.ellipse(0, 0, lipW, lipL, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#6e5c3c'; // Earthy stacked sod wall
      ctx.fill();

      // 3. Full carved bunker basin (1.06x radius so 100% of carved bowl is pure raked sand)
      const sandW = halfW * 1.06;
      const sandL = halfL * 1.06;
      ctx.beginPath();
      ctx.ellipse(0, 0, sandW, sandL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.sandPattern;
      ctx.fill();

      // 4. Inner lip ambient occlusion & concave sand bowl depth shading
      const bowlGrad = ctx.createRadialGradient(0, 0, sandW * 0.2, 0, 0, sandW);
      bowlGrad.addColorStop(0, 'rgba(255, 250, 230, 0.14)');
      bowlGrad.addColorStop(0.75, 'rgba(210, 185, 130, 0.05)');
      bowlGrad.addColorStop(0.93, 'rgba(95, 75, 42, 0.38)');
      bowlGrad.addColorStop(1.0, 'rgba(55, 42, 22, 0.65)');
      ctx.fillStyle = bowlGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, sandW, sandL, 0, 0, Math.PI * 2);
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.TEE) {
      // Tee bank collar
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW + 1.0 * sX, halfL + 1.0 * sZ, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      // Manicured Tee Box turf
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.greenPattern;
      ctx.fill();

    } else if (feat.surfaceType === SurfaceType.WATER) {
      // 1. Natural stone & wet grass shoreline bank
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.14, halfL * 1.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#384634';
      ctx.fill();

      // 2. Deep aquatic lakebed silt pattern
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.05, halfL * 1.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.waterBedPattern;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Builds a 100% smooth-shaded, continuous shared-vertex terrain mesh.
   * Zero faceted low-poly edges, and 6x fewer vertices than unshared triangles.
   */
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

        // Smooth central-difference vertex normal
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

        // Subtle natural ambient occlusion in concave dips
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
  }
}
