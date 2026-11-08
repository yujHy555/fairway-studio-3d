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

interface SlopeComet {
  baseX: number;
  baseZ: number;
  phaseOffset: number;
  slopeDirX: number;
  slopeDirZ: number;
  slopeMagnitude: number;
  headMesh: Mesh;
  midMesh: Mesh;
  tailMesh: Mesh;
}

export class GreenContourVisualizer {
  private scene: Scene;
  private terrain: TerrainGrid;

  public showGrid: boolean = true;
  public showDots: boolean = true;

  private comets: SlopeComet[] = [];
  private beadParent: Mesh;
  private matMild: StandardMaterial;
  private matMed: StandardMaterial;
  private matSteep: StandardMaterial;
  private contourLineGrid: LinesMesh | null = null;
  private waveTime: number = 0;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    this.beadParent = new Mesh('GreenContourParent', this.scene);

    // Color-coded luminous materials for slope comets (Mild = Lime/Cyan, Medium = Gold, Steep = Coral Red)
    this.matMild = new StandardMaterial('slopeBeadMild', this.scene);
    this.matMild.emissiveColor = new Color3(0.35, 1.0, 0.55);
    this.matMild.disableLighting = true;

    this.matMed = new StandardMaterial('slopeBeadMed', this.scene);
    this.matMed.emissiveColor = new Color3(1.0, 0.88, 0.20);
    this.matMed.disableLighting = true;

    this.matSteep = new StandardMaterial('slopeBeadSteep', this.scene);
    this.matSteep.emissiveColor = new Color3(1.0, 0.35, 0.15);
    this.matSteep.disableLighting = true;

    this.rebuildSlopeGrid();

    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.showDots || this.comets.length === 0) return;
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      this.updateComets(dt);
    });
  }

  public setGridVisible(visible: boolean) {
    this.showGrid = visible;
    if (this.contourLineGrid) {
      this.contourLineGrid.setEnabled(visible);
    }
  }

  public setDotsVisible(visible: boolean) {
    this.showDots = visible;
    this.beadParent.setEnabled(visible);
  }

  public toggleGrid(): boolean {
    this.setGridVisible(!this.showGrid);
    return this.showGrid;
  }

  public toggleDots(): boolean {
    this.setDotsVisible(!this.showDots);
    return this.showDots;
  }

  public setVisible(visible: boolean) {
    this.setGridVisible(visible);
    this.setDotsVisible(visible);
  }

  public toggleVisible(): boolean {
    const next = !(this.showGrid || this.showDots);
    this.setVisible(next);
    return next;
  }

  /**
   * Builds:
   * 1. Clean 1.5m x 1.5m PGA Tour contour grid with smooth 0.3m elevation curve sampling
   * 2. Synchronized 3-dot comet trails that flow smoothly downhill in coherent wave fronts (zero random jitter)
   */
  public rebuildSlopeGrid() {
    if (this.contourLineGrid) {
      this.contourLineGrid.dispose();
      this.contourLineGrid = null;
    }

    for (const c of this.comets) {
      c.headMesh.dispose();
      c.midMesh.dispose();
      c.tailMesh.dispose();
    }
    this.comets = [];

    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];

    const gridSpacing = 1.5; // Clean 1.5m grid spacing for uncluttered readability
    const sampleStep = 0.3;  // Smooth 30cm curve vertices along each grid line

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

    minX = Math.max(0, Math.floor(minX - 2));
    maxX = Math.min(this.terrain.width, Math.ceil(maxX + 2));
    minZ = Math.max(0, Math.floor(minZ - 2));
    maxZ = Math.min(this.terrain.length, Math.ceil(maxZ + 2));

    const getSlopeColor = (slope: number): Color4 => {
      if (slope < 0.012) {
        return new Color4(0.75, 0.95, 1.0, 0.65); // Nearly flat: soft ice-white/cyan
      } else if (slope < 0.032) {
        return new Color4(0.30, 0.98, 0.48, 0.85); // Gentle break: emerald green
      } else if (slope < 0.060) {
        return new Color4(1.0, 0.88, 0.22, 0.92); // Medium break: warm gold
      } else {
        return new Color4(1.0, 0.35, 0.16, 1.0); // Strong break: coral red
      }
    };

    const isInteriorGreen = (wx: number, wz: number): boolean => {
      const x0 = Math.floor(wx);
      const z0 = Math.floor(wz);
      return (
        this.terrain.getSurfaceAt(x0, z0) === SurfaceType.GREEN &&
        this.terrain.getSurfaceAt(x0 + 1, z0) === SurfaceType.GREEN &&
        this.terrain.getSurfaceAt(x0, z0 + 1) === SurfaceType.GREEN &&
        this.terrain.getSurfaceAt(x0 + 1, z0 + 1) === SurfaceType.GREEN
      );
    };

    // 1. X-direction contour lines (every 1.5m in Z)
    for (let z = minZ; z <= maxZ; z += gridSpacing) {
      let curSegment: Vector3[] = [];
      let curColors: Color4[] = [];

      for (let x = minX; x <= maxX; x += sampleStep) {
        if (isInteriorGreen(x, z)) {
          const elev = this.terrain.getElevation(x, z) + 0.024;
          const normal = this.terrain.getNormal(x, z);
          const slope = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
          curSegment.push(new Vector3(x, elev, z));
          curColors.push(getSlopeColor(slope));
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

    // 2. Z-direction contour lines (every 1.5m in X)
    for (let x = minX; x <= maxX; x += gridSpacing) {
      let curSegment: Vector3[] = [];
      let curColors: Color4[] = [];

      for (let z = minZ; z <= maxZ; z += sampleStep) {
        if (isInteriorGreen(x, z)) {
          const elev = this.terrain.getElevation(x, z) + 0.024;
          const normal = this.terrain.getNormal(x, z);
          const slope = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
          curSegment.push(new Vector3(x, elev, z));
          curColors.push(getSlopeColor(slope));
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
      this.contourLineGrid.renderingGroupId = 0; // Under ball (groupId 2)
      this.contourLineGrid.setEnabled(this.showGrid);
    }

    // 3. Synchronized Downhill Comet Beads (placed at 2.0m intervals for crystal-clear reading)
    const templateSphere = MeshBuilder.CreateSphere('cometTemplate', { diameter: 0.16, segments: 8 }, this.scene);
    templateSphere.isVisible = false;
    templateSphere.isPickable = false;

    const dotSpacing = 2.0;
    for (let z = minZ + 0.75; z <= maxZ; z += dotSpacing) {
      for (let x = minX + 0.75; x <= maxX; x += dotSpacing) {
        if (isInteriorGreen(x, z)) {
          const normal = this.terrain.getNormal(x, z);
          // Normal.x and normal.z point downhill (-dh/dx, -dh/dz), exactly matching ball break
          const slopeX = normal.x;
          const slopeZ = normal.z;
          const slopeMag = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);

          if (slopeMag > 0.005) {
            const dirX = slopeX / slopeMag;
            const dirZ = slopeZ / slopeMag;

            const mat = slopeMag < 0.032 ? this.matMild : slopeMag < 0.060 ? this.matMed : this.matSteep;

            const headMesh = templateSphere.clone(`comet_h_${x}_${z}`, this.beadParent);
            const midMesh = templateSphere.clone(`comet_m_${x}_${z}`, this.beadParent);
            const tailMesh = templateSphere.clone(`comet_t_${x}_${z}`, this.beadParent);

            headMesh.material = mat;
            midMesh.material = mat;
            tailMesh.material = mat;

            headMesh.isVisible = true;
            midMesh.isVisible = true;
            tailMesh.isVisible = true;

            headMesh.isPickable = false;
            midMesh.isPickable = false;
            tailMesh.isPickable = false;

            // Deterministic spatial wave phase along downhill direction so adjacent dots flow in unison!
            const spatialWave = (((x * dirX + z * dirZ) * 0.22) % 1.0 + 1.0) % 1.0;

            this.comets.push({
              baseX: x,
              baseZ: z,
              phaseOffset: spatialWave,
              slopeDirX: dirX,
              slopeDirZ: dirZ,
              slopeMagnitude: slopeMag,
              headMesh,
              midMesh,
              tailMesh
            });
          }
        }
      }
    }

    templateSphere.dispose();
    this.beadParent.setEnabled(this.showDots);
    this.updateComets(0.016);
  }

  private updateComets(dt: number) {
    this.waveTime += Math.min(0.05, Math.max(0.005, dt));

    for (const c of this.comets) {
      // Flow speed scales smoothly with slope steepness
      const cycleRate = 0.45 + Math.min(1.4, c.slopeMagnitude * 14.0);
      const t = (this.waveTime * cycleRate + c.phaseOffset) % 1.0;

      // Travel 1.2m along the downhill slope direction centered at (baseX, baseZ)
      const span = 1.15;
      const headDist = (t - 0.5) * span;
      const midDist = headDist - 0.16;
      const tailDist = headDist - 0.30;

      const placeDot = (mesh: Mesh, dist: number, baseScale: number) => {
        const px = c.baseX + c.slopeDirX * dist;
        const pz = c.baseZ + c.slopeDirZ * dist;
        const py = this.terrain.getElevation(px, pz) + 0.038;
        mesh.position.set(px, py, pz);

        // Smooth fade envelope at start and end of stroke
        const envelope = Math.sin(t * Math.PI);
        const s = Math.max(0.15, envelope * baseScale);
        mesh.scaling.set(s, s * 0.55, s);
      };

      placeDot(c.headMesh, headDist, 1.05);
      placeDot(c.midMesh, midDist, 0.72);
      placeDot(c.tailMesh, tailDist, 0.45);
    }
  }

  public dispose() {
    if (this.contourLineGrid) {
      this.contourLineGrid.dispose();
      this.contourLineGrid = null;
    }
    for (const c of this.comets) {
      c.headMesh.dispose();
      c.midMesh.dispose();
      c.tailMesh.dispose();
    }
    this.beadParent.dispose();
    this.matMild.dispose();
    this.matMed.dispose();
    this.matSteep.dispose();
  }
}
