import {
  Scene,
  Mesh,
  VertexData,
  Material,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture,
  MaterialPluginBase,
  ShaderStore,
  Matrix,
  UniformBuffer,
  MaterialDefines,
  BaseTexture
} from '@babylonjs/core';
import { GOLF_CONSTANTS, SurfaceType } from '../core/Constants';
import { Vector3D } from '../core/Types';
import { RealisticTextures } from './RealisticTextures';

/**
 * Patch Babylon.js bump shaders to guarantee stable TBN frame and clean normal mapping.
 */
const patchBumpShaders = () => {
  // 1. Direct patch ShaderStore.IncludesShadersStore['bumpFragment']
  // Babylon's default bumpFragment calls cotangent_frame(normalW*normalScale, ...)
  // When normalScale (bumpTexture.level) is 0.0, normalW*0 is vec3(0), which completely collapses
  // TBN into an all-zero matrix and corrupts normals.
  // Passing normalW directly into cotangent_frame ensures TBN is ALWAYS a stable, unit-length basis.
  let bumpFrag = ShaderStore.IncludesShadersStore['bumpFragment'];
  if (bumpFrag && bumpFrag.includes('normalW*normalScale')) {
    bumpFrag = bumpFrag.replace(
      /cotangent_frame\(normalW\*normalScale,/g,
      'cotangent_frame(normalW,'
    );
  }
  // Prevent detailMap from corrupting bump normal z-component to 0.0 which produced scattered black dot artifacts
  if (bumpFrag && bumpFrag.includes('blendedNormal')) {
    bumpFrag = bumpFrag.replace(
      /#ifdef BUMP[\s\S]*?#elif defined\(DETAIL\)/,
      `#ifdef BUMP
#ifdef OBJECTSPACE_NORMALMAP
#define CUSTOM_FRAGMENT_BUMP_FRAGMENT
normalW=normalize(TEXRD(bumpSampler,vBumpUV).xyz *2.0-1.0);normalW=normalize(mat3(normalMatrix)*normalW);
#else
vec3 bumpNormal=TEXRD(bumpSampler,vBumpUV+uvOffset).xyz*2.0-1.0;
normalW=perturbNormalBase(TBN,bumpNormal,vBumpInfos.y);
#endif
#elif defined(DETAIL)`
    );
  }
  ShaderStore.IncludesShadersStore['bumpFragment'] = bumpFrag;

  // 2. Patch perturbNormalBase in bumpFragmentMainFunctions to smoothly scale normal bumps.
  // Babylon passes scale = vBumpInfos.y = 1.0 / bumpTexture.level.
  // Therefore, bumpStrength = 1.0 / scale = bumpTexture.level!
  // When scale <= 0.001 or scale > 500.0 (or level <= 0.001), immediately return the unperturbed
  // vertex normal cotangentFrame[2] (= normalW), guaranteeing 0.0 is completely flat with zero NaNs.
  // Clamping normal.z to at least 0.05 guarantees the tangent normal never points downwards or creates black dot artifacts.
  let bumpMain = ShaderStore.IncludesShadersStore['bumpFragmentMainFunctions'];
  if (bumpMain) {
    bumpMain = bumpMain.replace(
      /vec3 perturbNormalBase\(mat3 cotangentFrame,vec3 normal,float scale\)[\s\S]*?\{[\s\S]*?return normalize\(cotangentFrame\*normal\);?\}/,
      `vec3 perturbNormalBase(mat3 cotangentFrame, vec3 normal, float scale) {
  if (scale <= 0.001 || scale > 500.0) return normalize(cotangentFrame[2]);
  float bumpStrength = 1.0 / scale;
  vec3 scaledNormal = normalize(vec3(normal.xy * bumpStrength, max(0.05, normal.z)));
  return normalize(cotangentFrame * scaledNormal);
}`
    );
    ShaderStore.IncludesShadersStore['bumpFragmentMainFunctions'] = bumpMain;
  }
};
patchBumpShaders();

/**
 * Babylon.js material plugin that:
 * 1. Renders Main Ground at full native GPU texture resolution (4K/8K) with hardware mipmaps & anisotropy
 *    outside course features, eliminating splat-canvas pixelation and blockiness.
 * 2. Preserves course feature splat visuals (Fairways, Tees, Greens, Bunkers, Ponds, First-Cut, Fringe)
 *    with crisp turf micro-detail and bunker sand exclusion.
 */
class BunkerGrassExclusionPlugin extends MaterialPluginBase {
  public groundColorTex: Texture | null = null;
  public fallbackSplatTex: BaseTexture | null = null;
  public groundBaseColor: Color3 = Color3.White();
  public enableGroundColorTex: boolean = true;

  constructor(material: StandardMaterial) {
    super(material, 'BunkerGrassExclusion', 100, { BUNKER_MASK: true });
    this._enable(true);
    patchBumpShaders();
  }

  prepareDefines(defines: MaterialDefines) {
    defines['BUNKER_MASK'] = true;
  }

  getSamplers(samplers: string[]) {
    samplers.push('groundColorSampler');
  }

  getActiveTextures(activeTextures: BaseTexture[]) {
    if (this.groundColorTex) {
      activeTextures.push(this.groundColorTex);
    }
  }

  hasTexture(texture: BaseTexture): boolean {
    return this.groundColorTex === texture;
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'groundColorMatrix', size: 16, type: 'mat4' },
        { name: 'uGroundColorParams', size: 4, type: 'vec4' }
      ]
    };
  }

  bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene) {
    const texReady = !!(this.groundColorTex && this.groundColorTex.isReady());
    const useTex = this.enableGroundColorTex && texReady && scene.texturesEnabled;
    const mat4 = this.groundColorTex
      ? this.groundColorTex.getTextureMatrix()
      : Matrix.Identity();
    uniformBuffer.updateMatrix('groundColorMatrix', mat4);

    if (useTex && this.groundColorTex) {
      uniformBuffer.updateFloat4(
        'uGroundColorParams',
        this.groundBaseColor.r,
        this.groundBaseColor.g,
        this.groundBaseColor.b,
        1.0
      );
      uniformBuffer.setTexture('groundColorSampler', this.groundColorTex);
    } else {
      const isWhite =
        this.groundBaseColor.r > 0.99 &&
        this.groundBaseColor.g > 0.99 &&
        this.groundBaseColor.b > 0.99;
      const r = !this.enableGroundColorTex && isWhite ? 0.298 : this.groundBaseColor.r;
      const g = !this.enableGroundColorTex && isWhite ? 0.455 : this.groundBaseColor.g;
      const b = !this.enableGroundColorTex && isWhite ? 0.188 : this.groundBaseColor.b;
      uniformBuffer.updateFloat4('uGroundColorParams', r, g, b, 0.0);
      const safeSamplerTex = texReady
        ? this.groundColorTex
        : this.fallbackSplatTex;
      if (safeSamplerTex) {
        uniformBuffer.setTexture('groundColorSampler', safeSamplerTex);
      }
    }
  }

  getCustomCode(shaderType: string) {
    if (shaderType === 'vertex') {
      return {
        'CUSTOM_VERTEX_DEFINITIONS': `
          #if defined(BUNKER_MASK)
            varying vec2 vGroundColorUV;
          #endif
        `,
        'CUSTOM_VERTEX_MAIN_END': `
          #if defined(BUNKER_MASK)
            vGroundColorUV = vec2(groundColorMatrix * vec4(uvUpdated, 1.0, 0.0));
          #endif
        `
      };
    }
    if (shaderType === 'fragment') {
      return {
        'CUSTOM_FRAGMENT_DEFINITIONS': `
          #if defined(BUNKER_MASK)
            uniform sampler2D groundColorSampler;
            varying vec2 vGroundColorUV;
          #endif
        `,
        'CUSTOM_FRAGMENT_UPDATE_DIFFUSE': `
          #if defined(DIFFUSE)
            // 1. Course feature splat map (alpha ~0.50 on Main Ground, ~0.5..1.0 on collar transitions, 1.0 inside features)
            vec4 pureSplat = texture2D(diffuseSampler, vDiffuseUV);
            #if defined(VERTEXCOLOR)
              pureSplat.rgb *= vColor.rgb;
            #endif

            // 2. Crisp full-resolution GPU color map for Main Ground (never pixelated via splat canvas!)
            vec3 mainGroundColor = uGroundColorParams.rgb;
            if (uGroundColorParams.a > 0.5) {
              mainGroundColor = texture2D(groundColorSampler, vGroundColorUV).rgb * uGroundColorParams.rgb;
            }
            #if defined(VERTEXCOLOR)
              mainGroundColor *= vColor.rgb;
            #endif

            // 3. Tiled turf micro-detail for course features (Fairway, Tee, Green, First Cut, Fringe)
            #if defined(DETAIL)
              vec3 featDetailColor = pureSplat.rgb * 2.0 * mix(0.5, detailColor.r, vDetailInfos.y);
            #else
              vec3 featDetailColor = pureSplat.rgb;
            #endif

            // 4. Exclude coarse grass overlay on bunker sand while preserving fine sand normal relief
            #if defined(VERTEXCOLOR)
              float grassMask = clamp(vColor.a, 0.0, 1.0);
              vec3 featureColor = mix(pureSplat.rgb, featDetailColor, smoothstep(0.02, 0.85, grassMask));
              #if defined(BUMP) && defined(NORMAL)
                float bunkerBumpStrength = mix(0.20, 1.0, smoothstep(0.04, 0.82, grassMask));
                normalW = normalize(mix(vNormalW, normalW, bunkerBumpStrength));
              #endif
            #else
              vec3 featureColor = featDetailColor;
            #endif

            // 5. Smooth blend between full-res Main Ground (alpha <= 0.51) and course features (alpha 1.0)
            float featureBlend = clamp((pureSplat.a - 0.51) / 0.49, 0.0, 1.0);
            baseColor.rgb = mix(mainGroundColor, featureColor, featureBlend);
          #endif
        `
      };
    }
    return null;
  }
}

export interface DoglegWaypoint {
  x: number;
  z: number;
  width: number;
}

export interface FeatureMaterialSettings {
  baseColor?: string;        // Hex color, e.g. '#28c860'
  specularColor?: string;    // Hex color, e.g. '#ffffff'
  specularPower?: number;    // 1 to 128 (glossiness)
  uScale?: number;           // Texture pattern UV repeat scale (e.g. 0.2 to 20.0, default 1.0)
  vScale?: number;           // Texture pattern UV repeat scale (e.g. 0.2 to 20.0, default 1.0)
  uOffset?: number;          // Texture UV offset (-1.0 to 1.0, default 0.0)
  vOffset?: number;          // Texture UV offset (-1.0 to 1.0, default 0.0)
  normalLevel?: number;      // 0.0 to 2.5
  enableBaseColorTex?: boolean; // Default true: use photo pattern; false: solid baseColor
  enableRoughnessTex?: boolean; // Default true
  enableNormalTex?: boolean;    // Default true
  // Lawn mowing stripes & collar rings
  showMowingStripes?: boolean;   // Default true
  mowingStripeWidth?: number;    // 0.5m to 5.0m
  mowingStripeContrast?: number; // 0.0 to 1.0 (opacity / strength)
  showCollarRings?: boolean;     // Default true
  collarWidth?: number;          // 0.1m to 6.0m
}

export interface StampedFeatureRecord {
  materialSettings?: FeatureMaterialSettings;
  customTile?: HTMLCanvasElement;
  customTextureUrls?: {
    color?: string;
    roughness?: string;
    normal?: string;
    colorName?: string;
    roughnessName?: string;
    normalName?: string;
  };
  id?: string;
  name?: string;
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
  public isDraftMode = false;
  private pristineNaturalHeights: Float32Array | null = null;

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
  private roughPhotoTile: HTMLCanvasElement | null = null;
  private defaultRoughPhotoTile: HTMLCanvasElement | null = null;
  private sandPhotoTile: HTMLCanvasElement | null = null;
  private highResGrassDetailTex: DynamicTexture | null = null;

  // Grass007 4K PBR ground texture references & real-time editable material/UV settings
  public groundUvScaleU: number = 110;
  public groundUvScaleV: number = 230;
  public groundUvOffsetU: number = 0.0;
  public groundUvOffsetV: number = 0.0;
  public groundNormalLevel: number = 0.45;
  public groundDetailBlendLevel: number = 0.50;
  public groundBaseColor: string = '#ffffff';
  public groundSpecularColor: string = '#0a0d08';
  public groundSpecularPower: number = 36;
  public groundEnableBaseColorTex: boolean = true;
  public groundEnableRoughnessTex: boolean = true;
  public groundEnableNormalTex: boolean = true;
  public groundCustomTextureUrls: {
    color?: string;
    roughness?: string;
    normal?: string;
    colorName?: string;
    roughnessName?: string;
    normalName?: string;
  } = {};
  private groundSplatRaf: number | null = null;

  public pbrGrassColorTex: Texture | null = null;
  public pbrGrassNormalTex: Texture | null = null;
  public pbrGrassRoughTex: Texture | null = null;
  public terrainMaterial: StandardMaterial | null = null;
  private groundShaderPlugin: BunkerGrassExclusionPlugin | null = null;

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
  public async initHighResPhotoPatterns(): Promise<void> {
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

    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
          console.warn(`Failed to load ${src}, proceeding with procedural fallback.`);
          resolve(img);
        };
        img.src = src;
      });
    };

    const [grassImg, sandImg, roughImg] = await Promise.all([
      loadImage('/textures/short_grass_01.jpg'),
      loadImage('/textures/bunker_sand_01.jpg'),
      loadImage('/textures/pbr_grass/grass_pbr_diff.jpg')
    ]);

    if (grassImg.complete && grassImg.naturalWidth > 0) {
      const { canvas } = buildEqualizedPhotoCanvas(grassImg, 512, 8, 0.32);
      this.teePhotoTile = canvas;

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
    }

    if (sandImg.complete && sandImg.naturalWidth > 0) {
      const { canvas } = buildEqualizedPhotoCanvas(sandImg, 512, 18, 1.20);
      this.sandPhotoTile = canvas;
    }

    if (roughImg.complete && roughImg.naturalWidth > 0) {
      const { canvas } = buildEqualizedPhotoCanvas(roughImg, 1024, 20, 1.10);
      this.defaultRoughPhotoTile = canvas;
      if (!this.groundCustomTextureUrls.color) {
        this.roughPhotoTile = canvas;
      }
    }

    this.redrawSplatTexture();
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
    this.pristineNaturalHeights = new Float32Array(this.baseHeights);
  }

  /**
   * Instantly restores natural topography in < 0.1ms via cached typed array copy,
   * avoiding redundant noise/exponential evaluations when transforming course features.
   */
  public restoreNaturalTerrain() {
    if (this.pristineNaturalHeights) {
      this.baseHeights.set(this.pristineNaturalHeights);
      this.heights.set(this.pristineNaturalHeights);
    } else {
      this.generateInitialNaturalTerrain();
    }
    this.surfaceTypes.fill(SurfaceType.ROUGH);
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
        const shapeIdx = feat.bunkerShapeIndex ?? 0;

        // Exact metric radius and organic contour harmonic
        const theta = Math.atan2(localZ / Math.max(1, halfL), localX / Math.max(1, halfW));
        const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIdx);
        const baseRad = Math.hypot(halfW * Math.cos(theta), halfL * Math.sin(theta)) * k;
        const rMeters = Math.hypot(localX, localZ);

        // Defined revetted sod lip & blend section that blends onto the host surface
        const rSand = baseRad * 0.78;
        const lipWidth = 1.20;
        const rLip = rSand + lipWidth;
        const blendWidth = 1.40;
        const rBlend = rLip + blendWidth;

        if (rMeters < rBlend) {
          const depth = Math.max(0.45, Math.min(0.85, Math.abs(feat.depthProfile || 0.60)));
          const localGroundY = h;
          const baseElev = feat.baseElevation ?? this.getBaseElevation(feat.centerX, feat.centerZ);

          // Stable dished sand floor: stays level with the bunker base elevation,
          // preventing uphill sand mounds while gently accommodating local slope
          const slopeWeight = Math.min(0.40, (rMeters / Math.max(0.001, rBlend)));
          const effectiveBaseY = baseElev * (1.0 - slopeWeight) + localGroundY * slopeWeight;
          const sandFloorY = effectiveBaseY - depth;
          const sandEdgeY = effectiveBaseY - depth * 0.22;

          // Crisp revetted sod lip crest (8cm to 14cm) following the local ground surface
          const lipRise = Math.max(0.08, Math.min(0.14, (feat.lipHeight ?? 0.60) * 0.14));
          const lipCrestY = localGroundY + lipRise;

          if (rMeters <= rSand) {
            const normR = rMeters / Math.max(0.001, rSand);
            if (normR <= 0.65) {
              h = sandFloorY;
            } else {
              const tFloor = (normR - 0.65) / 0.35;
              const sFloor = 0.5 * (1.0 - Math.cos(tFloor * Math.PI));
              h = sandFloorY * (1.0 - sFloor) + sandEdgeY * sFloor;
            }
          } else if (rMeters <= rLip) {
            // Revetted lip bank rising smoothly from sand edge to lip crest
            const tLip = (rMeters - rSand) / lipWidth;
            const sLip = 0.5 * (1.0 - Math.cos(tLip * Math.PI));
            h = sandEdgeY * (1.0 - sLip) + lipCrestY * sLip;
          } else {
            // Section that smoothly blends the lip crest onto the surface it is on
            const tBlend = (rMeters - rLip) / blendWidth;
            const sBlend = 0.5 * (1.0 + Math.cos(tBlend * Math.PI));
            h = localGroundY * (1.0 - sBlend) + lipCrestY * sBlend;
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

    // Authentic AAA PGA-style organic fairway contour (drive landing swell, dogleg pinch, approach bay)
    // Full width maintained at ends so 180-deg rounded caps produce 100% uniform fringe collars without pinching
    const driveSwell = 0.16 * Math.exp(-Math.pow((t - 0.34) / 0.16, 2));
    const doglegPinchRight = -0.18 * Math.exp(-Math.pow((t - 0.46) / 0.11, 2));
    const outerElbowSwellLeft = 0.14 * Math.exp(-Math.pow((t - 0.58) / 0.15, 2));
    const waterPinchRight = -0.16 * Math.exp(-Math.pow((t - 0.76) / 0.12, 2));
    const approachLobe = 0.10 * Math.exp(-Math.pow((t - 0.84) / 0.10, 2));

    const leftMod = 1.0 + driveSwell + outerElbowSwellLeft + 0.04 * Math.sin(t * Math.PI * 3.0);
    const rightMod = 1.0 + driveSwell + doglegPinchRight + waterPinchRight + approachLobe;

    const leftW = baseWidth * 0.5 * leftMod;
    const rightW = baseWidth * 0.5 * rightMod;

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
  public stampDoglegFairway(points: DoglegWaypoint[], autoRebuild: boolean = true) {
    if (points.length < 4) return;

    const samples = 90;
    const spine = [];
    for (let i = 0; i <= samples; i++) {
      spine.push(this.evaluateSpline(points, i / samples));
    }

    // Bounded search window: only rasterize cells within fairway bounding box + safety margin (38m)
    const minX = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - 38));
    const maxX = Math.min(this.cols - 1, Math.ceil(Math.max(...points.map(p => p.x)) + 38));
    const minZ = Math.max(0, Math.floor(Math.min(...points.map(p => p.z)) - 38));
    const maxZ = Math.min(this.rows - 1, Math.ceil(Math.max(...points.map(p => p.z)) + 38));

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
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

    const midX = points.reduce((acc, p) => acc + p.x, 0) / points.length;
    const midZ = points.reduce((acc, p) => acc + p.z, 0) / points.length;

    this.stampedFeatures.push({
      id: `fairway_main`,
      name: 'Championship Dogleg Fairway',
      centerX: midX,
      centerZ: midZ,
      width: points[1].width,
      length: Math.abs(points[points.length - 1].z - points[0].z),
      rotationRad: 0,
      surfaceType: SurfaceType.FAIRWAY,
      depthProfile: 0,
      lipHeight: 0,
      doglegPoints: points
    });

    if (autoRebuild) {
      this.redrawSplatTexture();
      this.rebuildMesh();
    }
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
    bunkerShapeIndex?: number,
    autoRebuild: boolean = true
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
      ], autoRebuild);
      return;
    }

    const effWidth = surfaceType === SurfaceType.BUNKER ? Math.max(12, width) : width;
    const effLength = surfaceType === SurfaceType.BUNKER ? Math.max(16, length) : length;
    const effBunkerShape = bunkerShapeIndex !== undefined ? bunkerShapeIndex : 0;

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
          const rSand = baseRad * 0.78;
          const lipWidth = 1.20;

          if (rMeters <= rSand) {
            this.surfaceTypes[idx] = SurfaceType.BUNKER;
          } else if (rMeters <= rSand + lipWidth && this.surfaceTypes[idx] !== SurfaceType.BUNKER && this.surfaceTypes[idx] !== SurfaceType.WATER && this.surfaceTypes[idx] !== SurfaceType.GREEN && this.surfaceTypes[idx] !== SurfaceType.FAIRWAY) {
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

    const featureCount = this.stampedFeatures.filter(f => f.surfaceType === surfaceType).length + 1;
    const defaultName = surfaceType === SurfaceType.GREEN ? 'Championship Green' :
                        surfaceType === SurfaceType.TEE ? 'Championship Tee Box' :
                        surfaceType === SurfaceType.BUNKER ? `Bunker #${featureCount} (Shape ${effBunkerShape})` :
                        surfaceType === SurfaceType.WATER ? `Water Hazard Pond #${featureCount}` : `${surfaceType} #${featureCount}`;

    this.stampedFeatures.push({
      id: `feat_${String(surfaceType)}_${Math.round(centerX)}_${Math.round(centerZ)}`,
      name: defaultName,
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

    if (autoRebuild) {
      this.redrawSplatTexture();
      this.rebuildMesh();
    }
  }

  /**
   * Toggles lightweight draft shading mode during real-time feature sliding/rotating.
   * Disables normal maps and heavy shaders while dragging for locked 60-120 FPS,
   * then restores full 4K PBR Grass007 normal maps on release.
   */
  public setDraftTransformMode(draft: boolean) {
    if (this.isDraftMode === draft) return;
    this.isDraftMode = draft;
    if (this.terrainMaterial) {
      if (draft) {
        this.terrainMaterial.bumpTexture = null;
      } else if (this.pbrGrassNormalTex) {
        this.terrainMaterial.bumpTexture = this.pbrGrassNormalTex;
      }
    }
  }

  /**
   * Re-rasterizes all stamped course features (Fairway, Green, Bunkers, Tee Box, Water Hazard)
   * in a single blazing-fast pass (< 3ms) after sliding or rotating any feature in Designer Mode.
   */
  public rebuildAllStampedFeatures(isDraft: boolean = false) {
    this.setDraftTransformMode(isDraft);
    this.restoreNaturalTerrain();
    const feats = [...this.stampedFeatures];
    this.stampedFeatures = [];

    // Pass 1: Base terrain shaping features (Fairway, Green, Tee, Water)
    for (const f of feats) {
      if (f.surfaceType === SurfaceType.BUNKER) continue;
      const effElev = this.getBaseElevation(f.centerX, f.centerZ);
      if (f.doglegPoints && f.doglegPoints.length >= 4) {
        this.stampDoglegFairway(f.doglegPoints, false);
      } else {
        this.stampFeature(
          f.centerX,
          f.centerZ,
          f.width,
          f.length,
          f.rotationRad,
          f.surfaceType,
          f.depthProfile,
          f.lipHeight,
          effElev,
          f.bunkerShapeIndex,
          false
        );
      }
    }

    // Pass 2: Bunkers (now guaranteed to read the sculpted green/fairway base elevation)
    for (const f of feats) {
      if (f.surfaceType !== SurfaceType.BUNKER) continue;
      const effElev = this.getBaseElevation(f.centerX, f.centerZ);
      this.stampFeature(
        f.centerX,
        f.centerZ,
        f.width,
        f.length,
        f.rotationRad,
        f.surfaceType,
        f.depthProfile,
        f.lipHeight,
        effElev,
        f.bunkerShapeIndex,
        false
      );
    }

    // Restore this.stampedFeatures preserving original IDs and array indices
    this.stampedFeatures = feats;

    this.redrawSplatTexture();
    this.rebuildMesh(isDraft);
  }

  /**
   * Slides a stamped course feature to new (newCenterX, newCenterZ) on the terrain.
   * Dynamically adapts its base elevation and all geometry to drape over local slopes.
   */
  public moveFeature(featureIndex: number, newCenterX: number, newCenterZ: number, isDraft: boolean = false) {
    if (featureIndex < 0 || featureIndex >= this.stampedFeatures.length) return;
    const feat = this.stampedFeatures[featureIndex];
    const dx = newCenterX - feat.centerX;
    const dz = newCenterZ - feat.centerZ;
    feat.centerX = newCenterX;
    feat.centerZ = newCenterZ;
    feat.baseElevation = this.getBaseElevation(newCenterX, newCenterZ);

    if (feat.doglegPoints) {
      for (const pt of feat.doglegPoints) {
        pt.x += dx;
        pt.z += dz;
      }
    }
    this.rebuildAllStampedFeatures(isDraft);
  }

  /**
   * Rotates a stamped course feature around Blender Z axis (yaw in Babylon: vertical Y axis).
   * Adapts base elevation so feature drapes naturally.
   */
  public rotateFeature(featureIndex: number, newRotationRad: number, isDraft: boolean = false) {
    if (featureIndex < 0 || featureIndex >= this.stampedFeatures.length) return;
    const feat = this.stampedFeatures[featureIndex];
    const dTheta = newRotationRad - feat.rotationRad;
    feat.rotationRad = newRotationRad;
    feat.baseElevation = this.getBaseElevation(feat.centerX, feat.centerZ);

    if (feat.doglegPoints) {
      const cosA = Math.cos(dTheta);
      const sinA = Math.sin(dTheta);
      for (const pt of feat.doglegPoints) {
        const rx = pt.x - feat.centerX;
        const rz = pt.z - feat.centerZ;
        pt.x = feat.centerX + rx * cosA - rz * sinA;
        pt.z = feat.centerZ + rx * sinA + rz * cosA;
      }
    }
    this.rebuildAllStampedFeatures(isDraft);
  }

  /**
   * Simultaneously moves and rotates a feature in a single pass to eliminate double-rebuilding.
   */
  public moveAndRotateFeature(
    featureIndex: number,
    newCenterX: number,
    newCenterZ: number,
    newRotationRad: number,
    isDraft: boolean = false
  ) {
    if (featureIndex < 0 || featureIndex >= this.stampedFeatures.length) return;
    const feat = this.stampedFeatures[featureIndex];
    const dx = newCenterX - feat.centerX;
    const dz = newCenterZ - feat.centerZ;
    const dTheta = newRotationRad - feat.rotationRad;

    feat.centerX = newCenterX;
    feat.centerZ = newCenterZ;
    feat.rotationRad = newRotationRad;
    feat.baseElevation = this.getBaseElevation(newCenterX, newCenterZ);

    if (feat.doglegPoints) {
      const cosA = Math.cos(dTheta);
      const sinA = Math.sin(dTheta);
      for (const pt of feat.doglegPoints) {
        pt.x += dx;
        pt.z += dz;
        const rx = pt.x - feat.centerX;
        const rz = pt.z - feat.centerZ;
        pt.x = feat.centerX + rx * cosA - rz * sinA;
        pt.z = feat.centerZ + rx * sinA + rz * cosA;
      }
    }
    this.rebuildAllStampedFeatures(isDraft);
  }

  /**
   * Computes exact world-space perimeter contour points (X, Z) for any course feature
   * (Fairway ribbon, Green, Tee Box, Water Hazard, or organic multi-lobed Bunker).
   */
  /**
   * Returns default material settings calibrated for each surface type.
   */
  public getDefaultFeatureMaterial(surface: SurfaceType): FeatureMaterialSettings {
    switch (surface) {
      case SurfaceType.GREEN:
        return {
          baseColor: '#28a745',
          specularColor: '#1c241c',
          specularPower: 48,
          uScale: 1.0,
          vScale: 1.0,
          uOffset: 0.0,
          vOffset: 0.0,
          normalLevel: 0.35,
          enableBaseColorTex: true,
          enableRoughnessTex: true,
          enableNormalTex: true,
          showMowingStripes: true,
          mowingStripeWidth: 1.8,
          mowingStripeContrast: 0.5,
          showCollarRings: true,
          collarWidth: 2.2
        };
      case SurfaceType.BUNKER:
        return {
          baseColor: '#d8c28a',
          specularColor: '#201e18',
          specularPower: 20,
          uScale: 1.0,
          vScale: 1.0,
          uOffset: 0.0,
          vOffset: 0.0,
          normalLevel: 0.20,
          enableBaseColorTex: true,
          enableRoughnessTex: true,
          enableNormalTex: true,
          showMowingStripes: false,
          mowingStripeWidth: 1.6,
          mowingStripeContrast: 0.0,
          showCollarRings: true,
          collarWidth: 1.2
        };
      case SurfaceType.FAIRWAY:
        return {
          baseColor: '#38b000',
          specularColor: '#182018',
          specularPower: 40,
          uScale: 1.0,
          vScale: 1.0,
          uOffset: 0.0,
          vOffset: 0.0,
          normalLevel: 0.40,
          enableBaseColorTex: true,
          enableRoughnessTex: true,
          enableNormalTex: true,
          showMowingStripes: true,
          mowingStripeWidth: 4.6,
          mowingStripeContrast: 0.5,
          showCollarRings: true,
          collarWidth: 2.0
        };
      case SurfaceType.TEE:
        return {
          baseColor: '#43a047',
          specularColor: '#1a221a',
          specularPower: 48,
          uScale: 1.0,
          vScale: 1.0,
          uOffset: 0.0,
          vOffset: 0.0,
          normalLevel: 0.35,
          enableBaseColorTex: true,
          enableRoughnessTex: true,
          enableNormalTex: true,
          showMowingStripes: true,
          mowingStripeWidth: 1.6,
          mowingStripeContrast: 0.5,
          showCollarRings: true,
          collarWidth: 0.5
        };
      case SurfaceType.WATER:
        return {
          baseColor: '#1d4ed8',
          specularColor: '#ffffff',
          specularPower: 64,
          uScale: 1.0,
          vScale: 1.0,
          uOffset: 0.0,
          vOffset: 0.0,
          normalLevel: 0.60,
          enableBaseColorTex: true,
          enableRoughnessTex: true,
          enableNormalTex: true,
          showCollarRings: true,
          collarWidth: 2.15
        };
      default:
        return {
          baseColor: '#558b2f',
          specularColor: '#141814',
          specularPower: 36,
          uScale: 1.0,
          vScale: 1.0,
          uOffset: 0.0,
          vOffset: 0.0,
          normalLevel: 0.45,
          enableBaseColorTex: true,
          enableRoughnessTex: true,
          enableNormalTex: true,
          showCollarRings: true,
          collarWidth: 1.0
        };
    }
  }

  /**
   * Real-time update of material and UV settings for a specific course feature.
   */
  public updateFeatureMaterial(index: number, settings: Partial<FeatureMaterialSettings>) {
    if (index < 0 || index >= this.stampedFeatures.length) return;
    const feat = this.stampedFeatures[index];
    if (!feat.materialSettings) {
      feat.materialSettings = this.getDefaultFeatureMaterial(feat.surfaceType);
    }
    Object.assign(feat.materialSettings, settings);

    // Immediately reflect normal relief changes live in the 3D viewport
    if (settings.normalLevel !== undefined) {
      const safeLevel = Math.max(0.0001, settings.normalLevel);
      if (this.terrainMaterial?.bumpTexture) {
        this.terrainMaterial.bumpTexture.level = safeLevel;
      }
      if (this.pbrGrassNormalTex) {
        this.pbrGrassNormalTex.level = safeLevel;
      }
      this.terrainMaterial?.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial?.resetDrawCache();
    }
    if (settings.enableNormalTex !== undefined && this.terrainMaterial) {
      const active = !!settings.enableNormalTex;
      if (!active) {
        if (this.terrainMaterial.bumpTexture) {
          (this.terrainMaterial as any)._origBumpTex = this.terrainMaterial.bumpTexture;
        }
        this.terrainMaterial.bumpTexture = null;
      } else {
        const tex = (this.terrainMaterial as any)._origBumpTex || this.pbrGrassNormalTex;
        if (tex) {
          const safeLevel = Math.max(0.0001, feat.materialSettings.normalLevel ?? 0.45);
          tex.level = safeLevel;
          this.terrainMaterial.bumpTexture = tex;
        }
      }
      this.terrainMaterial.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial.resetDrawCache();
    }
    if (
      (settings.enableRoughnessTex !== undefined ||
        settings.specularColor !== undefined ||
        settings.specularPower !== undefined) &&
      this.terrainMaterial
    ) {
      const m = feat.materialSettings;
      this.applyTerrainSpecularState(
        m.specularColor || '#1a221a',
        m.specularPower ?? 32,
        m.enableRoughnessTex !== false
      );
      this.terrainMaterial.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial.resetDrawCache();
    }
    if (settings.collarWidth !== undefined) {
      feat.materialSettings.collarWidth = settings.collarWidth;
    }

    // Real-time update of UV Scale & Offset across Normal, Roughness, and Detail maps
    if (settings.uScale !== undefined || settings.vScale !== undefined ||
        settings.uOffset !== undefined || settings.vOffset !== undefined) {
      const uS = feat.materialSettings.uScale ?? 1.0;
      const vS = feat.materialSettings.vScale ?? 1.0;
      const uO = feat.materialSettings.uOffset ?? 0.0;
      const vO = feat.materialSettings.vOffset ?? 0.0;

      const applyFeatUv = (tex: Texture | null | undefined) => {
        if (!tex) return;
        tex.uScale = this.groundUvScaleU * uS;
        tex.vScale = this.groundUvScaleV * vS;
        tex.uOffset = this.groundUvOffsetU + uO;
        tex.vOffset = this.groundUvOffsetV + vO;
      };

      if (this.terrainMaterial?.bumpTexture) {
        applyFeatUv(this.terrainMaterial.bumpTexture as Texture);
      }
      if (this.terrainMaterial?.specularTexture) {
        applyFeatUv(this.terrainMaterial.specularTexture as Texture);
      }
      if (this.pbrGrassNormalTex) {
        applyFeatUv(this.pbrGrassNormalTex);
      }
      if (this.pbrGrassRoughTex) {
        applyFeatUv(this.pbrGrassRoughTex);
      }
      if (this.terrainMaterial?.detailMap?.texture) {
        const dt = this.terrainMaterial.detailMap.texture as Texture;
        if (dt === this.highResGrassDetailTex) {
          dt.uScale = 75 * uS;
          dt.vScale = 156 * vS;
          dt.uOffset = uO;
          dt.vOffset = vO;
        } else {
          applyFeatUv(dt);
        }
      }
      this.terrainMaterial?.markAsDirty(Material.TextureDirtyFlag);
    }

    this.redrawSplatTexture();
  }

  /**
   * Resets material and UV settings for a specific course feature to default.
   */
  public resetFeatureMaterial(index: number) {
    if (index < 0 || index >= this.stampedFeatures.length) return;
    const feat = this.stampedFeatures[index];
    feat.materialSettings = this.getDefaultFeatureMaterial(feat.surfaceType);
    feat.customTile = undefined;
    feat.customTextureUrls = undefined;
    this.updateFeatureMaterial(index, feat.materialSettings);
  }

  /**
   * Sets custom uploaded texture map on a specific course feature.
   */
  public async setFeatureTexture(
    index: number,
    slot: 'color' | 'roughness' | 'normal',
    dataUrl: string,
    fileName: string
  ) {
    if (index < 0 || index >= this.stampedFeatures.length) return;
    const feat = this.stampedFeatures[index];
    if (!feat.customTextureUrls) feat.customTextureUrls = {};
    feat.customTextureUrls[slot] = dataUrl;
    if (slot === 'color') feat.customTextureUrls.colorName = fileName;
    else if (slot === 'roughness') feat.customTextureUrls.roughnessName = fileName;
    else if (slot === 'normal') feat.customTextureUrls.normalName = fileName;

    if (slot === 'color') {
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 512;
      canvas.height = img.height || 512;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      feat.customTile = canvas;
      if (feat.surfaceType === SurfaceType.BUNKER) {
        this.sandPhotoTile = canvas;
      } else if (feat.surfaceType === SurfaceType.TEE) {
        this.teePhotoTile = canvas;
      }
      this.redrawSplatTexture();
    } else if (slot === 'normal') {
      if (this.terrainMaterial) {
        const tex = new Texture(dataUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.name = fileName;
        const uS = feat.materialSettings?.uScale ?? 1.0;
        const vS = feat.materialSettings?.vScale ?? 1.0;
        const uO = feat.materialSettings?.uOffset ?? 0.0;
        const vO = feat.materialSettings?.vOffset ?? 0.0;
        tex.uScale = this.groundUvScaleU * uS;
        tex.vScale = this.groundUvScaleV * vS;
        tex.uOffset = this.groundUvOffsetU + uO;
        tex.vOffset = this.groundUvOffsetV + vO;
        tex.anisotropicFilteringLevel = 4;
        tex.level = feat.materialSettings?.normalLevel ?? 0.45;
        this.terrainMaterial.bumpTexture = tex;
        this.pbrGrassNormalTex = tex;
      }
    } else if (slot === 'roughness') {
      const tex = new Texture(dataUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
      tex.name = fileName;
      const uS = feat.materialSettings?.uScale ?? 1.0;
      const vS = feat.materialSettings?.vScale ?? 1.0;
      const uO = feat.materialSettings?.uOffset ?? 0.0;
      const vO = feat.materialSettings?.vOffset ?? 0.0;
      tex.uScale = this.groundUvScaleU * uS;
      tex.vScale = this.groundUvScaleV * vS;
      tex.uOffset = this.groundUvOffsetU + uO;
      tex.vOffset = this.groundUvOffsetV + vO;
      this.pbrGrassRoughTex = tex;
      if (this.terrainMaterial) {
        if (!feat.materialSettings) {
          feat.materialSettings = this.getDefaultFeatureMaterial(feat.surfaceType);
        }
        feat.materialSettings.enableRoughnessTex = true;
        this.applyTerrainSpecularState(
          feat.materialSettings.specularColor || '#1a221a',
          feat.materialSettings.specularPower ?? 32,
          true
        );
        this.terrainMaterial.markAsDirty(Material.TextureDirtyFlag);
        this.terrainMaterial.resetDrawCache();
      }
    }
  }

  /**
   * Sets custom uploaded texture map on the main ground PBR material & rough terrain splat layer.
   */
  public async setGroundTexture(
    slot: 'color' | 'roughness' | 'normal',
    dataUrl: string,
    fileName: string
  ) {
    this.groundCustomTextureUrls[slot] = dataUrl;
    if (slot === 'color') this.groundCustomTextureUrls.colorName = fileName;
    else if (slot === 'roughness') this.groundCustomTextureUrls.roughnessName = fileName;
    else if (slot === 'normal') this.groundCustomTextureUrls.normalName = fileName;

    if (slot === 'color') {
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = dataUrl;
      });
      // Keep a compact 256x256 proxy tile for fast edge-average color extraction without duplicating 4K/8K pixels on CPU
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(256, img.naturalWidth || img.width || 256);
      canvas.height = Math.min(256, img.naturalHeight || img.height || 256);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      this.roughPhotoTile = canvas;
      this.groundEnableBaseColorTex = true;

      const prevColorTex = this.pbrGrassColorTex;
      const tex = new Texture(dataUrl, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.name = fileName;
      tex.uScale = this.groundUvScaleU;
      tex.vScale = this.groundUvScaleV;
      tex.uOffset = this.groundUvOffsetU;
      tex.vOffset = this.groundUvOffsetV;
      tex.anisotropicFilteringLevel = 16;
      this.pbrGrassColorTex = tex;

      if (this.groundShaderPlugin) {
        this.groundShaderPlugin.groundColorTex = tex;
        this.groundShaderPlugin.enableGroundColorTex = true;
      }
      tex.onLoadObservable.addOnce(() => {
        this.terrainMaterial?.markAsDirty(Material.TextureDirtyFlag);
        this.terrainMaterial?.resetDrawCache();
      });
      if (prevColorTex && prevColorTex !== tex) {
        prevColorTex.dispose();
      }
      this.redrawSplatTexture();
      this.terrainMaterial?.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial?.resetDrawCache();
    } else if (slot === 'normal') {
      const prevNormalTex = this.pbrGrassNormalTex;
      const tex = new Texture(dataUrl, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.name = fileName;
      tex.uScale = this.groundUvScaleU;
      tex.vScale = this.groundUvScaleV;
      tex.uOffset = this.groundUvOffsetU;
      tex.vOffset = this.groundUvOffsetV;
      tex.anisotropicFilteringLevel = 16;
      tex.level = Math.max(0.0001, this.groundNormalLevel);
      this.pbrGrassNormalTex = tex;
      this.groundEnableNormalTex = true;
      if (this.terrainMaterial) {
        (this.terrainMaterial as any)._origGroundBumpTex = tex;
        this.terrainMaterial.bumpTexture = tex;
        this.terrainMaterial.markAsDirty(Material.TextureDirtyFlag);
        this.terrainMaterial.resetDrawCache();
      }
      if (prevNormalTex && prevNormalTex !== tex) {
        prevNormalTex.dispose();
      }
    } else if (slot === 'roughness') {
      const prevRoughTex = this.pbrGrassRoughTex;
      const tex = new Texture(dataUrl, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.name = fileName;
      tex.uScale = this.groundUvScaleU;
      tex.vScale = this.groundUvScaleV;
      tex.uOffset = this.groundUvOffsetU;
      tex.vOffset = this.groundUvOffsetV;
      tex.anisotropicFilteringLevel = 16;
      this.pbrGrassRoughTex = tex;
      this.groundEnableRoughnessTex = true;
      if (this.terrainMaterial) {
        this.applyTerrainSpecularState(this.groundSpecularColor, this.groundSpecularPower, true);
        this.terrainMaterial.markAsDirty(Material.TextureDirtyFlag);
        this.terrainMaterial.resetDrawCache();
      }
      if (prevRoughTex && prevRoughTex !== tex) {
        prevRoughTex.dispose();
      }
    }
  }

  /**
   * Helper to create a transformed CanvasPattern for a specific feature using DOMMatrix.
   * Scales and offsets smoothly around the feature's center, matching 3D UV tiling standards.
   */
  private getTransformedFeaturePattern(
    ctx: CanvasRenderingContext2D,
    tile: HTMLCanvasElement,
    baseScale: number,
    mat: FeatureMaterialSettings,
    centerX: number = 0,
    centerZ: number = 0
  ): CanvasPattern {
    const pat = ctx.createPattern(tile, 'repeat')!;
    if (typeof DOMMatrix !== 'undefined' && pat.setTransform) {
      // In 3D UV mapping, higher uScale = higher tiling frequency (smaller tile elements).
      // On Canvas2D, scale(s) stretches pixels larger, so we divide baseScale by uScale.
      const uScaleFactor = Math.max(0.05, mat.uScale ?? 1.0);
      const vScaleFactor = Math.max(0.05, mat.vScale ?? 1.0);
      const uS = Math.max(0.02, baseScale / uScaleFactor);
      const vS = Math.max(0.02, baseScale / vScaleFactor);

      const tileW = tile.width || 512;
      const tileH = tile.height || 512;
      const uO = (mat.uOffset ?? 0.0) * tileW * uS;
      const vO = (mat.vOffset ?? 0.0) * tileH * vS;

      pat.setTransform(
        new DOMMatrix()
          .translate(centerX + uO, centerZ + vO)
          .scale(uS, vS)
          .translate(-centerX, -centerZ)
      );
    }
    return pat;
  }

  public getFeaturePerimeterPoints(feat: StampedFeatureRecord): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    const halfW = feat.width * 0.5;
    const halfL = feat.length * 0.5;

    if (feat.doglegPoints && feat.doglegPoints.length >= 4) {
      const splineSamples = 32;
      const leftSide: { x: number; z: number }[] = [];
      const rightSide: { x: number; z: number }[] = [];
      for (let i = 0; i <= splineSamples; i++) {
        const sp = this.evaluateSpline(feat.doglegPoints, i / splineSamples);
        leftSide.push({
          x: sp.x - sp.leftW * (-sp.tz),
          z: sp.z - sp.leftW * sp.tx
        });
        rightSide.push({
          x: sp.x + sp.rightW * (-sp.tz),
          z: sp.z + sp.rightW * sp.tx
        });
      }
      return [...leftSide, ...rightSide.reverse()];
    }

    const cosR = Math.cos(feat.rotationRad);
    const sinR = Math.sin(feat.rotationRad);
    const count = 48;

    if (feat.surfaceType === SurfaceType.BUNKER) {
      const shapeIdx = feat.bunkerShapeIndex ?? 0;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIdx);
        const lx = halfW * Math.cos(theta) * k * 0.96;
        const lz = halfL * Math.sin(theta) * k * 0.96;
        const wx = feat.centerX + lx * cosR - lz * sinR;
        const wz = feat.centerZ + lx * sinR + lz * cosR;
        pts.push({ x: wx, z: wz });
      }
      return pts;
    }

    if (feat.surfaceType === SurfaceType.TEE) {
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const lx = halfW * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / 3.5);
        const lz = halfL * Math.sign(st) * Math.pow(Math.abs(st), 2 / 3.5);
        const wx = feat.centerX + lx * cosR - lz * sinR;
        const wz = feat.centerZ + lx * sinR + lz * cosR;
        pts.push({ x: wx, z: wz });
      }
      return pts;
    }

    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      const lx = halfW * Math.cos(theta);
      const lz = halfL * Math.sin(theta);
      const wx = feat.centerX + lx * cosR - lz * sinR;
      const wz = feat.centerZ + lx * sinR + lz * cosR;
      pts.push({ x: wx, z: wz });
    }
    return pts;
  }

  /**
   * Queries which stamped feature (if any) is located at world coordinate (worldX, worldZ).
   * Checks features in reverse order (top layer down: Bunkers -> Green -> Tee -> Water -> Fairway).
   */
  public findFeatureAt(worldX: number, worldZ: number): { feature: StampedFeatureRecord; index: number } | null {
    // 1. Direct query of surface type from terrain grid
    const surf = this.getSurfaceAt(worldX, worldZ);
    if (surf === SurfaceType.BUNKER) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < this.stampedFeatures.length; i++) {
        const f = this.stampedFeatures[i];
        if (f.surfaceType === SurfaceType.BUNKER) {
          const d = Math.hypot(f.centerX - worldX, f.centerZ - worldZ);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
      }
      if (bestIdx >= 0) return { feature: this.stampedFeatures[bestIdx], index: bestIdx };
    } else if (surf === SurfaceType.WATER) {
      const idx = this.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.WATER);
      if (idx >= 0) return { feature: this.stampedFeatures[idx], index: idx };
    } else if (surf === SurfaceType.GREEN || surf === SurfaceType.FRINGE) {
      const idx = this.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.GREEN);
      if (idx >= 0) {
        const f = this.stampedFeatures[idx];
        const d = Math.hypot(f.centerX - worldX, f.centerZ - worldZ);
        if (d < Math.max(f.width, f.length) * 0.95) {
          return { feature: f, index: idx };
        }
      }
    } else if (surf === SurfaceType.TEE) {
      const idx = this.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.TEE);
      if (idx >= 0) return { feature: this.stampedFeatures[idx], index: idx };
    } else if (surf === SurfaceType.FAIRWAY || surf === SurfaceType.FIRST_CUT) {
      const idx = this.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.FAIRWAY);
      if (idx >= 0) return { feature: this.stampedFeatures[idx], index: idx };
    }

    // 2. Comprehensive Proximity Scan: check distance to each feature's boundary
    // Priority order: Bunkers > Water > Green > Tee > Fairway
    let bestBunkerIdx = -1;
    let bestBunkerDist = Infinity;
    for (let i = 0; i < this.stampedFeatures.length; i++) {
      const f = this.stampedFeatures[i];
      if (f.surfaceType === SurfaceType.BUNKER) {
        const cosR = Math.cos(-f.rotationRad);
        const sinR = Math.sin(-f.rotationRad);
        const dx = worldX - f.centerX;
        const dz = worldZ - f.centerZ;
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;
        const halfW = f.width * 0.5;
        const halfL = f.length * 0.5;
        const normDist = Math.hypot(localX / Math.max(1, halfW), localZ / Math.max(1, halfL));
        if (normDist <= 1.35 && normDist < bestBunkerDist) {
          bestBunkerDist = normDist;
          bestBunkerIdx = i;
        }
      }
    }
    if (bestBunkerIdx >= 0) {
      return { feature: this.stampedFeatures[bestBunkerIdx], index: bestBunkerIdx };
    }

    // Check Water, Green, Tee
    for (let i = 0; i < this.stampedFeatures.length; i++) {
      const f = this.stampedFeatures[i];
      if (f.surfaceType === SurfaceType.WATER || f.surfaceType === SurfaceType.GREEN || f.surfaceType === SurfaceType.TEE) {
        const cosR = Math.cos(-f.rotationRad);
        const sinR = Math.sin(-f.rotationRad);
        const dx = worldX - f.centerX;
        const dz = worldZ - f.centerZ;
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;
        const halfW = f.width * 0.5;
        const halfL = f.length * 0.5;
        const normDist = Math.hypot(localX / Math.max(1, halfW), localZ / Math.max(1, halfL));
        if (normDist <= 1.35) {
          return { feature: f, index: i };
        }
      }
    }

    // Check Fairway (spline)
    for (let i = 0; i < this.stampedFeatures.length; i++) {
      const f = this.stampedFeatures[i];
      if (f.doglegPoints && f.doglegPoints.length >= 4) {
        const samples = 36;
        for (let s = 0; s <= samples; s++) {
          const sp = this.evaluateSpline(f.doglegPoints, s / samples);
          const d = Math.hypot(worldX - sp.x, worldZ - sp.z);
          const maxAllowed = Math.max(sp.leftW, sp.rightW) + 4.5;
          if (d <= maxAllowed) {
            return { feature: f, index: i };
          }
        }
      }
    }

    return null;
  }

  private static distanceToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
    const l2 = (x2 - x1) * (x2 - x1) + (z2 - z1) * (z2 - z1);
    if (l2 === 0) return Math.hypot(px - x1, pz - z1);
    let t = ((px - x1) * (x2 - x1) + (pz - z1) * (z2 - z1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), pz - (z1 + t * (z2 - z1)));
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
    this.splatTexture.anisotropicFilteringLevel = 4;

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
    this.highResGrassDetailTex.anisotropicFilteringLevel = 4;
    // Tile every ~2.9m x 2.9m across the 220m x 460m course so close-up grass blades on the tee box are clearly visible and fine
    this.highResGrassDetailTex.uScale = 75;
    this.highResGrassDetailTex.vScale = 156;

    // Fill initial neutral white until short_grass_01.jpg finishes loading
    const dCtx = this.highResGrassDetailTex.getContext() as CanvasRenderingContext2D;
    dCtx.fillStyle = '#f2f5f0';
    dCtx.fillRect(0, 0, 1024, 1024);
    this.highResGrassDetailTex.update(false);

    // 1. Packed Normal + Displacement map (RGB = NormalGL 4K, A = Displacement Height 4K)
    this.pbrGrassNormalTex = new Texture('/textures/pbr_grass/grass_pbr_nor_disp_2k.png', this.scene);
    this.pbrGrassNormalTex.uScale = this.groundUvScaleU;
    this.pbrGrassNormalTex.vScale = this.groundUvScaleV;
    this.pbrGrassNormalTex.uOffset = this.groundUvOffsetU;
    this.pbrGrassNormalTex.vOffset = this.groundUvOffsetV;
    this.pbrGrassNormalTex.anisotropicFilteringLevel = 16;
    this.pbrGrassNormalTex.level = this.groundNormalLevel;

    // 2. Color / Albedo map (Full-res GPU Color 4K)
    this.pbrGrassColorTex = new Texture('/textures/pbr_grass/grass_pbr_diff.jpg', this.scene);
    this.pbrGrassColorTex.uScale = this.groundUvScaleU;
    this.pbrGrassColorTex.vScale = this.groundUvScaleV;
    this.pbrGrassColorTex.uOffset = this.groundUvOffsetU;
    this.pbrGrassColorTex.vOffset = this.groundUvOffsetV;
    this.pbrGrassColorTex.anisotropicFilteringLevel = 16;

    // 3. Roughness map (Roughness 4K)
    this.pbrGrassRoughTex = new Texture('/textures/pbr_grass/grass_pbr_rough.jpg', this.scene);
    this.pbrGrassRoughTex.uScale = this.groundUvScaleU;
    this.pbrGrassRoughTex.vScale = this.groundUvScaleV;
    this.pbrGrassRoughTex.uOffset = this.groundUvOffsetU;
    this.pbrGrassRoughTex.vOffset = this.groundUvOffsetV;
    this.pbrGrassRoughTex.anisotropicFilteringLevel = 16;

    const mat = new StandardMaterial('terrainMat', this.scene);
    const plugin = new BunkerGrassExclusionPlugin(mat);
    plugin.groundColorTex = this.pbrGrassColorTex;
    plugin.fallbackSplatTex = this.splatTexture;
    plugin.groundBaseColor = Color3.FromHexString(this.groundBaseColor);
    plugin.enableGroundColorTex = this.groundEnableBaseColorTex;
    this.groundShaderPlugin = plugin;

    this.pbrGrassColorTex.onLoadObservable.addOnce(() => {
      this.terrainMaterial?.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial?.resetDrawCache();
    });

    mat.diffuseTexture = this.splatTexture;
    mat.bumpTexture = this.groundEnableNormalTex ? this.pbrGrassNormalTex : null;
    mat.specularTexture = this.groundEnableRoughnessTex ? this.pbrGrassRoughTex : null;
    (mat as any)._origGroundBumpTex = this.pbrGrassNormalTex;
    if (mat.detailMap) {
      // Dedicated fine grass-blade detail for course features (fairway, green, tee, fringe, first-cut)
      mat.detailMap.texture = this.highResGrassDetailTex;
      mat.detailMap.isEnabled = true;
      mat.detailMap.diffuseBlendLevel = this.groundDetailBlendLevel;
      mat.detailMap.roughnessBlendLevel = 0.50;
      mat.detailMap.bumpLevel = 0.0;
    }

    mat.backFaceCulling = false;
    mesh.material = mat;
    this.terrainMaterial = mat;
    this.applyTerrainSpecularState(this.groundSpecularColor, this.groundSpecularPower, this.groundEnableRoughnessTex);

    // Trigger reload of photo patterns into the newly created textures
    this.initHighResPhotoPatterns();
    this.redrawSplatTexture();
    this.rebuildMesh();

    return mesh;
  }

  /**
   * Applies specular/roughness state cleanly; specularPower === 0 disables specular highlights completely.
   */
  private applyTerrainSpecularState(
    specularColorHex: string,
    specularPower: number,
    enableRoughnessTex: boolean
  ) {
    if (!this.terrainMaterial) return;
    if (specularPower <= 0 || !enableRoughnessTex) {
      this.terrainMaterial.specularTexture = null;
      this.terrainMaterial.specularColor = Color3.Black();
      this.terrainMaterial.specularPower = Math.max(1, specularPower);
    } else {
      this.terrainMaterial.specularTexture = this.pbrGrassRoughTex;
      this.terrainMaterial.specularColor = Color3.FromHexString(specularColorHex);
      this.terrainMaterial.specularPower = specularPower;
    }
  }

  private scheduleGroundSplatRedraw() {
    if (this.groundSplatRaf !== null) return;
    this.groundSplatRaf = requestAnimationFrame(() => {
      this.groundSplatRaf = null;
      this.redrawSplatTexture();
    });
  }

  public setGroundUvSettings(settings: {
    baseColor?: string;
    specularColor?: string;
    specularPower?: number;
    uScale?: number;
    vScale?: number;
    uOffset?: number;
    vOffset?: number;
    normalLevel?: number;
    detailBlendLevel?: number;
    enableBaseColorTex?: boolean;
    enableRoughnessTex?: boolean;
    enableNormalTex?: boolean;
  }) {
    let needsSplatRedraw = false;
    if (settings.baseColor !== undefined && settings.baseColor !== this.groundBaseColor) {
      this.groundBaseColor = settings.baseColor;
      needsSplatRedraw = true;
    }
    if (settings.enableBaseColorTex !== undefined && !!settings.enableBaseColorTex !== this.groundEnableBaseColorTex) {
      this.groundEnableBaseColorTex = !!settings.enableBaseColorTex;
      needsSplatRedraw = true;
    }
    if (settings.uScale !== undefined) {
      this.groundUvScaleU = settings.uScale;
    }
    if (settings.vScale !== undefined) {
      this.groundUvScaleV = settings.vScale;
    }
    if (settings.uOffset !== undefined) {
      this.groundUvOffsetU = settings.uOffset;
    }
    if (settings.vOffset !== undefined) {
      this.groundUvOffsetV = settings.vOffset;
    }
    if (settings.specularColor !== undefined) this.groundSpecularColor = settings.specularColor;
    if (settings.specularPower !== undefined) this.groundSpecularPower = settings.specularPower;
    if (settings.normalLevel !== undefined) this.groundNormalLevel = settings.normalLevel;
    if (settings.detailBlendLevel !== undefined) this.groundDetailBlendLevel = settings.detailBlendLevel;
    if (settings.enableRoughnessTex !== undefined) this.groundEnableRoughnessTex = !!settings.enableRoughnessTex;
    if (settings.enableNormalTex !== undefined) this.groundEnableNormalTex = !!settings.enableNormalTex;

    const applyUv = (t: Texture | null) => {
      if (!t) return;
      t.uScale = this.groundUvScaleU;
      t.vScale = this.groundUvScaleV;
      t.uOffset = this.groundUvOffsetU;
      t.vOffset = this.groundUvOffsetV;
    };

    applyUv(this.pbrGrassNormalTex);
    applyUv(this.pbrGrassColorTex);
    applyUv(this.pbrGrassRoughTex);

    if (this.groundShaderPlugin) {
      this.groundShaderPlugin.groundColorTex = this.pbrGrassColorTex;
      this.groundShaderPlugin.groundBaseColor = Color3.FromHexString(this.groundBaseColor);
      this.groundShaderPlugin.enableGroundColorTex = this.groundEnableBaseColorTex;
    }

    const safeNormalLevel = Math.max(0.0001, this.groundNormalLevel);
    if (this.pbrGrassNormalTex) {
      this.pbrGrassNormalTex.level = safeNormalLevel;
    }
    if (this.terrainMaterial) {
      if (!this.groundEnableNormalTex) {
        if (this.terrainMaterial.bumpTexture) {
          (this.terrainMaterial as any)._origGroundBumpTex = this.terrainMaterial.bumpTexture;
        }
        this.terrainMaterial.bumpTexture = null;
      } else {
        const tex = this.pbrGrassNormalTex || (this.terrainMaterial as any)._origGroundBumpTex;
        if (tex) {
          tex.level = safeNormalLevel;
          applyUv(tex);
          this.terrainMaterial.bumpTexture = tex;
        }
      }

      this.applyTerrainSpecularState(
        this.groundSpecularColor,
        this.groundSpecularPower,
        this.groundEnableRoughnessTex
      );
      if (this.terrainMaterial.specularTexture) {
        applyUv(this.terrainMaterial.specularTexture as Texture);
      }

      if (this.terrainMaterial.detailMap) {
        this.terrainMaterial.detailMap.texture = this.highResGrassDetailTex;
        this.terrainMaterial.detailMap.diffuseBlendLevel = this.groundDetailBlendLevel;
        this.terrainMaterial.detailMap.bumpLevel = 0.0;
      }
      this.terrainMaterial.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial.resetDrawCache();
    }

    if (needsSplatRedraw) {
      this.scheduleGroundSplatRedraw();
    }
  }

  public getGroundUvSettings() {
    return {
      baseColor: this.groundBaseColor,
      specularColor: this.groundSpecularColor,
      specularPower: this.groundSpecularPower,
      uScale: this.groundUvScaleU,
      vScale: this.groundUvScaleV,
      uOffset: this.groundUvOffsetU,
      vOffset: this.groundUvOffsetV,
      normalLevel: this.groundNormalLevel,
      detailBlendLevel: this.groundDetailBlendLevel,
      enableBaseColorTex: this.groundEnableBaseColorTex,
      enableRoughnessTex: this.groundEnableRoughnessTex,
      enableNormalTex: this.groundEnableNormalTex,
      colorMapUrl: this.groundCustomTextureUrls.color || '/textures/pbr_grass/grass_pbr_diff.jpg',
      colorMapName: this.groundCustomTextureUrls.colorName || 'grass_pbr_diff.jpg',
      roughnessMapUrl: this.groundCustomTextureUrls.roughness || '/textures/pbr_grass/grass_pbr_rough.jpg',
      roughnessMapName: this.groundCustomTextureUrls.roughnessName || 'grass_pbr_rough.jpg',
      normalMapUrl: this.groundCustomTextureUrls.normal || '/textures/pbr_grass/grass_pbr_nor.jpg',
      normalMapName: this.groundCustomTextureUrls.normalName || 'grass_pbr_nor.jpg'
    };
  }

  public resetGroundMaterial() {
    this.groundUvScaleU = 110;
    this.groundUvScaleV = 230;
    this.groundUvOffsetU = 0.0;
    this.groundUvOffsetV = 0.0;
    this.groundNormalLevel = 0.45;
    this.groundDetailBlendLevel = 0.50;
    this.groundBaseColor = '#ffffff';
    this.groundSpecularColor = '#0a0d08';
    this.groundSpecularPower = 36;
    this.groundEnableBaseColorTex = true;
    this.groundEnableRoughnessTex = true;
    this.groundEnableNormalTex = true;
    this.groundCustomTextureUrls = {};

    if (this.defaultRoughPhotoTile) {
      this.roughPhotoTile = this.defaultRoughPhotoTile;
    }

    const prevNormal = this.pbrGrassNormalTex;
    const prevColor = this.pbrGrassColorTex;
    const prevRough = this.pbrGrassRoughTex;

    this.pbrGrassNormalTex = new Texture('/textures/pbr_grass/grass_pbr_nor_disp_2k.png', this.scene);
    this.pbrGrassNormalTex.anisotropicFilteringLevel = 16;
    this.pbrGrassColorTex = new Texture('/textures/pbr_grass/grass_pbr_diff.jpg', this.scene);
    this.pbrGrassColorTex.anisotropicFilteringLevel = 16;
    this.pbrGrassRoughTex = new Texture('/textures/pbr_grass/grass_pbr_rough.jpg', this.scene);
    this.pbrGrassRoughTex.anisotropicFilteringLevel = 16;

    if (this.groundShaderPlugin) {
      this.groundShaderPlugin.groundColorTex = this.pbrGrassColorTex;
      this.groundShaderPlugin.groundBaseColor = Color3.White();
      this.groundShaderPlugin.enableGroundColorTex = true;
    }
    this.pbrGrassColorTex.onLoadObservable.addOnce(() => {
      this.terrainMaterial?.markAsDirty(Material.TextureDirtyFlag);
      this.terrainMaterial?.resetDrawCache();
    });

    if (this.terrainMaterial) {
      (this.terrainMaterial as any)._origGroundBumpTex = this.pbrGrassNormalTex;
      this.terrainMaterial.bumpTexture = this.pbrGrassNormalTex;
      this.terrainMaterial.specularTexture = this.pbrGrassRoughTex;
      if (this.terrainMaterial.detailMap) {
        this.terrainMaterial.detailMap.texture = this.highResGrassDetailTex;
      }
    }

    if (prevNormal && prevNormal !== this.pbrGrassNormalTex) prevNormal.dispose();
    if (prevColor && prevColor !== this.pbrGrassColorTex) prevColor.dispose();
    if (prevRough && prevRough !== this.pbrGrassRoughTex) prevRough.dispose();

    this.setGroundUvSettings({
      uScale: 110,
      vScale: 230,
      uOffset: 0.0,
      vOffset: 0.0,
      normalLevel: 0.45,
      detailBlendLevel: 0.50,
      baseColor: '#ffffff',
      specularColor: '#0a0d08',
      specularPower: 36,
      enableBaseColorTex: true,
      enableRoughnessTex: true,
      enableNormalTex: true
    });
    this.redrawSplatTexture();
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

    const roughSource = this.roughPhotoTile || tiles.rough;
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

    // Compute mean edge-transition RGB for Main Ground (actual crisp 4K ground pixels are sampled on GPU)
    let avgR = 76;
    let avgG = 116;
    let avgB = 48;
    const tint = Color3.FromHexString(this.groundBaseColor);
    if (!this.groundEnableBaseColorTex) {
      const hex = this.groundBaseColor.toLowerCase() !== '#ffffff' ? this.groundBaseColor : '#4c7430';
      const solid = Color3.FromHexString(hex);
      avgR = Math.round(solid.r * 255);
      avgG = Math.round(solid.g * 255);
      avgB = Math.round(solid.b * 255);
    } else if (roughSource && roughSource.width > 0 && roughSource.height > 0) {
      try {
        const tiny = document.createElement('canvas');
        tiny.width = 8;
        tiny.height = 8;
        const tCtx = tiny.getContext('2d');
        if (tCtx) {
          tCtx.drawImage(roughSource, 0, 0, 8, 8);
          const data = tCtx.getImageData(0, 0, 8, 8).data;
          let rSum = 0, gSum = 0, bSum = 0;
          const n = 64;
          for (let i = 0; i < n * 4; i += 4) {
            rSum += data[i];
            gSum += data[i + 1];
            bSum += data[i + 2];
          }
          avgR = Math.max(0, Math.min(255, Math.round((rSum / n) * tint.r)));
          avgG = Math.max(0, Math.min(255, Math.round((gSum / n) * tint.g)));
          avgB = Math.max(0, Math.min(255, Math.round((bSum / n) * tint.b)));
        }
      } catch {
        // Ignore tainted-canvas fallback cleanly
      }
    }

    // Main Ground uses alpha = 0.502 (featureBlend = 0.0 in BunkerGrassExclusionPlugin -> pure GPU 4K texture);
    // stamped course features draw at alpha = 1.0 (featureBlend = 1.0), preserving seamless feathered collars.
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = `rgba(${avgR}, ${avgG}, ${avgB}, 0.502)`;
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

  private generateBunkerContourPoints(
    halfW: number,
    halfL: number,
    scale: number,
    offsetMeters: number,
    shapeIndex: number,
    segs = 256
  ): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < segs; i++) {
      const theta = (i / segs) * Math.PI * 2;
      const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIndex);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const baseRad = Math.hypot(halfW * cosT, halfL * sinT) * k;
      const rSand = baseRad * scale;
      const rTotal = rSand + offsetMeters;
      const ratio = rTotal / Math.max(0.001, rSand);
      pts.push({
        x: cosT * halfW * k * scale * ratio,
        z: sinT * halfL * k * scale * ratio
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
   * Detects what underlying golf feature (Green, Fairway, or Rough) a bunker is placed on
   * so its lip bank and blend section adapt seamlessly to the host surface.
   */
  public detectBunkerHostSurface(
    centerX: number,
    centerZ: number,
    halfW: number,
    halfL: number
  ): SurfaceType {
    const rCheck = Math.max(halfW, halfL) + 2.8;

    // 1. Proximity check against all Green features
    for (const feat of this.stampedFeatures) {
      if (feat.surfaceType === SurfaceType.GREEN) {
        const dx = centerX - feat.centerX;
        const dz = centerZ - feat.centerZ;
        const greenR = Math.max(feat.width, feat.length) * 0.5 + 3.5;
        if (Math.hypot(dx, dz) <= greenR + rCheck) {
          return SurfaceType.GREEN;
        }
      }
    }

    // 2. Proximity check against Fairway splines
    for (const feat of this.stampedFeatures) {
      if (feat.surfaceType === SurfaceType.FAIRWAY && feat.doglegPoints && feat.doglegPoints.length >= 4) {
        const samples = 28;
        for (let s = 0; s <= samples; s++) {
          const sp = this.evaluateSpline(feat.doglegPoints, s / samples);
          const d = Math.hypot(centerX - sp.x, centerZ - sp.z);
          if (d <= Math.max(sp.leftW, sp.rightW) + rCheck) {
            return SurfaceType.FAIRWAY;
          }
        }
      }
    }

    return SurfaceType.ROUGH;
  }

  /**
   * Evaluates vertex alpha mask (0.0 = pure sand bed, 1.0 = grass).
   * Used by BunkerGrassExclusionPlugin to completely exclude grass blades, straw,
   * grass normal bumps, and grass displacement from the sand material of all bunkers.
   */
  public getGrassMaskAt(wx: number, wz: number): number {
    let minGrass = 1.0;
    for (const feat of this.stampedFeatures) {
      if (feat.surfaceType !== SurfaceType.BUNKER) continue;
      const halfW = feat.width * 0.5;
      const halfL = feat.length * 0.5;
      const dx = wx - feat.centerX;
      const dz = wz - feat.centerZ;
      const maxR = Math.max(halfW, halfL) * 1.6;
      if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) continue;

      const cosR = Math.cos(-feat.rotationRad);
      const sinR = Math.sin(-feat.rotationRad);
      const lx = dx * cosR - dz * sinR;
      const lz = dx * sinR + dz * cosR;
      const shapeIdx = feat.bunkerShapeIndex ?? 0;
      const theta = Math.atan2(lz / Math.max(1, halfL), lx / Math.max(1, halfW));
      const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIdx);
      const baseRad = Math.hypot(halfW * Math.cos(theta), halfL * Math.sin(theta)) * k;
      const rMeters = Math.hypot(lx, lz);
      const rSand = baseRad * 0.78;
      const lipWidth = 1.20;

      if (rMeters <= rSand) {
        return 0.0;
      } else if (rMeters <= rSand + lipWidth) {
        const t = (rMeters - rSand) / lipWidth;
        const ramp = 0.5 * (1.0 - Math.cos(t * Math.PI));
        minGrass = Math.min(minGrass, ramp);
      }
    }
    return minGrass;
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
    fringePattern: CanvasPattern,
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

    // Smooth 180-deg rounded end-cap at the green end (t = 1) across full fairway width
    const spEnd = this.evaluateSpline(points, 1.0);
    const nEndX = -spEnd.tz;
    const nEndZ = spEnd.tx;
    const rEnd = (spEnd.leftW + spEnd.rightW) * 0.5;
    const dEnd = rEnd * 0.70;
    const capSegs = 36;
    for (let k = 1; k < capSegs; k++) {
      const phi = (k / capSegs) * Math.PI;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const curW = spEnd.leftW * (1 - k / capSegs) + spEnd.rightW * (k / capSegs);
      fairwayLoopMeters.push({
        x: spEnd.x + nEndX * (cosP * curW) + spEnd.tx * (sinP * dEnd),
        z: spEnd.z + nEndZ * (cosP * curW) + spEnd.tz * (sinP * dEnd)
      });
    }

    for (let i = samples; i >= 0; i--) {
      fairwayLoopMeters.push(rightPtsMeters[i]);
    }

    // Smooth 180-deg rounded end-cap at the tee end (t = 0) across full fairway width
    const spStart = this.evaluateSpline(points, 0.0);
    const nStartX = -spStart.tz;
    const nStartZ = spStart.tx;
    const rStart = (spStart.leftW + spStart.rightW) * 0.5;
    const dStart = rStart * 0.70;
    for (let k = 1; k < capSegs; k++) {
      const phi = (k / capSegs) * Math.PI;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const curW = spStart.rightW * (1 - k / capSegs) + spStart.leftW * (k / capSegs);
      fairwayLoopMeters.push({
        x: spStart.x - nStartX * (cosP * curW) - spStart.tx * (sinP * dStart),
        z: spStart.z - nStartZ * (cosP * curW) - spStart.tz * (sinP * dStart)
      });
    }

    // Soft, organic feathered blend and uniform First-Cut / Fringe collar around fairway loop
    const tiles = TerrainGrid.patternTiles!;
    const fairwayFeat = this.stampedFeatures.find(f => f.doglegPoints === points);
    const fairwayMat = fairwayFeat?.materialSettings || this.getDefaultFeatureMaterial(SurfaceType.FAIRWAY);

    if (fairwayMat.showCollarRings !== false) {
      const fringeWidth = fairwayMat.collarWidth ?? 2.0;
      const firstCutWidth = fringeWidth * 2.1;

      const fairwayBlendOuter = this.computeUniformOffsetPolygon(fairwayLoopMeters, firstCutWidth + 0.8);
      this.traceLocalMeterPolygon(ctx, fairwayBlendOuter, 0, 0, 0, sX, sZ);
      ctx.strokeStyle = 'rgba(68, 105, 42, 0.28)';
      ctx.lineWidth = 10 * sX;
      ctx.lineJoin = 'round';
      ctx.stroke();

      const fairwayBlendMid = this.computeUniformOffsetPolygon(fairwayLoopMeters, firstCutWidth + 0.2);
      this.traceLocalMeterPolygon(ctx, fairwayBlendMid, 0, 0, 0, sX, sZ);
      ctx.strokeStyle = 'rgba(78, 118, 48, 0.38)';
      ctx.lineWidth = 6 * sX;
      ctx.stroke();

      // 1. Continuous Uniform First-Cut Ring surrounding the entire fairway loop
      // Strictly constant uniform width everywhere with ZERO pinching at joins or ends!
      const fairwayFirstCutRing = this.computeUniformOffsetPolygon(fairwayLoopMeters, firstCutWidth);
      this.traceLocalMeterPolygon(ctx, fairwayFirstCutRing, 0, 0, 0, sX, sZ);
      ctx.fillStyle = firstCutPattern;
      ctx.fill();

      // 1b. Continuous Uniform Fringe Ring surrounding the fairway loop
      const fairwayFringeRing = this.computeUniformOffsetPolygon(fairwayLoopMeters, fringeWidth);
      this.traceLocalMeterPolygon(ctx, fairwayFringeRing, 0, 0, 0, sX, sZ);
      ctx.fillStyle = fringePattern;
      ctx.fill();
    }

    // 2. Continuous AAA Dogleg Fairway Body
    this.traceLocalMeterPolygon(ctx, fairwayLoopMeters, 0, 0, 0, sX, sZ);
    if (fairwayMat.enableBaseColorTex === false) {
      ctx.fillStyle = fairwayMat.baseColor || '#38b000';
      ctx.fill();
    } else {
      const fairwayTile = fairwayFeat?.customTile || tiles.fairway;
      const fX = (fairwayFeat ? fairwayFeat.centerX : 110) * sX;
      const fZ = (fairwayFeat ? fairwayFeat.centerZ : 200) * sZ;
      const customFairwayPat = this.getTransformedFeaturePattern(ctx, fairwayTile, 0.25, fairwayMat, fX, fZ);
      ctx.fillStyle = customFairwayPat;
      ctx.fill();
      if (fairwayMat.baseColor) {
        ctx.save();
        this.traceLocalMeterPolygon(ctx, fairwayLoopMeters, 0, 0, 0, sX, sZ);
        ctx.fillStyle = fairwayMat.baseColor;
        ctx.globalAlpha = 0.30;
        ctx.fill();
        ctx.restore();
      }
    }

    // 3. Championship Mowing Stripes clipped cleanly inside the organic fairway contour
    if (fairwayMat.showMowingStripes !== false) {
      ctx.save();
      this.traceLocalMeterPolygon(ctx, fairwayLoopMeters, 0, 0, 0, sX, sZ);
      ctx.clip();

      const stripeStepMeters = Math.max(1.0, fairwayMat.mowingStripeWidth || 4.6);
      const stripeStep = stripeStepMeters * sZ;
      const contrast = fairwayMat.mowingStripeContrast !== undefined ? fairwayMat.mowingStripeContrast : 0.5;
      const opLight = (0.02 + 0.10 * contrast).toFixed(3);
      const opDark = (0.015 + 0.08 * contrast).toFixed(3);
      for (let z = 45 * sZ; z <= 370 * sZ; z += stripeStep * 2) {
        ctx.fillStyle = `rgba(225, 255, 180, ${opLight})`;
        ctx.fillRect(0, z, 220 * sX, stripeStep);
        ctx.fillStyle = `rgba(10, 35, 8, ${opDark})`;
        ctx.fillRect(0, z + stripeStep, 220 * sX, stripeStep);
      }
      ctx.restore();
    }
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
    const tiles = TerrainGrid.patternTiles!;
    if (feat.doglegPoints && feat.doglegPoints.length >= 4) {
      this.drawDoglegFairwayOnCanvas(
        ctx,
        feat.doglegPoints,
        sX,
        sZ,
        patterns.firstCutPattern,
        patterns.fringePattern,
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
      const featMat = feat.materialSettings || this.getDefaultFeatureMaterial(feat.surfaceType);
      const baseGreenPts = this.generateEllipseMeterPoints(halfW, halfL, 160);

      if (featMat.showCollarRings !== false) {
        const fringeWidth = featMat.collarWidth ?? 2.2;
        const firstCutWidth = fringeWidth * 2.0;
        const fringeRingPts = this.computeUniformOffsetPolygon(baseGreenPts, fringeWidth);
        const firstCutRingPts = this.computeUniformOffsetPolygon(baseGreenPts, firstCutWidth);

        // Soft, organic feathered blend from the green outer first-cut/fringe into the surrounding grass PBR terrain
        const greenBlendOuter = this.computeUniformOffsetPolygon(baseGreenPts, firstCutWidth + 0.8);
        this.traceLocalMeterPolygon(ctx, greenBlendOuter, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.strokeStyle = 'rgba(68, 105, 42, 0.28)';
        ctx.lineWidth = 10 * sX;
        ctx.lineJoin = 'round';
        ctx.stroke();

        const greenBlendMid = this.computeUniformOffsetPolygon(baseGreenPts, firstCutWidth + 0.2);
        this.traceLocalMeterPolygon(ctx, greenBlendMid, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.strokeStyle = 'rgba(78, 118, 48, 0.38)';
        ctx.lineWidth = 6 * sX;
        ctx.stroke();

        // 1. Uniform First-Cut outer ring around the entire green perimeter
        this.traceLocalMeterPolygon(ctx, firstCutRingPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.fillStyle = patterns.firstCutPattern;
        ctx.fill();

        // 2. Continuous 360-degree Uniform Fringe ring around the entire green perimeter (no gaps)
        this.traceLocalMeterPolygon(ctx, fringeRingPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.fillStyle = patterns.fringePattern;
        ctx.fill();
        ctx.strokeStyle = 'rgba(18, 52, 16, 0.28)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // 3. Championship Green Putting Surface
      this.traceLocalMeterPolygon(ctx, baseGreenPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      if (featMat.enableBaseColorTex === false) {
        ctx.fillStyle = featMat.baseColor || '#28a745';
        ctx.fill();
      } else {
        const greenTile = feat.customTile || tiles.green;
        const customGreenPat = this.getTransformedFeaturePattern(ctx, greenTile, 0.25, featMat, feat.centerX * sX, feat.centerZ * sZ);
        ctx.fillStyle = customGreenPat;
        ctx.fill();
        if (featMat.baseColor) {
          ctx.save();
          this.traceLocalMeterPolygon(ctx, baseGreenPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
          ctx.fillStyle = featMat.baseColor;
          ctx.globalAlpha = 0.35;
          ctx.fill();
          ctx.restore();
        }
      }

      if (featMat.showMowingStripes !== false) {
        ctx.save();
        this.traceLocalMeterPolygon(ctx, baseGreenPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.clip();

        const greenStripeMeters = Math.max(0.5, featMat.mowingStripeWidth || 1.8);
        const greenStripe = greenStripeMeters * sZ;
        const gCount = Math.ceil((halfL * 2) / greenStripeMeters);
        const minZ = (feat.centerZ - halfL * 1.4) * sZ;
        const minX = (feat.centerX - halfW * 1.4) * sX;
        const spanX = halfW * 2.8 * sX;
        const contrast = featMat.mowingStripeContrast !== undefined ? featMat.mowingStripeContrast : 0.5;
        const opLight = (0.015 + 0.08 * contrast).toFixed(3);
        const opDark = (0.01 + 0.07 * contrast).toFixed(3);
        for (let i = 0; i <= gCount * 2; i++) {
          ctx.fillStyle = i % 2 === 0 ? `rgba(215, 255, 195, ${opLight})` : `rgba(10, 45, 18, ${opDark})`;
          ctx.fillRect(minX, minZ + i * greenStripe, spanX, greenStripe);
        }
        ctx.restore();
      }

    } else if (feat.surfaceType === SurfaceType.BUNKER) {
      // Tournament bunker with defined revetted sod lip & blend section that adapts to host surface
      const featMat = feat.materialSettings || this.getDefaultFeatureMaterial(feat.surfaceType);
      const shapeIdx = feat.bunkerShapeIndex ?? 0;
      const hostSurface = this.detectBunkerHostSurface(feat.centerX, feat.centerZ, halfW, halfL);

      const lipWidth = featMat.collarWidth ?? 1.20;
      const blendWidth = lipWidth * 1.15;
      const baseSandPts = this.generateBunkerContourPoints(halfW, halfL, 0.78, 0, shapeIdx, 256);

      if (featMat.showCollarRings !== false) {
        const lipPts = this.computeUniformOffsetPolygon(baseSandPts, lipWidth);
        const blendPts = this.computeUniformOffsetPolygon(baseSandPts, lipWidth + blendWidth);

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // 1. Blend section matching host surface
        this.traceLocalMeterPolygon(ctx, blendPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        if (hostSurface === SurfaceType.GREEN || hostSurface === SurfaceType.FRINGE) {
          ctx.fillStyle = patterns.fringePattern;
        } else if (hostSurface === SurfaceType.FAIRWAY) {
          ctx.fillStyle = patterns.fairwayPattern;
        } else {
          ctx.fillStyle = patterns.firstCutPattern;
        }
        ctx.fill();

        // 2. Defined revetted sod lip bank (uniform fringe turf ring)
        this.traceLocalMeterPolygon(ctx, lipPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.fillStyle = patterns.fringePattern;
        ctx.fill();

        // Subtle crisp sod cut line defining the lip edge
        ctx.strokeStyle = 'rgba(20, 50, 16, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 3. Pure seamless tournament sand bed inside the bunker basin
      this.traceLocalMeterPolygon(ctx, baseSandPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      if (featMat.enableBaseColorTex === false) {
        ctx.fillStyle = featMat.baseColor || '#d8c28a';
        ctx.fill();
      } else {
        const sandTile = this.sandPhotoTile || tiles.sand;
        const customSandPat = this.getTransformedFeaturePattern(ctx, sandTile, 0.32, featMat, feat.centerX * sX, feat.centerZ * sZ);
        ctx.fillStyle = customSandPat;
        ctx.fill();
        if (featMat.baseColor) {
          ctx.save();
          this.traceLocalMeterPolygon(ctx, baseSandPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
          ctx.fillStyle = featMat.baseColor;
          ctx.globalAlpha = 0.30;
          ctx.fill();
          ctx.restore();
        }
      }

    } else if (feat.surfaceType === SurfaceType.TEE) {
      const featMat = feat.materialSettings || this.getDefaultFeatureMaterial(feat.surfaceType);
      // Base inside Tee Box plateau (0.90x) in local meters with narrower fringe & first-cut rings
      const baseTeePts = this.generateEllipseMeterPoints(halfW * 0.90, halfL * 0.90, 144);
      const collarW = featMat.collarWidth ?? 0.48;
      const teeFringePts = this.computeUniformOffsetPolygon(baseTeePts, collarW);
      const teeFirstCutPts = this.computeUniformOffsetPolygon(baseTeePts, collarW * 2.04);

      // 1 & 2. Uniform Outer First-Cut and Fringe rings (Only drawn if featMat.showCollarRings !== false)
      if (featMat.showCollarRings !== false) {
        this.traceLocalMeterPolygon(ctx, teeFirstCutPts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.fillStyle = patterns.firstCutPattern;
        ctx.fill();

        this.traceLocalMeterPolygon(ctx, teeFringePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.fillStyle = patterns.fringePattern;
        ctx.fill();
        ctx.strokeStyle = 'rgba(18, 52, 16, 0.28)';
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }

      // 3. Inside Tee Box surface with short_grass_01.jpg texture or custom uploaded tile
      this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
      if (featMat.enableBaseColorTex === false) {
        ctx.fillStyle = featMat.baseColor || '#43a047';
        ctx.fill();
      } else {
        const teeTile = feat.customTile || this.teePhotoTile || tiles.green;
        const customTeePat = this.getTransformedFeaturePattern(ctx, teeTile, 0.30, featMat, feat.centerX * sX, feat.centerZ * sZ);
        ctx.fillStyle = customTeePat;
        ctx.fill();
        if (featMat.baseColor) {
          ctx.save();
          this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
          ctx.fillStyle = featMat.baseColor;
          ctx.globalAlpha = 0.30;
          ctx.fill();
          ctx.restore();
        }
      }

      // 4. Subtle championship tee-box mowing stripes clipped inside the tee plateau
      if (featMat.showMowingStripes !== false) {
        ctx.save();
        this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.clip();
        const stripeWidthMeters = Math.max(0.4, featMat.mowingStripeWidth || 1.6);
        const teeStripe = stripeWidthMeters * sX;
        const minX = (feat.centerX - halfW * 1.2) * sX;
        const minZ = (feat.centerZ - halfL * 1.2) * sZ;
        const spanZ = halfL * 2.4 * sZ;
        const tCount = Math.ceil((halfW * 2.4) / stripeWidthMeters);
        const contrast = featMat.mowingStripeContrast !== undefined ? featMat.mowingStripeContrast : 0.5;
        const opLight = (0.015 + 0.08 * contrast).toFixed(3);
        const opDark = (0.01 + 0.07 * contrast).toFixed(3);
        for (let i = 0; i <= tCount; i++) {
          ctx.fillStyle = i % 2 === 0 ? `rgba(220, 255, 195, ${opLight})` : `rgba(12, 42, 14, ${opDark})`;
          ctx.fillRect(minX + i * teeStripe, minZ, teeStripe, spanZ);
        }
        ctx.restore();
      }

      if (featMat.showCollarRings !== false) {
        this.traceLocalMeterPolygon(ctx, baseTeePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.strokeStyle = 'rgba(25, 68, 22, 0.32)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

    } else if (feat.surfaceType === SurfaceType.WATER) {
      const featMat = feat.materialSettings || this.getDefaultFeatureMaterial(feat.surfaceType);
      // Base water edge at 0.95 matches the 3D water mesh & analytical shoreline 1:1
      const baseWaterPts = this.generateEllipseMeterPoints(halfW * 0.95, halfL * 0.95, 160);
      const fringeWidth = featMat.collarWidth ?? 2.15;
      const waterFringePts = this.computeUniformOffsetPolygon(baseWaterPts, fringeWidth);
      const shoreBankPts = this.computeUniformOffsetPolygon(baseWaterPts, Math.min(fringeWidth * 0.35, 0.72));
      const deepBedPts = this.computeUniformOffsetPolygon(baseWaterPts, -1.65);

      if (featMat.showCollarRings !== false) {
        // 1. Uniform Water Fringe collar around the pond bank
        this.traceLocalMeterPolygon(ctx, waterFringePts, feat.centerX, feat.centerZ, feat.rotationRad, sX, sZ);
        ctx.fillStyle = patterns.fringePattern;
        ctx.fill();
      }

      // 2. Uniform natural moist stone/pebble shoreline bank ring
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
  public rebuildMesh(isDraft: boolean = false) {
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

    if (!isDraft) {
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
                const shapeIdx = feat.bunkerShapeIndex ?? 0;
                const theta = Math.atan2(lz / Math.max(1, halfL), lx / Math.max(1, halfW));
                const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIdx);
                const baseRad = Math.hypot(halfW * Math.cos(theta), halfL * Math.sin(theta)) * k;
                const rMeters = Math.hypot(lx, lz);
                const rBlend = baseRad * 0.78 + 2.60;
                if (rMeters <= rBlend + 1.2) {
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
        let ny = Math.max(0.72, 1.0);
        let nz = (hD - hU) * 0.5;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;

        this.normals[pIdx] = nx / len;
        this.normals[pIdx + 1] = ny / len;
        this.normals[pIdx + 2] = nz / len;

        let cavityAO = 1.0;
        if (!isDraft && this.surfaceTypes[vIdx] !== SurfaceType.BUNKER && this.surfaceTypes[vIdx] !== SurfaceType.FRINGE) {
          const laplacian = ((hL + hR + hD + hU) * 0.25) - hC;
          cavityAO = Math.max(0.94, Math.min(1.02, 1.0 - laplacian * 0.06));
        }
        this.colors[cIdx] = cavityAO;
        this.colors[cIdx + 1] = cavityAO;
        this.colors[cIdx + 2] = cavityAO;
        this.colors[cIdx + 3] = this.getGrassMaskAt(x, z);
      }
    }

    // 4. Emit regular 1m cells and 0.25m subdivided Tee/Bunker cells into the single mesh
    let nextV = baseVerts;
    let iIdx = 0;
    const eps = 0.35;

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
              // Clamp upward component so steep bunker lip slopes receive adequate direct and ambient light
              let ny = Math.max(0.65, 1.0);
              let nz = (hD - hU) / (2 * eps);
              const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;

              this.normals[pIdx] = nx / len;
              this.normals[pIdx + 1] = ny / len;
              this.normals[pIdx + 2] = nz / len;

              this.colors[cIdx] = 1.0;
              this.colors[cIdx + 1] = 1.0;
              this.colors[cIdx + 2] = 1.0;
              this.colors[cIdx + 3] = this.getGrassMaskAt(wx, wz);

              nextV++;
            }
          }

          for (let iv = 0; iv < 4; iv++) {
            for (let iu = 0; iu < 4; iu++) {
              const i00 = cellStartV + iv * 5 + iu;
              const i10 = i00 + 1;
              const i01 = i00 + 5;
              const i11 = i01 + 1;

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

    const vertexData = new VertexData();
    vertexData.positions = this.positions;
    vertexData.normals = this.normals;
    vertexData.uvs = this.uvs;
    vertexData.colors = this.colors;
    vertexData.indices = this.indices;
    vertexData.applyToMesh(this.terrainMesh, true);
  }
}
