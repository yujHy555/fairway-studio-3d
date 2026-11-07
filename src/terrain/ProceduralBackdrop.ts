import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Color3
} from '@babylonjs/core';

/**
 * Procedural Backdrop Mountain & Valley Generator
 * Generates an expansive scenic landscape (1000m x 1000m) surrounding the golf course
 * using multi-octave Fractal Brownian Motion (FBM) with slope-aware biome texturing.
 */
export class ProceduralBackdrop {
  private scene: Scene;
  public backdropMesh: Mesh | null = null;

  // Outer bounds
  private readonly worldSize = 900; // 900m x 900m
  private readonly resolution = 90; // 90x90 quads (10m per quad for optimal performance)

  // Golf course playable cutout bounds
  private readonly holeMinX = 70;
  private readonly holeMaxX = 150;
  private readonly holeMinZ = 20;
  private readonly holeMaxZ = 400;

  constructor(scene: Scene) {
    this.scene = scene;
    this.buildBackdrop();
  }

  /**
   * Multi-octave Perlin / Simplex pseudo-noise function
   */
  private noise(x: number, z: number): number {
    return Math.sin(x * 0.015) * Math.cos(z * 0.015) +
           0.5 * Math.sin(x * 0.035 + 1.7) * Math.cos(z * 0.035 + 2.3) +
           0.25 * Math.sin(x * 0.08 + 4.1) * Math.sin(z * 0.08 + 0.9);
  }

  private fbm(x: number, z: number): number {
    let total = 0;
    let amplitude = 1.0;
    let frequency = 0.006;
    let maxValue = 0;

    for (let i = 0; i < 4; i++) {
      total += (Math.sin(x * frequency) * Math.cos(z * frequency) +
                Math.cos(x * frequency * 0.7 + 1.2) * Math.sin(z * frequency * 0.8)) * amplitude;
      maxValue += amplitude * 2;
      amplitude *= 0.5;
      frequency *= 2.1;
    }

    return (total / maxValue) * 35.0; // up to 35m mountain peaks
  }

  public buildBackdrop() {
    if (this.backdropMesh) {
      this.backdropMesh.dispose();
    }

    const cols = this.resolution + 1;
    const rows = this.resolution + 1;
    const step = this.worldSize / this.resolution;
    const originOffset = -this.worldSize * 0.5 + 110; // Center around hole at X=110, Z=200
    const originOffsetZ = -this.worldSize * 0.5 + 200;

    const quadCount = this.resolution * this.resolution;
    const vertexCount = quadCount * 6; // low-poly faceted triangles

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(vertexCount);

    let vIdx = 0;
    let pIdx = 0;
    let cIdx = 0;

    // Helper to compute mountain height with bowl cutout for the golf course
    const sampleHeight = (wx: number, wz: number): number => {
      // Distance from center of golf hole
      const dx = Math.max(0, Math.max(this.holeMinX - wx, wx - this.holeMaxX));
      const dz = Math.max(0, Math.max(this.holeMinZ - wz, wz - this.holeMaxZ));
      const distFromCourse = Math.sqrt(dx * dx + dz * dz);

      // Smooth step transition: 0m height near course, rises into dramatic mountains at 40m+ distance
      const transitionFactor = Math.min(1.0, Math.max(0, (distFromCourse - 25.0) / 90.0));
      const easeFactor = transitionFactor * transitionFactor * (3 - 2 * transitionFactor);

      if (easeFactor <= 0.001) return -0.2; // slightly below golf ground to prevent z-fighting

      const rawMountain = Math.max(0, this.fbm(wx, wz) + 10.0);
      return rawMountain * easeFactor;
    };

    for (let r = 0; r < this.resolution; r++) {
      for (let c = 0; c < this.resolution; c++) {
        const x0 = originOffset + c * step;
        const x1 = originOffset + (c + 1) * step;
        const z0 = originOffsetZ + r * step;
        const z1 = originOffsetZ + (r + 1) * step;

        // Skip quads that are strictly inside the playable course
        if (x0 >= this.holeMinX + 5 && x1 <= this.holeMaxX - 5 &&
            z0 >= this.holeMinZ + 5 && z1 <= this.holeMaxZ - 5) {
          continue;
        }

        const y00 = sampleHeight(x0, z0);
        const y10 = sampleHeight(x1, z0);
        const y01 = sampleHeight(x0, z1);
        const y11 = sampleHeight(x1, z1);

        // Triangle 1
        const ax1 = x0 - x0, ay1 = y01 - y00, az1 = z1 - z0;
        const bx1 = x1 - x0, by1 = y10 - y00, bz1 = z0 - z0;
        let nx1 = ay1 * bz1 - az1 * by1;
        let ny1 = az1 * bx1 - ax1 * bz1;
        let nz1 = ax1 * by1 - ay1 * bx1;
        const l1 = Math.sqrt(nx1 * nx1 + ny1 * ny1 + nz1 * nz1) || 1;
        nx1 /= l1; ny1 /= l1; nz1 /= l1;

        // Tri 1 Slope (dot with up vector)
        const slope1 = 1.0 - ny1; // 0 = flat, 1 = vertical cliff

        const t1 = [
          { x: x0, y: y00, z: z0 },
          { x: x0, y: y01, z: z1 },
          { x: x1, y: y10, z: z0 }
        ];

        for (const pt of t1) {
          positions[pIdx] = pt.x;
          positions[pIdx + 1] = pt.y;
          positions[pIdx + 2] = pt.z;

          normals[pIdx] = nx1;
          normals[pIdx + 1] = ny1;
          normals[pIdx + 2] = nz1;

          // Biome coloring: Flat = alpine pine green, Steep = rocky granite, High = snow frost
          let rC = 0.18, gC = 0.38, bC = 0.16; // default forest green
          if (slope1 > 0.32) {
            // Granite rock cliff
            rC = 0.44; gC = 0.45; bC = 0.48;
          } else if (pt.y > 24.0) {
            // Snow peak
            rC = 0.88; gC = 0.92; bC = 0.95;
          }

          colors[cIdx] = rC;
          colors[cIdx + 1] = gC;
          colors[cIdx + 2] = bC;
          colors[cIdx + 3] = 1.0;

          indices[vIdx] = vIdx;
          vIdx++;
          pIdx += 3;
          cIdx += 4;
        }

        // Triangle 2
        const ax2 = x0 - x1, ay2 = y01 - y10, az2 = z1 - z0;
        const bx2 = x1 - x1, by2 = y11 - y10, bz2 = z1 - z0;
        let nx2 = ay2 * bz2 - az2 * by2;
        let ny2 = az2 * bx2 - ax2 * bz2;
        let nz2 = ax2 * by2 - ay2 * bx2;
        const l2 = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1;
        nx2 /= l2; ny2 /= l2; nz2 /= l2;

        const slope2 = 1.0 - ny2;

        const t2 = [
          { x: x1, y: y10, z: z0 },
          { x: x0, y: y01, z: z1 },
          { x: x1, y: y11, z: z1 }
        ];

        for (const pt of t2) {
          positions[pIdx] = pt.x;
          positions[pIdx + 1] = pt.y;
          positions[pIdx + 2] = pt.z;

          normals[pIdx] = nx2;
          normals[pIdx + 1] = ny2;
          normals[pIdx + 2] = nz2;

          let rC = 0.18, gC = 0.38, bC = 0.16;
          if (slope2 > 0.32) {
            rC = 0.44; gC = 0.45; bC = 0.48;
          } else if (pt.y > 24.0) {
            rC = 0.88; gC = 0.92; bC = 0.95;
          }

          colors[cIdx] = rC;
          colors[cIdx + 1] = gC;
          colors[cIdx + 2] = bC;
          colors[cIdx + 3] = 1.0;

          indices[vIdx] = vIdx;
          vIdx++;
          pIdx += 3;
          cIdx += 4;
        }
      }
    }

    const mesh = new Mesh('ProceduralBackdropMesh', this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions.slice(0, pIdx);
    vertexData.normals = normals.slice(0, pIdx);
    vertexData.colors = colors.slice(0, cIdx);
    vertexData.indices = indices.slice(0, vIdx);
    vertexData.applyToMesh(mesh, false);

    const mat = new StandardMaterial('backdropMat', this.scene);
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    mat.backFaceCulling = false;
    mesh.material = mat;

    this.backdropMesh = mesh;
  }
}
