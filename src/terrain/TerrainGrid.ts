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
  private static bunkerSandImg: HTMLImageElement | null = null;
  private static shortGrassImg: HTMLImageElement | null = null;

  private matBunkerSandOverlay!: StandardMaterial;
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
    // 1. High-Res 2048x2048 Bunker Sand Material (bunker_sand_01.jpg)
    const sandTex = new Texture(
      '/textures/bunker_sand_01.jpg',
      this.scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    sandTex.wrapU = Texture.WRAP_ADDRESSMODE;
    sandTex.wrapV = Texture.WRAP_ADDRESSMODE;
    sandTex.anisotropicFilteringLevel = 16;

    const turfNormal = RealisticTextures.createSeamlessTurfNormalTexture(this.scene);
    turfNormal.uScale = 4;
    turfNormal.vScale = 4;
    turfNormal.level = 0.45;

    this.matBunkerSandOverlay = new StandardMaterial('matBunkerSandPhoto', this.scene);
    this.matBunkerSandOverlay.diffuseTexture = sandTex;
    this.matBunkerSandOverlay.bumpTexture = turfNormal;
    this.matBunkerSandOverlay.specularColor = new Color3(0.08, 0.07, 0.05);
    this.matBunkerSandOverlay.specularPower = 32;
    this.matBunkerSandOverlay.zOffset = -2;

    // 2. High-Res 2048x2048 Inside Tee Box Turf Material (short_grass_01.jpg)
    const teeGrassTex = new Texture(
      '/textures/short_grass_01.jpg',
      this.scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    teeGrassTex.wrapU = Texture.WRAP_ADDRESSMODE;
    teeGrassTex.wrapV = Texture.WRAP_ADDRESSMODE;
    teeGrassTex.anisotropicFilteringLevel = 16;

    this.matTeeBoxOverlay = new StandardMaterial('matTeeBoxPhoto', this.scene);
    this.matTeeBoxOverlay.diffuseTexture = teeGrassTex;
    this.matTeeBoxOverlay.bumpTexture = turfNormal;
    this.matTeeBoxOverlay.specularColor = new Color3(0.06, 0.08, 0.05);
    this.matTeeBoxOverlay.specularPower = 48;
    this.matTeeBoxOverlay.zOffset = -2;

    // Also load HTMLImageElements for 2048x4096 Splat Canvas pattern filling
    if (!TerrainGrid.bunkerSandImg) {
      const imgSand = new Image();
      imgSand.src = '/textures/bunker_sand_01.jpg';
      imgSand.onload = () => {
        TerrainGrid.bunkerSandImg = imgSand;
        this.redrawSplatTexture();
      };
    }
    if (!TerrainGrid.shortGrassImg) {
      const imgGrass = new Image();
      imgGrass.src = '/textures/short_grass_01.jpg';
      imgGrass.onload = () => {
        TerrainGrid.shortGrassImg = imgGrass;
        this.redrawSplatTexture();
      };
    }
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
   * Championship Hole Elevation Topology:
   * 1. High Elevated Tee Bluff around Z=40 (~6.5m base hill, +1.3m tee box = ~7.8m total)
   * 2. Fairway descending into a scenic small valley (Z=140..270 at ~2.0m..2.3m)
   * 3. Green pocket at (X=148, Z=360) sitting slightly lower (~1.25m) than the approach fairway (~2.3m)
   */
  private generateInitialNaturalTerrain() {
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const idx = z * this.cols + x;
        this.surfaceTypes[idx] = SurfaceType.ROUGH;

        // 1. Elevated Tee Hill at start of hole (Z = 0..95)
        const teeSlopeT = Math.max(0, Math.min(1, (95 - z) / 60));
        const teeHill = teeSlopeT * teeSlopeT * (3 - 2 * teeSlopeT) * 4.6;

        // 2. Valley corridor center X following the Dogleg-Right curve
        const zNorm = Math.max(0, Math.min(1, (z - 80) / 280));
        const corridorCenterX = 96 + Math.pow(zNorm, 1.85) * 52; // Curves from X=96 to X=148
        const distFromCorridor = Math.abs(x - corridorCenterX);

        // Gentle valley walls rising outside the fairway corridor
        const valleyWallT = Math.max(0, Math.min(1, (distFromCorridor - 22) / 55));
        const valleyWallLift = valleyWallT * valleyWallT * 3.8;

        // 3. Longitudinal elevation along valley:
        // Valley floor sits around 2.1m..2.4m in the landing/approach zone (Z=130..315),
        // then steps gently DOWN into the putting green amphitheater at Z=360 (~1.25m)!
        let valleyBaseY = 2.2;
        if (z > 310) {
          const greenDropT = Math.max(0, Math.min(1, (z - 310) / 38));
          const smoothDrop = greenDropT * greenDropT * (3 - 2 * greenDropT);
          valleyBaseY = 2.2 - smoothDrop * 0.95; // Green sits ~0.95m lower than approach fairway!
        }

        // Subtle natural organic rolling waves in the rough outside the green
        const distToGreen = Math.sqrt(Math.pow(x - 148, 2) + Math.pow(z - 360, 2));
        const greenFlatMask = Math.max(0, Math.min(1, (distToGreen - 20) / 18));
        const wave =
          (Math.sin(x * 0.04) * Math.cos(z * 0.03) * 0.65 +
            Math.sin(x * 0.08 + 1.1) * Math.sin(z * 0.06) * 0.25) *
          greenFlatMask;

        this.heights[idx] = Math.max(0.2, valleyBaseY + teeHill + valleyWallLift + wave);
      }
    }
  }

  /**
   * Analytical Kidney Bunker Contour Function
   * Returns normalized distance R where R <= 1.0 is inside the kidney bean shape.
   */
  public static computeKidneyDist(localX: number, localZ: number, halfW: number, halfL: number): { dist: number; theta: number } {
    const u = localX / Math.max(1, halfW);
    const v = localZ / Math.max(1, halfL);

    // Bend spine into a kidney bean curve
    const uKidney = u - 0.36 * (v * v - 0.25);
    const theta = Math.atan2(v, uKidney);

    // Smooth organic multi-lobe modulation
    const lobeScale = 1.0 + 0.09 * Math.sin(theta * 2.0 + 0.5) - 0.06 * Math.cos(theta * 3.0);
    const rawR = Math.sqrt(uKidney * uKidney + v * v);

    return { dist: rawR / lobeScale, theta };
  }

  /**
   * Traces the exact analytical kidney boundary for a given normalized radius R on a 2D Canvas
   */
  private traceKidneyPath(ctx: CanvasRenderingContext2D, halfW: number, halfL: number, radiusMultiplier: number) {
    const steps = 96;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const lobeScale = 1.0 + 0.09 * Math.sin(theta * 2.0 + 0.5) - 0.06 * Math.cos(theta * 3.0);
      const r = radiusMultiplier * lobeScale;

      const uKidney = r * Math.cos(theta);
      const v = r * Math.sin(theta);
      const u = uKidney + 0.36 * (v * v - 0.25);

      const px = u * halfW;
      const pz = v * halfL;
      if (i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.closePath();
  }

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

  /**
   * Evaluates a smooth 4-point cubic Bezier spine for a continuous Dogleg Fairway
   */
  private evaluateSpline(points: DoglegWaypoint[], t: number): { x: number; z: number; width: number; tx: number; tz: number } {
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
    const width = b0 * p0.width + b1 * p1.width + b2 * p2.width + b3 * p3.width;

    // Derivative for tangent vector
    const d0 = -3 * u * u;
    const d1 = 3 * u * u - 6 * u * t;
    const d2 = 6 * u * t - 3 * t * t;
    const d3 = 3 * t * t;
    let tx = d0 * p0.x + d1 * p1.x + d2 * p2.x + d3 * p3.x;
    let tz = d0 * p0.z + d1 * p1.z + d2 * p2.z + d3 * p3.z;
    const len = Math.sqrt(tx * tx + tz * tz) || 1;
    tx /= len;
    tz /= len;

    return { x, z, width, tx, tz };
  }

  /**
   * Stamps a continuous, seamless Dogleg Fairway ribbon along a 4-point cubic Bezier spline
   * (eliminating any "two joined ovals" appearance).
   */
  public stampDoglegFairway(points: DoglegWaypoint[]) {
    if (points.length < 4) return;

    const samples = 140;
    const spine = [];
    for (let i = 0; i <= samples; i++) {
      spine.push(this.evaluateSpline(points, i / samples));
    }

    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        let minNormDist = 999;

        for (let i = 0; i <= samples; i++) {
          const sp = spine[i];
          const dx = x - sp.x;
          const dz = z - sp.z;
          const halfW = sp.width * 0.5;
          const d = Math.sqrt(dx * dx + dz * dz) / halfW;
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
          const { dist: kidneyDist, theta } = TerrainGrid.computeKidneyDist(localX, localZ, halfW, halfL);

          if (kidneyDist <= 1.38) {
            const effDepth = Math.min(-1.25, depthProfile || -1.35);
            // Higher, sharper lip on the forward/target side of the bunker
            const directionalLipBoost = 0.78 + 0.28 * Math.sin(theta);
            const effLip = Math.max(0.55, lipHeight || 0.65) * directionalLipBoost;

            if (kidneyDist <= 0.68) {
              // Deep flat-bottomed concave sand bowl
              const normR = kidneyDist / 0.68;
              const bowlProfile = Math.cos(normR * Math.PI * 0.25);
              this.heights[idx] = baseElevation + effDepth * bowlProfile;
              this.surfaceTypes[idx] = SurfaceType.BUNKER;
            } else if (kidneyDist <= 1.08) {
              // Smoothly sculpted C2-continuous revetted sod wall spanning ~3m so 1m grid triangles never jag
              const t = (kidneyDist - 0.68) / 0.40;
              const smoothS = t * t * (3.0 - 2.0 * t);
              const bowlEdge = Math.cos(Math.PI * 0.25);
              this.heights[idx] = baseElevation + effDepth * bowlEdge * (1.0 - smoothS) + effLip * smoothS;
              if (t < 0.42) {
                this.surfaceTypes[idx] = SurfaceType.BUNKER;
              } else if (this.surfaceTypes[idx] === SurfaceType.GREEN) {
                this.surfaceTypes[idx] = SurfaceType.FRINGE;
              }
            } else {
              // Raised outer grassy bunker lip mound sloping back to fairway/rough
              const t = (kidneyDist - 1.08) / 0.30;
              const mound = 0.5 * (1.0 + Math.cos(Math.min(1.0, t) * Math.PI));
              const lipTarget = baseElevation + effLip * mound;
              this.heights[idx] = this.heights[idx] * (1 - mound * 0.85) + lipTarget * (mound * 0.85);
              if (mound > 0.20 && this.surfaceTypes[idx] === SurfaceType.GREEN) {
                this.surfaceTypes[idx] = SurfaceType.FRINGE;
              }
            }
          }
          continue;
        }

        const normDist = Math.sqrt(Math.pow(localX / halfW, 2) + Math.pow(localZ / halfL, 2));
        if (normDist <= 1.35) {
          if (surfaceType === SurfaceType.GREEN) {
            if (normDist <= 1.0) {
              const blend = Math.cos(normDist * Math.PI * 0.5);
              // Gentle readable two-way putting contour across the green
              const readableSlope = (localX / halfW) * 0.26 + (localZ / halfL) * 0.22;
              const targetGreenY = baseElevation + readableSlope;
              this.heights[idx] = this.heights[idx] * (1 - blend) + targetGreenY * blend;
              this.surfaceTypes[idx] = SurfaceType.GREEN;
            } else if (normDist <= 1.22 && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER) {
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
            // Elevated flat championship tee platform with smooth sloped grassy banks (out to normDist 1.35)
            const liftHeight = Math.max(1.1, depthProfile || 1.2);
            if (normDist <= 0.88) {
              this.heights[idx] = baseElevation + liftHeight;
              this.surfaceTypes[idx] = SurfaceType.TEE;
            } else if (normDist <= 1.35) {
              const bankT = (normDist - 0.88) / 0.47;
              const smoothBank = 0.5 * (1 + Math.cos(bankT * Math.PI));
              this.heights[idx] = this.heights[idx] * (1 - smoothBank) + (baseElevation + liftHeight) * smoothBank;
              if (normDist <= 1.0) {
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

  public redrawSplatTexture() {
    if (!this.splatTexture) return;
    this.ensurePatternTiles();
    const tiles = TerrainGrid.patternTiles!;

    const ctx = this.splatTexture.getContext() as CanvasRenderingContext2D;
    const canvasW = 2048;
    const canvasH = 4096;

    const sX = canvasW / this.width;
    const sZ = canvasH / this.length;

    const makeScaledPattern = (source: HTMLCanvasElement | HTMLImageElement, scale = 0.25): CanvasPattern => {
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

    // Use the user's 2048x2048 bunker_sand_01.jpg and short_grass_01.jpg patterns!
    const sandPattern = TerrainGrid.bunkerSandImg
      ? makeScaledPattern(TerrainGrid.bunkerSandImg, 0.08)
      : makeScaledPattern(tiles.sand, 0.22);

    const teeGrassPattern = TerrainGrid.shortGrassImg
      ? makeScaledPattern(TerrainGrid.shortGrassImg, 0.06)
      : makeScaledPattern(tiles.green, 0.22);

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

  private drawDoglegFairwayOnCanvas(
    ctx: CanvasRenderingContext2D,
    points: DoglegWaypoint[],
    sX: number,
    sZ: number,
    firstCutPattern: CanvasPattern,
    fairwayPattern: CanvasPattern
  ) {
    const samples = 100;
    const traceRibbon = (extraMarginMeters: number) => {
      const leftPts: { x: number; z: number }[] = [];
      const rightPts: { x: number; z: number }[] = [];

      for (let i = 0; i <= samples; i++) {
        const sp = this.evaluateSpline(points, i / samples);
        const halfW = sp.width * 0.5 + extraMarginMeters;
        // Normal to tangent (tx, tz) is (-tz, tx)
        const nx = -sp.tz;
        const nz = sp.tx;

        leftPts.push({ x: (sp.x + nx * halfW) * sX, z: (sp.z + nz * halfW) * sZ });
        rightPts.push({ x: (sp.x - nx * halfW) * sX, z: (sp.z - nz * halfW) * sZ });
      }

      ctx.beginPath();
      // Start along left bank
      ctx.moveTo(leftPts[0].x, leftPts[0].z);
      for (let i = 1; i <= samples; i++) {
        ctx.lineTo(leftPts[i].x, leftPts[i].z);
      }

      // Rounded end cap at green approach (t = 1)
      const endSp = this.evaluateSpline(points, 1.0);
      const endR = endSp.width * 0.5 + extraMarginMeters;
      const endAngle = Math.atan2(endSp.tx, -endSp.tz);
      for (let a = 1; a <= 18; a++) {
        const ang = endAngle + (a / 18) * Math.PI;
        const cx = (endSp.x + Math.cos(ang) * endR) * sX;
        const cz = (endSp.z + Math.sin(ang) * endR) * sZ;
        ctx.lineTo(cx, cz);
      }

      // Return along right bank
      for (let i = samples; i >= 0; i--) {
        ctx.lineTo(rightPts[i].x, rightPts[i].z);
      }

      // Rounded start cap near tee landing (t = 0)
      const startSp = this.evaluateSpline(points, 0.0);
      const startR = startSp.width * 0.5 + extraMarginMeters;
      const startAngle = Math.atan2(-startSp.tx, startSp.tz);
      for (let a = 1; a <= 18; a++) {
        const ang = startAngle + (a / 18) * Math.PI;
        const cx = (startSp.x + Math.cos(ang) * startR) * sX;
        const cz = (startSp.z + Math.sin(ang) * startR) * sZ;
        ctx.lineTo(cx, cz);
      }

      ctx.closePath();
    };

    // 1. Continuous First Cut Collar (+3.8m wider)
    traceRibbon(3.8);
    ctx.fillStyle = firstCutPattern;
    ctx.fill();
    ctx.strokeStyle = 'rgba(12, 32, 8, 0.28)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 2. Continuous Dogleg-Right Fairway Body
    traceRibbon(0);
    ctx.fillStyle = fairwayPattern;
    ctx.fill();

    // 3. Championship Mowing Stripes clipped cleanly inside the dogleg fairway
    ctx.save();
    traceRibbon(0);
    ctx.clip();

    const stripeStep = 4.6 * sZ;
    for (let z = 50 * sZ; z <= 360 * sZ; z += stripeStep * 2) {
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

    if (feat.surfaceType === SurfaceType.FAIRWAY) {
      const fcW = halfW + 3.5 * sX;
      const fcL = halfL + 3.5 * sZ;
      ctx.beginPath();
      ctx.ellipse(0, 0, fcW, fcL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfL, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fairwayPattern;
      ctx.fill();

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
      // Kidney-Shaped Bunker with Sharply Defined Turf Overhang Lip & Revetted Sod Wall
      // 1. Outer raised grassy berm shadow halo (R = 1.18)
      this.traceKidneyPath(ctx, halfW, halfL, 1.18);
      ctx.fillStyle = 'rgba(14, 34, 10, 0.48)';
      ctx.fill();

      // 2. Crisp dark turf overhang rim (R = 1.08)
      this.traceKidneyPath(ctx, halfW, halfL, 1.08);
      ctx.fillStyle = '#1d3b14';
      ctx.fill();

      // 3. Steep revetted sod wall face (R = 1.03)
      this.traceKidneyPath(ctx, halfW, halfL, 1.03);
      ctx.fillStyle = '#54432a';
      ctx.fill();

      // 4. Inner dark under-lip shadow ring (R = 0.96)
      this.traceKidneyPath(ctx, halfW, halfL, 0.96);
      ctx.fillStyle = '#382b18';
      ctx.fill();

      // 5. Bright raked quartz sand bed (bunker_sand_01.jpg) inside the kidney bowl (R = 0.93)
      this.traceKidneyPath(ctx, halfW, halfL, 0.93);
      ctx.fillStyle = patterns.sandPattern;
      ctx.fill();

      // 6. Crisp inner lip drop-shadow gradient to accentuate the steep 3D lip
      ctx.save();
      this.traceKidneyPath(ctx, halfW, halfL, 0.93);
      ctx.clip();
      this.traceKidneyPath(ctx, halfW, halfL, 0.93);
      ctx.strokeStyle = 'rgba(40, 28, 14, 0.72)';
      ctx.lineWidth = 6.5;
      ctx.stroke();
      ctx.restore();

    } else if (feat.surfaceType === SurfaceType.TEE) {
      // Sloped outer tee bank
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.22, halfL * 1.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.firstCutPattern;
      ctx.fill();

      // Crisp manicured collar around tee pad
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 1.04, halfL * 1.04, 0, 0, Math.PI * 2);
      ctx.fillStyle = patterns.fringePattern;
      ctx.fill();

      // Inside Tee Box Turf (short_grass_01.jpg)
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
   * Builds conformal high-resolution 3D surface sub-meshes for:
   * 1. Inside Tee Box turf (using 2048x2048 short_grass_01.jpg tiled every 2.5m)
   * 2. Bunker Sand beds (using 2048x2048 bunker_sand_01.jpg tiled every 3.5m)
   * So close-up views show razor-sharp 2048x2048 photographic detail!
   */
  private rebuildHighResSurfaceOverlays() {
    if (this.bunkerSandOverlayMesh) {
      this.bunkerSandOverlayMesh.dispose();
      this.bunkerSandOverlayMesh = null;
    }
    if (this.teeBoxOverlayMesh) {
      this.teeBoxOverlayMesh.dispose();
      this.teeBoxOverlayMesh = null;
    }

    const sandPositions: number[] = [];
    const sandNormals: number[] = [];
    const sandUVs: number[] = [];
    const sandColors: number[] = [];
    const sandIndices: number[] = [];
    let sandVCount = 0;

    const teePositions: number[] = [];
    const teeNormals: number[] = [];
    const teeUVs: number[] = [];
    const teeColors: number[] = [];
    const teeIndices: number[] = [];
    let teeVCount = 0;

    const cols = this.cols;
    const rows = this.rows;

    const isInteriorSurface = (vx: number, vz: number, target: SurfaceType): boolean => {
      if (vx <= 0 || vx >= cols - 1 || vz <= 0 || vz >= rows - 1) return false;
      const idx = vz * cols + vx;
      return (
        this.surfaceTypes[idx] === target &&
        this.surfaceTypes[idx - 1] === target &&
        this.surfaceTypes[idx + 1] === target &&
        this.surfaceTypes[idx - cols] === target &&
        this.surfaceTypes[idx + cols] === target
      );
    };

    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.width; x++) {
        const idx00 = z * cols + x;
        const idx10 = z * cols + (x + 1);
        const idx01 = (z + 1) * cols + x;
        const idx11 = (z + 1) * cols + (x + 1);

        const s00 = this.surfaceTypes[idx00];
        const s10 = this.surfaceTypes[idx10];
        const s01 = this.surfaceTypes[idx01];
        const s11 = this.surfaceTypes[idx11];

        const anyBunker =
          s00 === SurfaceType.BUNKER ||
          s10 === SurfaceType.BUNKER ||
          s01 === SurfaceType.BUNKER ||
          s11 === SurfaceType.BUNKER;

        const anyTee =
          s00 === SurfaceType.TEE ||
          s10 === SurfaceType.TEE ||
          s01 === SurfaceType.TEE ||
          s11 === SurfaceType.TEE;

        if (anyBunker) {
          const base = sandVCount;
          const verts = [idx00, idx10, idx01, idx11];
          const coords = [
            [x, z],
            [x + 1, z],
            [x, z + 1],
            [x + 1, z + 1]
          ];
          for (let k = 0; k < 4; k++) {
            const vi = verts[k];
            const vx = coords[k][0];
            const vz = coords[k][1];
            sandPositions.push(vx, this.heights[vi] + 0.008, vz);
            sandNormals.push(this.normals[vi * 3], this.normals[vi * 3 + 1], this.normals[vi * 3 + 2]);
            // Tile 2048x2048 bunker_sand_01.jpg every 5m x 5m (~410 pixels per meter!)
            sandUVs.push(vx / 5.0, vz / 5.0);
            const alpha = isInteriorSurface(vx, vz, SurfaceType.BUNKER) ? 1.0 : 0.0;
            sandColors.push(1.0, 1.0, 1.0, alpha);
          }
          sandIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          sandVCount += 4;
        } else if (anyTee) {
          const base = teeVCount;
          const verts = [idx00, idx10, idx01, idx11];
          const coords = [
            [x, z],
            [x + 1, z],
            [x, z + 1],
            [x + 1, z + 1]
          ];
          for (let k = 0; k < 4; k++) {
            const vi = verts[k];
            const vx = coords[k][0];
            const vz = coords[k][1];
            teePositions.push(vx, this.heights[vi] + 0.006, vz);
            teeNormals.push(this.normals[vi * 3], this.normals[vi * 3 + 1], this.normals[vi * 3 + 2]);
            // Tile 2048x2048 short_grass_01.jpg every 3m x 3m (~680 pixels per meter!)
            teeUVs.push(vx / 3.0, vz / 3.0);
            const alpha = isInteriorSurface(vx, vz, SurfaceType.TEE) ? 1.0 : 0.0;
            teeColors.push(1.0, 1.0, 1.0, alpha);
          }
          teeIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          teeVCount += 4;
        }
      }
    }

    if (sandIndices.length > 0) {
      this.bunkerSandOverlayMesh = new Mesh('BunkerSandPhotoOverlay', this.scene);
      this.bunkerSandOverlayMesh.isPickable = false;
      this.bunkerSandOverlayMesh.receiveShadows = true;
      this.bunkerSandOverlayMesh.hasVertexAlpha = true;
      const vd = new VertexData();
      vd.positions = new Float32Array(sandPositions);
      vd.normals = new Float32Array(sandNormals);
      vd.uvs = new Float32Array(sandUVs);
      vd.colors = new Float32Array(sandColors);
      vd.indices = new Uint32Array(sandIndices);
      vd.applyToMesh(this.bunkerSandOverlayMesh, false);
      this.bunkerSandOverlayMesh.material = this.matBunkerSandOverlay;
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
