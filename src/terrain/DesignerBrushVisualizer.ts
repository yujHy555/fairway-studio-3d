import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3
} from '@babylonjs/core';
import { TerrainGrid } from './TerrainGrid';

export class DesignerBrushVisualizer {
  private scene: Scene;
  private terrain: TerrainGrid;
  private group: Mesh;
  private ringMesh: Mesh;
  private fillDisc: Mesh;
  private centerDot: Mesh;

  private ringMat: StandardMaterial;
  private fillMat: StandardMaterial;
  private dotMat: StandardMaterial;

  public isVisible = false;
  public radius = 12;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    this.group = new Mesh('designerBrushGroup', this.scene);

    // 1. Outer Torus Ring
    this.ringMesh = MeshBuilder.CreateTorus('designerBrushRing', {
      diameter: 2.0,
      thickness: 0.12,
      tessellation: 48
    }, this.scene);
    this.ringMesh.parent = this.group;

    this.ringMat = new StandardMaterial('brushRingMat', this.scene);
    this.ringMat.emissiveColor = new Color3(0.2, 0.9, 1.0); // Vibrant cyan
    this.ringMat.disableLighting = true;
    this.ringMesh.material = this.ringMat;

    // 2. Semi-transparent disc fill
    this.fillDisc = MeshBuilder.CreateDisc('designerBrushFill', {
      radius: 1.0,
      tessellation: 48
    }, this.scene);
    this.fillDisc.rotation.x = Math.PI * 0.5;
    this.fillDisc.parent = this.group;

    this.fillMat = new StandardMaterial('brushFillMat', this.scene);
    this.fillMat.diffuseColor = new Color3(0.2, 0.9, 1.0);
    this.fillMat.emissiveColor = new Color3(0.1, 0.45, 0.6);
    this.fillMat.alpha = 0.22;
    this.fillMat.disableLighting = true;
    this.fillDisc.material = this.fillMat;

    // 3. Center Target Dot
    this.centerDot = MeshBuilder.CreateSphere('brushCenterDot', {
      diameter: 0.45,
      segments: 12
    }, this.scene);
    this.centerDot.parent = this.group;

    this.dotMat = new StandardMaterial('brushDotMat', this.scene);
    this.dotMat.emissiveColor = new Color3(1.0, 1.0, 1.0);
    this.dotMat.disableLighting = true;
    this.centerDot.material = this.dotMat;

    this.group.setEnabled(false);
  }

  public setConfig(
    tool: 'sculpt' | 'stamp' | 'set_tee' | 'set_pin',
    sculptMode: 'raise' | 'lower' | 'flatten' | 'smooth',
    radius: number,
    presetDimensions?: { width: number; length: number }
  ) {
    this.radius = radius;

    let color: Color3;
    let scaleX = radius;
    let scaleZ = radius;

    if (tool === 'sculpt') {
      if (sculptMode === 'raise') color = new Color3(1.0, 0.65, 0.15); // Golden amber
      else if (sculptMode === 'lower') color = new Color3(1.0, 0.25, 0.25); // Crimson red
      else if (sculptMode === 'flatten') color = new Color3(0.2, 0.85, 1.0); // Cyan
      else color = new Color3(0.4, 0.95, 0.35); // Emerald smooth
    } else if (tool === 'stamp') {
      color = new Color3(0.25, 0.95, 0.95);
      if (presetDimensions) {
        scaleX = presetDimensions.width * 0.5;
        scaleZ = presetDimensions.length * 0.5;
      }
    } else if (tool === 'set_tee') {
      color = new Color3(0.3, 0.6, 1.0);
      scaleX = 3.0;
      scaleZ = 3.0;
    } else {
      color = new Color3(1.0, 0.2, 0.2);
      scaleX = 2.0;
      scaleZ = 2.0;
    }

    this.ringMat.emissiveColor = color;
    this.fillMat.diffuseColor = color;
    this.fillMat.emissiveColor = color.scale(0.5);

    this.ringMesh.scaling.set(scaleX, 1, scaleZ);
    this.fillDisc.scaling.set(scaleX, scaleZ, 1);
  }

  public updatePosition(hitPoint: Vector3) {
    if (!this.isVisible) return;

    const normal = this.terrain.getNormal(hitPoint.x, hitPoint.z);
    this.group.position.set(hitPoint.x, hitPoint.y + 0.08, hitPoint.z);

    // Lay disc flush with terrain slope
    this.group.rotation.x = normal.z * 0.75;
    this.group.rotation.z = -normal.x * 0.75;
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
    this.group.setEnabled(visible);
  }

  public dispose() {
    this.group.dispose();
    this.ringMat.dispose();
    this.fillMat.dispose();
    this.dotMat.dispose();
  }
}
