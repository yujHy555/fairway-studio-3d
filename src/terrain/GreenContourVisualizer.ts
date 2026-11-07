import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3
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
  }

  public toggleVisible(): boolean {
    this.setVisible(!this.isVisible);
    return this.isVisible;
  }

  /**
   * Scans the terrain grid for all GREEN vertices and places animated slope beads
   */
  public rebuildSlopeGrid() {
    // Clear old beads
    for (const b of this.beads) {
      b.mesh.dispose();
    }
    this.beads = [];

    // Base template sphere for instanced or cloned beads
    const baseSphere = MeshBuilder.CreateSphere('beadTemplate', { diameter: 0.14, segments: 4 }, this.scene);
    baseSphere.material = this.beadMaterial;
    baseSphere.isVisible = false;

    for (let z = 1; z < this.terrain.length; z += 1.5) {
      for (let x = 1; x < this.terrain.width; x += 1.5) {
        if (this.terrain.getSurfaceAt(x, z) === SurfaceType.GREEN) {
          const normal = this.terrain.getNormal(x, z);
          // Slope downhill gradient vector
          const slopeX = -normal.x;
          const slopeZ = -normal.z;
          const slopeMag = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);

          if (slopeMag > 0.005) { // If there's any perceptible break
            const beadMesh = baseSphere.clone(`bead_${x}_${z}`, this.beadParent);
            beadMesh.isVisible = true;

            const dirX = slopeX / slopeMag;
            const dirZ = slopeZ / slopeMag;

            this.beads.push({
              gridX: x,
              gridZ: z,
              baseX: x,
              baseZ: z,
              offset: Math.random(), // Stagger beads
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
    // Animate beads flowing down the slope
    const speedMultiplier = 1.8;
    for (const b of this.beads) {
      // Advance offset based on steepness of slope
      b.offset += (0.008 + b.slopeMagnitude * 0.04) * speedMultiplier;
      if (b.offset > 1.0) b.offset -= 1.0;

      // Position travels from -0.4m to +0.4m along downhill vector
      const travelDist = (b.offset - 0.5) * 0.8;
      const curX = b.baseX + b.slopeDirX * travelDist;
      const curZ = b.baseZ + b.slopeDirZ * travelDist;
      const curY = this.terrain.getElevation(curX, curZ) + 0.05; // hover slightly above green

      b.mesh.position.set(curX, curY, curZ);

      // Fade out at ends of travel path
      const alpha = Math.sin(b.offset * Math.PI);
      b.mesh.scaling.setAll(Math.max(0.2, alpha));
    }
  }

  public dispose() {
    for (const b of this.beads) {
      b.mesh.dispose();
    }
    this.beadParent.dispose();
    this.beadMaterial.dispose();
  }
}
