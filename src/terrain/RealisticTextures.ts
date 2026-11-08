import {
  Scene,
  DynamicTexture,
  Texture
} from '@babylonjs/core';

/**
 * Generates high-resolution, mathematically seamless (toroidally tileable)
 * procedural PBR/Standard textures and 3D normal maps for grass, sand, water,
 * bark, foliage, rock, and golf ball dimples.
 */
export class RealisticTextures {
  private static wrapCoord(v: number, size: number): number {
    return ((v % size) + size) % size;
  }

  /**
   * Seamless deterministic 2D value noise on a toroidal grid [0..period)
   */
  private static seamlessNoise(x: number, y: number, period: number, seed: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const u = xf * xf * (3.0 - 2.0 * xf);
    const v = yf * yf * (3.0 - 2.0 * yf);

    const x0 = ((xi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y0 = ((yi % period) + period) % period;
    const y1 = (y0 + 1) % period;

    const hash = (px: number, py: number) => {
      const h = Math.sin(px * 127.1 + py * 311.7 + seed * 74.7) * 43758.5453123;
      return h - Math.floor(h);
    };

    const n00 = hash(x0, y0);
    const n10 = hash(x1, y0);
    const n01 = hash(x0, y1);
    const n11 = hash(x1, y1);

    const nx0 = n00 * (1 - u) + n10 * u;
    const nx1 = n01 * (1 - u) + n11 * u;
    return nx0 * (1 - v) + nx1 * v;
  }

  private static seamlessFBM(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;

    for (let i = 0; i < octaves; i++) {
      const p = basePeriod * freq;
      sum += this.seamlessNoise(u * p, v * p, p, seed + i * 19.3) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /**
   * Creates a seamless 256x256 HTMLCanvasElement pattern tile for a specific golf turf or sand surface.
   * Used with ctx.createPattern(canvas, 'repeat') on the high-resolution course splat map.
   */
  public static createSeamlessSurfacePattern(
    type: 'rough' | 'first_cut' | 'fairway' | 'fringe' | 'green' | 'sand' | 'water_bed'
  ): HTMLCanvasElement {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;

        const nMacro = this.seamlessFBM(u, v, 6, 3, 1.1);
        const nMid = this.seamlessFBM(u, v, 24, 3, 2.7);
        const nMicro = this.seamlessFBM(u, v, 64, 2, 5.3);

        let r = 0, g = 0, b = 0;

        if (type === 'rough') {
          // Deep lush fescue & tangled ryegrass with rich shadow pockets and olive tips
          const blade = (nMacro * 0.35 + nMid * 0.40 + nMicro * 0.25);
          r = 28 + blade * 34;
          g = 66 + blade * 54;
          b = 22 + blade * 24;
        } else if (type === 'first_cut') {
          // Dense intermediate cut bordering fairway
          const blade = (nMacro * 0.30 + nMid * 0.42 + nMicro * 0.28);
          r = 42 + blade * 36;
          g = 92 + blade * 52;
          b = 30 + blade * 25;
        } else if (type === 'fairway') {
          // Crisp tightly-mowed championship fairway turf
          const blade = (nMacro * 0.25 + nMid * 0.38 + nMicro * 0.37);
          r = 56 + blade * 38;
          g = 122 + blade * 50;
          b = 38 + blade * 26;
        } else if (type === 'fringe') {
          // Manicured collar grass around putting green
          const blade = (nMacro * 0.22 + nMid * 0.38 + nMicro * 0.40);
          r = 48 + blade * 34;
          g = 132 + blade * 46;
          b = 46 + blade * 26;
        } else if (type === 'green') {
          // Ultra-fine championship bentgrass putting surface
          const blade = (nMacro * 0.18 + nMid * 0.32 + nMicro * 0.50);
          r = 46 + blade * 30;
          g = 146 + blade * 42;
          b = 58 + blade * 24;
        } else if (type === 'sand') {
          // Realistic raked Augusta quartz bunker sand with micro rake lines & crystalline grain
          const rakeWave = Math.sin((u * 14 + v * 14 + nMacro * 0.35) * Math.PI * 2) * 0.5 + 0.5;
          const grain = nMicro * 0.55 + nMid * 0.30 + rakeWave * 0.15;
          r = 208 + grain * 42;
          g = 188 + grain * 40;
          b = 140 + grain * 36;
        } else {
          // Deep organic pond bed silt & aquatic stone
          const silt = nMacro * 0.45 + nMid * 0.35 + nMicro * 0.20;
          r = 14 + silt * 22;
          g = 38 + silt * 32;
          b = 46 + silt * 36;
        }

        data[idx] = Math.max(0, Math.min(255, Math.round(r)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Add crisp seamless overlapping grass blades for turf types
    if (type !== 'sand' && type !== 'water_bed') {
      const bladeCount = type === 'rough' ? 1800 : type === 'green' ? 2400 : 2000;
      const bladeLen = type === 'rough' ? 7 : type === 'first_cut' ? 5 : type === 'green' ? 2.5 : 4;
      ctx.lineWidth = type === 'green' ? 0.8 : 1.1;

      for (let i = 0; i < bladeCount; i++) {
        const bx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * size;
        const by = ((Math.sin(i * 78.233) * 43758.5453) % 1 + 1) % 1 * size;
        const angle = ((Math.sin(i * 45.164) * 43758.5453) % 1) * Math.PI * 2;
        const dx = Math.cos(angle) * bladeLen;
        const dy = Math.sin(angle) * bladeLen;

        const isLight = i % 2 === 0;
        ctx.strokeStyle = isLight ? 'rgba(185, 235, 110, 0.16)' : 'rgba(15, 42, 12, 0.16)';

        // Draw wrapped across all 9 toroidal offsets if near edge to guarantee 100% seamless tiling
        for (let ox = -size; ox <= size; ox += size) {
          for (let oy = -size; oy <= size; oy += size) {
            const sx = bx + ox;
            const sy = by + oy;
            if (sx >= -bladeLen && sx <= size + bladeLen && sy >= -bladeLen && sy <= size + bladeLen) {
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(sx + dx, sy + dy);
              ctx.stroke();
            }
          }
        }
      }
    }

    return canvas;
  }

  /**
   * Generates a 512x512 high-frequency seamless micro-detail texture (grass blades & crystalline grains)
   * Tiled at 110x230 across the terrain via ambientTexture so every 2m x 2m patch has 512x512 resolution (4mm/pixel)!
   */
  public static createSeamlessMicroDetailTexture(scene: Scene): DynamicTexture {
    const size = 512;
    const tex = new DynamicTexture('seamlessMicroDetail', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 16;

    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const n1 = this.seamlessFBM(u, v, 16, 2, 13.7);
        const n2 = this.seamlessFBM(u, v, 64, 2, 29.3);
        // Subtle organic variation around 0.88..1.0
        const val = Math.round((0.84 + n1 * 0.08 + n2 * 0.08) * 255);
        const idx = (y * size + x) * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw 9,000 crisp micro grass blades / sand speckles wrapped toroidally for 100% seamless tiling
    ctx.lineWidth = 1.0;
    for (let i = 0; i < 9000; i++) {
      const bx = (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1 * size;
      const by = (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1 * size;
      const angle = ((Math.sin(i * 45.164) * 43758.5453) % 1) * Math.PI * 2;
      const bladeLen = 2.5 + (i % 3) * 1.2;
      const dx = Math.cos(angle) * bladeLen;
      const dy = Math.sin(angle) * bladeLen;

      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.22)' : 'rgba(30, 35, 25, 0.20)';

      for (let ox = -size; ox <= size; ox += size) {
        for (let oy = -size; oy <= size; oy += size) {
          const sx = bx + ox;
          const sy = by + oy;
          if (sx >= -5 && sx <= size + 5 && sy >= -5 && sy <= size + 5) {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + dx, sy + dy);
            ctx.stroke();
          }
        }
      }
    }

    tex.update(true);
    return tex;
  }

  /**
   * Generates a 512x512 seamless 3D normal map for high-frequency turf blades & sand grains.
   * Tiled at high UV scale across the terrain so close-up views have razor-sharp 3D surface detail.
   */
  public static createSeamlessTurfNormalTexture(scene: Scene): DynamicTexture {
    const size = 256;
    const tex = new DynamicTexture('seamlessTurfNormal', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 16;

    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    // Precompute heightfield for finite-difference normal derivation
    const hMap = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const h =
          this.seamlessFBM(u, v, 16, 2, 10.4) * 0.35 +
          this.seamlessFBM(u, v, 48, 2, 22.8) * 0.65;
        hMap[y * size + x] = h;
      }
    }

    const strength = 3.2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xL = this.wrapCoord(x - 1, size);
        const xR = this.wrapCoord(x + 1, size);
        const yD = this.wrapCoord(y - 1, size);
        const yU = this.wrapCoord(y + 1, size);

        const dX = (hMap[y * size + xL] - hMap[y * size + xR]) * strength;
        const dY = (hMap[yD * size + x] - hMap[yU * size + x]) * strength;
        const dZ = 1.0;
        const len = Math.sqrt(dX * dX + dY * dY + dZ * dZ) || 1;

        const nx = (dX / len) * 0.5 + 0.5;
        const ny = (dY / len) * 0.5 + 0.5;
        const nz = (dZ / len) * 0.5 + 0.5;

        const idx = (y * size + x) * 4;
        data[idx] = Math.round(nx * 255);
        data[idx + 1] = Math.round(ny * 255);
        data[idx + 2] = Math.round(nz * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    tex.update(true);
    return tex;
  }

  /**
   * Generates a seamless 256x256 animated water wave 3D normal map
   */
  public static createSeamlessWaterNormalTexture(scene: Scene): DynamicTexture {
    const size = 256;
    const tex = new DynamicTexture('seamlessWaterNormal', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 8;

    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    const hMap = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        // Pure organic multi-scale FBM wind ripples (zero regular diagonal sine grid lines)
        const swell = this.seamlessFBM(u, v, 6, 3, 19.4) * 0.42;
        const breeze = this.seamlessFBM(u + 0.37, v + 0.61, 14, 3, 41.2) * 0.36;
        const micro = this.seamlessFBM(u + 0.73, v + 0.19, 28, 2, 63.8) * 0.22;
        hMap[y * size + x] = swell + breeze + micro;
      }
    }

    const strength = 2.1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xL = this.wrapCoord(x - 1, size);
        const xR = this.wrapCoord(x + 1, size);
        const yD = this.wrapCoord(y - 1, size);
        const yU = this.wrapCoord(y + 1, size);

        const dX = (hMap[y * size + xL] - hMap[y * size + xR]) * strength;
        const dY = (hMap[yD * size + x] - hMap[yU * size + x]) * strength;
        const dZ = 1.0;
        const len = Math.sqrt(dX * dX + dY * dY + dZ * dZ) || 1;

        const idx = (y * size + x) * 4;
        data[idx] = Math.round(((dX / len) * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.round(((dY / len) * 0.5 + 0.5) * 255);
        data[idx + 2] = Math.round(((dZ / len) * 0.5 + 0.5) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    tex.update(true);
    return tex;
  }

  /**
   * Generates a seamless 256x256 water surface diffuse texture with subtle light caustics
   */
  public static createSeamlessWaterDiffuseTexture(scene: Scene): DynamicTexture {
    const size = 256;
    const tex = new DynamicTexture('seamlessWaterDiffuse', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;

    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const n1 = this.seamlessFBM(u, v, 8, 3, 77.1);
        const n2 = this.seamlessFBM(u + 0.3, v + 0.2, 16, 2, 88.4);
        const caustic = Math.pow(Math.max(0, 1.0 - Math.abs(n1 - n2) * 3.2), 2) * 0.25;

        const idx = (y * size + x) * 4;
        data[idx] = Math.min(255, Math.round((0.10 + n1 * 0.06 + caustic) * 255));
        data[idx + 1] = Math.min(255, Math.round((0.36 + n1 * 0.12 + caustic) * 255));
        data[idx + 2] = Math.min(255, Math.round((0.52 + n1 * 0.14 + caustic) * 255));
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    tex.update(true);
    return tex;
  }

  /**
   * Seamless Tree Bark Texture & Normal Map
   */
  public static createSeamlessBarkTextures(scene: Scene): { diffuse: DynamicTexture; normal: DynamicTexture } {
    const size = 128;
    const diffuse = new DynamicTexture('barkDiffuse', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const normal = new DynamicTexture('barkNormal', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    diffuse.wrapU = diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
    normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;

    const dCtx = diffuse.getContext() as CanvasRenderingContext2D;
    const nCtx = normal.getContext() as CanvasRenderingContext2D;
    const dImg = dCtx.createImageData(size, size);
    const nImg = nCtx.createImageData(size, size);
    const hMap = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        // Vertical bark ridges
        const ridge = this.seamlessFBM(u, v * 0.25, 16, 3, 31.4);
        const fine = this.seamlessFBM(u, v, 32, 2, 14.9);
        const h = ridge * 0.75 + fine * 0.25;
        hMap[y * size + x] = h;

        const idx = (y * size + x) * 4;
        dImg.data[idx] = Math.round(58 + h * 52);
        dImg.data[idx + 1] = Math.round(40 + h * 36);
        dImg.data[idx + 2] = Math.round(26 + h * 24);
        dImg.data[idx + 3] = 255;
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xL = this.wrapCoord(x - 1, size);
        const xR = this.wrapCoord(x + 1, size);
        const yD = this.wrapCoord(y - 1, size);
        const yU = this.wrapCoord(y + 1, size);
        const dX = (hMap[y * size + xL] - hMap[y * size + xR]) * 3.5;
        const dY = (hMap[yD * size + x] - hMap[yU * size + x]) * 2.0;
        const len = Math.sqrt(dX * dX + dY * dY + 1) || 1;
        const idx = (y * size + x) * 4;
        nImg.data[idx] = Math.round(((dX / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 1] = Math.round(((dY / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 3] = 255;
      }
    }

    dCtx.putImageData(dImg, 0, 0);
    nCtx.putImageData(nImg, 0, 0);
    diffuse.update(true);
    normal.update(true);
    return { diffuse, normal };
  }

  /**
   * Seamless Foliage Texture & Normal Map for Pine Needles and Oak Canopies
   */
  public static createSeamlessFoliageTextures(
    scene: Scene,
    variant: 'pine' | 'oak'
  ): { diffuse: DynamicTexture; normal: DynamicTexture } {
    const size = 128;
    const diffuse = new DynamicTexture(`${variant}FoliageDiffuse`, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const normal = new DynamicTexture(`${variant}FoliageNormal`, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    diffuse.wrapU = diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
    normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;

    const dCtx = diffuse.getContext() as CanvasRenderingContext2D;
    const nCtx = normal.getContext() as CanvasRenderingContext2D;
    const dImg = dCtx.createImageData(size, size);
    const nImg = nCtx.createImageData(size, size);
    const hMap = new Float32Array(size * size);

    const seed = variant === 'pine' ? 51.2 : 93.7;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const cluster = this.seamlessFBM(u, v, 12, 3, seed);
        const leaf = this.seamlessFBM(u, v, 36, 2, seed + 7.1);
        const h = cluster * 0.55 + leaf * 0.45;
        hMap[y * size + x] = h;

        const idx = (y * size + x) * 4;
        if (variant === 'pine') {
          // Deep Augusta pine green needles
          dImg.data[idx] = Math.round(18 + h * 36);
          dImg.data[idx + 1] = Math.round(52 + h * 58);
          dImg.data[idx + 2] = Math.round(24 + h * 30);
        } else {
          // Rich sunlit deciduous oak canopy leaves
          dImg.data[idx] = Math.round(32 + h * 54);
          dImg.data[idx + 1] = Math.round(78 + h * 72);
          dImg.data[idx + 2] = Math.round(24 + h * 34);
        }
        dImg.data[idx + 3] = 255;
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xL = this.wrapCoord(x - 1, size);
        const xR = this.wrapCoord(x + 1, size);
        const yD = this.wrapCoord(y - 1, size);
        const yU = this.wrapCoord(y + 1, size);
        const dX = (hMap[y * size + xL] - hMap[y * size + xR]) * 3.8;
        const dY = (hMap[yD * size + x] - hMap[yU * size + x]) * 3.8;
        const len = Math.sqrt(dX * dX + dY * dY + 1) || 1;
        const idx = (y * size + x) * 4;
        nImg.data[idx] = Math.round(((dX / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 1] = Math.round(((dY / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 3] = 255;
      }
    }

    dCtx.putImageData(dImg, 0, 0);
    nCtx.putImageData(nImg, 0, 0);
    diffuse.update(true);
    normal.update(true);
    return { diffuse, normal };
  }

  /**
   * Seamless Granite Rock Texture & Normal Map
   */
  public static createSeamlessRockTextures(scene: Scene): { diffuse: DynamicTexture; normal: DynamicTexture } {
    const size = 128;
    const diffuse = new DynamicTexture('rockDiffuse', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const normal = new DynamicTexture('rockNormal', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    diffuse.wrapU = diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
    normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;

    const dCtx = diffuse.getContext() as CanvasRenderingContext2D;
    const nCtx = normal.getContext() as CanvasRenderingContext2D;
    const dImg = dCtx.createImageData(size, size);
    const nImg = nCtx.createImageData(size, size);
    const hMap = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const crag = this.seamlessFBM(u, v, 8, 3, 64.2);
        const grain = this.seamlessFBM(u, v, 32, 2, 19.8);
        const h = crag * 0.7 + grain * 0.3;
        hMap[y * size + x] = h;

        const idx = (y * size + x) * 4;
        const base = 92 + h * 78;
        dImg.data[idx] = Math.round(base * 0.98);
        dImg.data[idx + 1] = Math.round(base * 0.99);
        dImg.data[idx + 2] = Math.round(base * 1.02);
        dImg.data[idx + 3] = 255;
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xL = this.wrapCoord(x - 1, size);
        const xR = this.wrapCoord(x + 1, size);
        const yD = this.wrapCoord(y - 1, size);
        const yU = this.wrapCoord(y + 1, size);
        const dX = (hMap[y * size + xL] - hMap[y * size + xR]) * 4.2;
        const dY = (hMap[yD * size + x] - hMap[yU * size + x]) * 4.2;
        const len = Math.sqrt(dX * dX + dY * dY + 1) || 1;
        const idx = (y * size + x) * 4;
        nImg.data[idx] = Math.round(((dX / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 1] = Math.round(((dY / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 3] = 255;
      }
    }

    dCtx.putImageData(dImg, 0, 0);
    nCtx.putImageData(nImg, 0, 0);
    diffuse.update(true);
    normal.update(true);
    return { diffuse, normal };
  }

  /**
   * Generates a 128x128 Golf Ball Dimple Normal Map for realistic close-up ball rendering
   */
  public static createGolfBallDimpleNormalTexture(scene: Scene): DynamicTexture {
    const size = 128;
    const normal = new DynamicTexture('golfBallDimpleNormal', size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;

    const ctx = normal.getContext() as CanvasRenderingContext2D;
    const img = ctx.createImageData(size, size);
    const cols = 16;
    const rows = 8;

    for (let y = 0; y < size; y++) {
      const v = (y / size) * rows;
      const row = Math.floor(v);
      const fy = (v - row) * 2 - 1;

      for (let x = 0; x < size; x++) {
        const u = (x / size) * cols + (row % 2) * 0.5;
        const col = Math.floor(u);
        const fx = (u - col) * 2 - 1;

        const r2 = fx * fx + fy * fy;
        let nx = 0, ny = 0, nz = 1;
        if (r2 < 0.58) {
          // Concave spherical dimple
          nx = -fx * 0.65;
          ny = -fy * 0.65;
          nz = Math.sqrt(Math.max(0.2, 1.0 - nx * nx - ny * ny));
        }

        const idx = (y * size + x) * 4;
        img.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
        img.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        img.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        img.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
    normal.update(true);
    return normal;
  }
}
