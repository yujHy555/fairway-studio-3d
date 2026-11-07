import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  LinesMesh
} from '@babylonjs/core';
import { TerrainGrid } from './TerrainGrid';
import { SurfaceType } from '../core/Constants';

interface SlopeBead {
  gridX: number;
  gridZ: number;
  baseX: number;
  baseZ: number;
  offset: number; // 0 to 1 along travel cycle
  slopeDirX: number;
  slopeDirZ: number;
  slopeMagnitude: number;
  mesh: Mesh;
}

export class GreenContourVisualizer {
  private scene: Scene;
  private terrain: TerrainGrid;
  private isVisible: boolean = true;
  private beads: SlopeBead[] = [];
  private beadParent: Mesh;
  private beadMaterial: StandardMaterial;
  private contourLineGrid: LinesMesh | null = null;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    this.beadParent = new Mesh('GreenContourParent', this.scene);
    this.beadMaterial = new StandardMaterial('slopeBeadMat', this.scene);
    this.beadMaterial.emissiveColor = new Color3(1.0, 0.95, 0.3); // Bright luminous yellow
    this.beadMaterial.diffuseColor = new Color3(1.0, 1.0, 0.5);
    this.beadMaterial.specularColor = new Color3(0, 0, 0);

    this.rebuildSlopeGrid();

    // Register animation loop for moving slope beads
    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.isVisible || this.beads.length === 0) return;
      this.updateBeads();
    });
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
    this.beadParent.setEnabled(visible);
    if (this.contourLineGrid) {
      this.contourLineGrid.setEnabled(visible);
    }
  }

  public toggleVisible(): boolean {
    this.setVisible(!this.isVisible);
    return this.isVisible;
  }

  /**
   * Scans the terrain grid for all GREEN areas and builds:
   * 1. PGA Tour / TrackMan precision 0.75m elevation-draped contour line grid with slope break colors
   * 2. Animated downhill slope direction beads
   */
  public rebuildSlopeGrid() {
    // 1. Dispose old line grid and beads
    if (this.contourLineGrid) {
      this.contourLineGrid.dispose();
      this.contourLineGrid = null;
    }

    for (const b of this.beads) {
      b.mesh.dispose();
    }
    this.beads = [];

    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];

    const step = 0.75; // 75cm high-resolution PGA contour grid

    // Find bounding box of all green surfaces to optimize scanning
    let minX = this.terrain.width, maxX = 0;
    let minZ = this.terrain.length, maxZ = 0;
    let hasGreen = false;

    for (let z = 0; z < this.terrain.length; z++) {
      for (let x = 0; x < this.terrain.width; x++) {
        if (this.terrain.getSurfaceAt(x, z) === SurfaceType.GREEN) {
          hasGreen = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    }

    if (!hasGreen) return;

    minX = Math.max(0, minX - 2);
    maxX = Math.min(this.terrain.width, maxX + 2);
    minZ = Math.max(0, minZ - 2);
    maxZ = Math.min(this.terrain.length, maxZ + 2);

    // Color gradient evaluator based on slope break steepness
    const getSlopeColor = (slope: number): Color4 => {
      if (slope < 0.015) {
        // Flat / level putt: Glowing cyan
        return new Color4(0.25, 0.85, 1.0, 0.70);
      } else if (slope < 0.035) {
        // Mild break: Crisp lime green
        return new Color4(0.35, 1.0, 0.35, 0.85);
      } else if (slope < 0.065) {
        // Medium break: Warning yellow
        return new Color4(1.0, 0.90, 0.20, 0.95);
      } else {
        // Severe break: Hot orange/red
        return new Color4(1.0, 0.32, 0.12, 1.0);
      }
    };

    // 2. Build X-direction grid lines draped over contours
    for (let z = minZ; z <= maxZ; z += step) {
      let curSegment: Vector3[] = [];
      let curColors: Color4[] = [];

      for (let x = minX; x <= maxX; x += step) {
        const surf = this.terrain.getSurfaceAt(x, z);
        if (surf === SurfaceType.GREEN) {
          const elev = this.terrain.getElevation(x, z) + 0.022; // 2.2cm hover
          const normal = this.terrain.getNormal(x, z);
          const slope = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
          const pt = new Vector3(x, elev, z);
          const col = getSlopeColor(slope);

          curSegment.push(pt);
          curColors.push(col);
        } else {
          if (curSegment.length >= 2) {
            lines.push(curSegment);
            colors.push(curColors);
          }
          curSegment = [];
          curColors = [];
        }
      }
      if (curSegment.length >= 2) {
        lines.push(curSegment);
        colors.push(curColors);
      }
    }

    // 3. Build Z-direction grid lines draped over contours
    for (let x = minX; x <= maxX; x += step) {
      let curSegment: Vector3[] = [];
      let curColors: Color4[] = [];

      for (let z = minZ; z <= maxZ; z += step) {
        const surf = this.terrain.getSurfaceAt(x, z);
        if (surf === SurfaceType.GREEN) {
          const elev = this.terrain.getElevation(x, z) + 0.022; // 2.2cm hover
          const normal = this.terrain.getNormal(x, z);
          const slope = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
          const pt = new Vector3(x, elev, z);
          const col = getSlopeColor(slope);

          curSegment.push(pt);
          curColors.push(col);
        } else {
          if (curSegment.length >= 2) {
            lines.push(curSegment);
            colors.push(curColors);
          }
          curSegment = [];
          curColors = [];
        }
      }
      if (curSegment.length >= 2) {
        lines.push(curSegment);
        colors.push(curColors);
      }
    }

    // 4. Create Line System mesh
    if (lines.length > 0) {
      this.contourLineGrid = MeshBuilder.CreateLineSystem(
        'greenContourLineGrid',
        {
          lines,
          colors,
          useVertexAlpha: true,
          updatable: false
        },
        this.scene
      );
      this.contourLineGrid.isPickable = false;
      this.contourLineGrid.setEnabled(this.isVisible);
    }

    // 5. Place animated slope beads at grid intersections with noticeable break
    const baseSphere = MeshBuilder.CreateSphere('beadTemplate', { diameter: 0.12, segments: 4 }, this.scene);
    baseSphere.material = this.beadMaterial;
    baseSphere.isVisible = false;

    for (let z = minZ; z <= maxZ; z += 1.5) {
      for (let x = minX; x <= maxX; x += 1.5) {
        if (this.terrain.getSurfaceAt(x, z) === SurfaceType.GREEN) {
          const normal = this.terrain.getNormal(x, z);
          const slopeX = -normal.x;
          const slopeZ = -normal.z;
          const slopeMag = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);

          if (slopeMag > 0.008) {
            const beadMesh = baseSphere.clone(`bead_${x}_${z}`, this.beadParent);
            beadMesh.isVisible = true;

            const dirX = slopeX / slopeMag;
            const dirZ = slopeZ / slopeMag;

            this.beads.push({
              gridX: x,
              gridZ: z,
              baseX: x,
              baseZ: z,
              offset: Math.random(),
              slopeDirX: dirX,
              slopeDirZ: dirZ,
              slopeMagnitude: slopeMag,
              mesh: beadMesh
            });
          }
        }
      }
    }

    baseSphere.dispose();
  }

  private updateBeads() {
    const speedMultiplier = 1.8;
    for (const b of this.beads) {
      b.offset += (0.008 + b.slopeMagnitude * 0.04) * speedMultiplier;
      if (b.offset > 1.0) b.offset -= 1.0;

      const travelDist = (b.offset - 0.5) * 0.75;
      const curX = b.baseX + b.slopeDirX * travelDist;
      const curZ = b.baseZ + b.slopeDirZ * travelDist;
      const curY = this.terrain.getElevation(curX, curZ) + 0.045;

      b.mesh.position.set(curX, curY, curZ);

      const alpha = Math.sin(b.offset * Math.PI);
      b.mesh.scaling.setAll(Math.max(0.2, alpha));
    }
  }

  public dispose() {
    if (this.contourLineGrid) {
      this.contourLineGrid.dispose();
      this.contourLineGrid = null;
    }
    for (const b of this.beads) {
      b.mesh.dispose();
    }
    this.beadParent.dispose();
    this.beadMaterial.dispose();
  }
}
