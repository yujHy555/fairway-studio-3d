import {
  Scene,
  Vector3,
  Mesh,
  VertexData,
  StandardMaterial,
  PBRMaterial,
  Color3,
  ShadowGenerator
} from '@babylonjs/core';
import { ClubSpec } from '../core/Types';
import { TerrainGrid } from '../terrain/TerrainGrid';

/**
 * Modern PGA-Style 3D Directional Aim Chevron Indicator
 * Modeled precisely on the broadcast arrow design reference:
 * A sleek golden-yellow chevron hovering slightly above the turf (10cm)
 * and casting a real-time shadow onto the terrain.
 */
export class AimSystem {
  private scene: Scene;
  private terrain: TerrainGrid;

  public aimHeadingDeg: number = 0;
  public targetDistanceMeters: number = 220;
  public targetPosition: Vector3 = new Vector3(110, 0, 260);
  public isVisible: boolean = true;

  private arrowMesh: Mesh;
  private arrowMat: StandardMaterial | PBRMaterial;
  private isArrowActive: boolean = true;
  private pulseTime: number = 0;

  constructor(
    scene: Scene,
    terrain: TerrainGrid,
    shadowGenerator?: ShadowGenerator | { addShadowCaster: (mesh: Mesh) => void } | null
  ) {
    this.scene = scene;
    this.terrain = terrain;

    this.arrowMesh = new Mesh('cup_modernAimChevron', this.scene);
    this.arrowMesh.isPickable = false;
    this.arrowMesh.receiveShadows = false;

    // Build the extruded 3D chevron arrow geometry (matching reference image)
    this.buildChevronGeometry();

    // Non-reflective, non-specular tournament aim chevron material
    const mat = new StandardMaterial('modernAimChevronMat', this.scene);
    mat.diffuseColor = Color3.FromHexString('#FFB800'); // Clean tournament golden amber
    mat.specularColor = new Color3(0, 0, 0);            // Strictly non-reflective, zero specular shine
    mat.emissiveColor = Color3.FromHexString('#785200'); // Balanced warm broadcast visibility
    mat.backFaceCulling = false;
    this.arrowMat = mat;
    this.arrowMesh.material = this.arrowMat;

    // Register with ShadowGenerator so it casts a real-time soft shadow onto the turf below
    if (shadowGenerator && typeof shadowGenerator.addShadowCaster === 'function') {
      shadowGenerator.addShadowCaster(this.arrowMesh);
    }
  }

  /**
   * Generates the 3D extruded chevron prism matching media_1794131913300_507d6353.jpg:
   * 6 perimeter vertices in X-Z local space, extruded along Y by 0.038m with crisp bevel normals.
   */
  private buildChevronGeometry() {
    const halfW = 0.27; // Total width 0.54m
    const halfL = 0.29; // Total length 0.58m
    const shoulderL = 0.07;
    const notchL = -0.07;
    const halfH = 0.019; // Thickness ~0.038m

    // 6 2D local polygon vertices in clockwise order (Z+ is forward, X+ is right)
    const poly2D = [
      { x: 0, z: halfL },          // 0: Apex tip (forward)
      { x: halfW, z: shoulderL },   // 1: Right shoulder
      { x: halfW, z: -halfL },      // 2: Right bottom corner
      { x: 0, z: notchL },          // 3: Inner chevron notch
      { x: -halfW, z: -halfL },     // 4: Left bottom corner
      { x: -halfW, z: shoulderL }   // 5: Left shoulder
    ];

    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    // --- Top Face (Y = +halfH, Normal = (0, 1, 0)) ---
    const topBase = positions.length / 3;
    for (let i = 0; i < 6; i++) {
      positions.push(poly2D[i].x, halfH, poly2D[i].z);
      normals.push(0, 1, 0);
    }
    // Triangulate top face (convex split into 4 triangles: 0-1-3, 1-2-3, 0-3-5, 5-3-4)
    indices.push(topBase + 0, topBase + 1, topBase + 3);
    indices.push(topBase + 1, topBase + 2, topBase + 3);
    indices.push(topBase + 0, topBase + 3, topBase + 5);
    indices.push(topBase + 5, topBase + 3, topBase + 4);

    // --- Bottom Face (Y = -halfH, Normal = (0, -1, 0)) ---
    const botBase = positions.length / 3;
    for (let i = 0; i < 6; i++) {
      positions.push(poly2D[i].x, -halfH, poly2D[i].z);
      normals.push(0, -1, 0);
    }
    // Bottom face has reversed winding
    indices.push(botBase + 0, botBase + 3, botBase + 1);
    indices.push(botBase + 1, botBase + 3, botBase + 2);
    indices.push(botBase + 0, botBase + 5, botBase + 3);
    indices.push(botBase + 5, botBase + 4, botBase + 3);

    // --- 6 Side Walls (connecting top to bottom with outward facet normals) ---
    for (let i = 0; i < 6; i++) {
      const next = (i + 1) % 6;
      const p1 = poly2D[i];
      const p2 = poly2D[next];

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.hypot(dx, dz) || 1.0;
      // 2D outward normal is (dz, -dx) / len
      const nx = dz / len;
      const nz = -dx / len;

      const sideBase = positions.length / 3;
      // 4 vertices per side quad
      positions.push(p1.x, halfH, p1.z);   // 0: top p1
      positions.push(p2.x, halfH, p2.z);   // 1: top p2
      positions.push(p2.x, -halfH, p2.z);  // 2: bot p2
      positions.push(p1.x, -halfH, p1.z);  // 3: bot p1

      normals.push(nx, 0, nz);
      normals.push(nx, 0, nz);
      normals.push(nx, 0, nz);
      normals.push(nx, 0, nz);

      indices.push(sideBase + 0, sideBase + 1, sideBase + 2);
      indices.push(sideBase + 0, sideBase + 2, sideBase + 3);
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.indices = indices;
    vd.applyToMesh(this.arrowMesh, false);
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
    this.arrowMesh.setEnabled(visible && this.isArrowActive);
  }

  public showAimArrow(_ballPos: Vector3) {
    this.isArrowActive = true;
    this.arrowMesh.setEnabled(this.isVisible);
  }

  public hideAimArrow() {
    this.isArrowActive = false;
    this.arrowMesh.setEnabled(false);
  }

  public adjustHeading(deltaDeg: number) {
    this.aimHeadingDeg = (this.aimHeadingDeg + deltaDeg) % 360;
  }

  public adjustDistance(deltaMeters: number) {
    this.targetDistanceMeters = Math.max(15, Math.min(340, this.targetDistanceMeters + deltaMeters));
  }

  public setTargetPosition(ballPos: Vector3, clickX: number, clickZ: number) {
    const dx = clickX - ballPos.x;
    const dz = clickZ - ballPos.z;
    this.targetDistanceMeters = Math.max(15, Math.min(340, Math.sqrt(dx * dx + dz * dz)));
    this.aimHeadingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
  }

  public update(
    ballPos: Vector3,
    _club: ClubSpec,
    _windSpeedMps?: number,
    _windHeadingDeg?: number
  ) {
    const rad = (this.aimHeadingDeg * Math.PI) / 180.0;
    const targetX = ballPos.x + Math.sin(rad) * this.targetDistanceMeters;
    const targetZ = ballPos.z + Math.cos(rad) * this.targetDistanceMeters;
    const groundY = this.terrain.getElevation(targetX, targetZ);

    this.targetPosition.set(targetX, groundY, targetZ);

    // Position 3D golden chevron 1.35m ahead of the ball, floating closely above turf (0.065m) per user request
    const arrowDist = 1.35;
    const arrowX = ballPos.x + Math.sin(rad) * arrowDist;
    const arrowZ = ballPos.z + Math.cos(rad) * arrowDist;
    const arrowGroundY = this.terrain.getElevation(arrowX, arrowZ);

    this.arrowMesh.position.set(arrowX, arrowGroundY + 0.065, arrowZ);
    this.arrowMesh.rotation.y = rad;

    // Subtle gentle broadcast breathing pulse
    this.pulseTime += 0.04;
    const scale = 1.0 + Math.sin(this.pulseTime) * 0.035;
    this.arrowMesh.scaling.set(scale, scale, scale);

    this.arrowMesh.setEnabled(this.isVisible && this.isArrowActive);
  }

  public dispose() {
    this.arrowMesh.dispose();
    this.arrowMat.dispose();
  }
}
