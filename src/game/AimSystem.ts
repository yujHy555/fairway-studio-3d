import {
  Scene,
  Vector3,
  Mesh,
  VertexData,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Quaternion,
  ShadowGenerator
} from '@babylonjs/core';
import { ClubSpec } from '../core/Types';
import { TerrainGrid } from '../terrain/TerrainGrid';

/**
 * Modern PGA-Style 3D Directional Aim Chevron Indicator
 * Modeled precisely on broadcast arrow design reference:
 * A sleek golden-yellow chevron hovering safely above the turf (never penetrating),
 * tilting to match terrain slope, with a dedicated soft PGA broadcast ground shadow.
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
    this.arrowMesh.receiveShadows = false; // Strictly never receives shadows: completely eliminates shadows on top of the arrow

    // Build the extruded 3D chevron arrow geometry (matching reference image)
    this.buildChevronGeometry();

    // Non-reflective, non-specular tournament aim chevron material
    const mat = new StandardMaterial('modernAimChevronMat', this.scene);
    mat.diffuseColor = Color3.FromHexString('#E09400'); // Warm tournament golden amber (stays rich gold under direct sun)
    mat.specularColor = new Color3(0, 0, 0);            // Strictly non-reflective, zero specular shine
    mat.emissiveColor = Color3.FromHexString('#482B00'); // Balanced warm glow while preserving 3D bevel contrast
    mat.backFaceCulling = true;
    this.arrowMat = mat;
    this.arrowMesh.material = this.arrowMat;

    // Register with real-time scene shadow generator so it casts soft ground shadow beneath it
    if (shadowGenerator && typeof (shadowGenerator as any).addShadowCaster === 'function') {
      (shadowGenerator as any).addShadowCaster(this.arrowMesh);
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
    const uvs: number[] = [];
    const indices: number[] = [];

    // --- Top Face (Y = +halfH, Normal = (0, 1, 0)) ---
    const topBase = positions.length / 3;
    for (let i = 0; i < 6; i++) {
      positions.push(poly2D[i].x, halfH, poly2D[i].z);
      normals.push(0, 1, 0);
      uvs.push((poly2D[i].x + halfW) / (2 * halfW), (poly2D[i].z + halfL) / (2 * halfL));
    }
    // Triangulate top face with outward CCW winding (4 triangles: 0-3-1, 1-3-2, 0-5-3, 5-4-3)
    indices.push(topBase + 0, topBase + 3, topBase + 1);
    indices.push(topBase + 1, topBase + 3, topBase + 2);
    indices.push(topBase + 0, topBase + 5, topBase + 3);
    indices.push(topBase + 5, topBase + 4, topBase + 3);

    // --- Bottom Face (Y = -halfH, Normal = (0, -1, 0)) ---
    const botBase = positions.length / 3;
    for (let i = 0; i < 6; i++) {
      positions.push(poly2D[i].x, -halfH, poly2D[i].z);
      normals.push(0, -1, 0);
      uvs.push((poly2D[i].x + halfW) / (2 * halfW), (poly2D[i].z + halfL) / (2 * halfL));
    }
    // Bottom face has outward CCW winding looking from -Y
    indices.push(botBase + 0, botBase + 1, botBase + 3);
    indices.push(botBase + 1, botBase + 2, botBase + 3);
    indices.push(botBase + 0, botBase + 3, botBase + 5);
    indices.push(botBase + 5, botBase + 3, botBase + 4);

    // --- 6 Side Walls (connecting top to bottom with outward facet normals) ---
    for (let i = 0; i < 6; i++) {
      const next = (i + 1) % 6;
      const p1 = poly2D[i];
      const p2 = poly2D[next];

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.hypot(dx, dz) || 1.0;
      // 2D outward normal for clockwise polygon is (-dz, dx) / len
      const nx = -dz / len;
      const nz = dx / len;

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

      uvs.push(0, 1, 1, 1, 1, 0, 0, 0);

      indices.push(sideBase + 0, sideBase + 1, sideBase + 2);
      indices.push(sideBase + 0, sideBase + 2, sideBase + 3);
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
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

    // Position 3D golden chevron 1.35m ahead of the ball
    const arrowDist = 1.35;
    const arrowX = ballPos.x + Math.sin(rad) * arrowDist;
    const arrowZ = ballPos.z + Math.cos(rad) * arrowDist;

    const halfW = 0.27;
    const halfL = 0.29;
    const shoulderL = 0.07;
    const notchL = -0.07;
    const halfH = 0.019;

    // Sample terrain elevation at all 7 key perimeter & shoulder points of the chevron
    const sinR = Math.sin(rad);
    const cosR = Math.cos(rad);

    const tipX = arrowX + sinR * halfL;
    const tipZ = arrowZ + cosR * halfL;
    const shLX = arrowX + sinR * shoulderL - cosR * halfW;
    const shLZ = arrowZ + cosR * shoulderL + sinR * halfW;
    const shRX = arrowX + sinR * shoulderL + cosR * halfW;
    const shRZ = arrowZ + cosR * shoulderL - sinR * halfW;
    const tailLX = arrowX - sinR * halfL - cosR * halfW;
    const tailLZ = arrowZ - cosR * halfL + sinR * halfW;
    const tailRX = arrowX - sinR * halfL + cosR * halfW;
    const tailRZ = arrowZ - cosR * halfL - sinR * halfW;
    const notchX = arrowX + sinR * notchL;
    const notchZ = arrowZ + cosR * notchL;

    const yCenter = this.terrain.getElevation(arrowX, arrowZ);
    const yTip = this.terrain.getElevation(tipX, tipZ);
    const yShL = this.terrain.getElevation(shLX, shLZ);
    const yShR = this.terrain.getElevation(shRX, shRZ);
    const yTL = this.terrain.getElevation(tailLX, tailLZ);
    const yTR = this.terrain.getElevation(tailRX, tailRZ);
    const yNotch = this.terrain.getElevation(notchX, notchZ);

    // Guaranteed highest terrain elevation under any vertex of the chevron
    const maxTurfY = Math.max(yCenter, yTip, yShL, yShR, yTL, yTR, yNotch);

    // Pitch & roll of the local terrain slope
    const dYForward = yTip - (yTL + yTR) * 0.5;
    const pitchAngle = Math.atan2(dYForward, 2 * halfL);

    const dYAcross = yTR - yTL;
    const rollAngle = Math.atan2(dYAcross, 2 * halfW);

    // Build strictly orthonormal 3D basis so the chevron perfectly parallels the terrain slope
    const forward = new Vector3(sinR, Math.sin(pitchAngle), cosR).normalize();
    const rightApprox = new Vector3(cosR, Math.sin(rollAngle), -sinR).normalize();
    const up = Vector3.Cross(forward, rightApprox).normalize();
    const right = Vector3.Cross(up, forward).normalize();
    const rotQuat = Quaternion.RotationQuaternionFromAxis(right, up, forward);

    // Safe hover height above turf: zero ground penetration AND separates directional sun shadow cleanly into view
    const safeArrowY = maxTurfY + halfH + 0.155;
    this.arrowMesh.position.set(arrowX, safeArrowY, arrowZ);
    this.arrowMesh.rotationQuaternion = rotQuat;

    // Gentle horizontal breathing pulse (X/Z only, never vertical to prevent height vibration)
    this.pulseTime += 0.04;
    const pulseScale = 1.0 + Math.sin(this.pulseTime) * 0.032;
    this.arrowMesh.scaling.set(pulseScale, 1.0, pulseScale);

    this.arrowMesh.setEnabled(this.isVisible && this.isArrowActive);
  }

  public dispose() {
    this.arrowMesh.dispose();
    this.arrowMat.dispose();
  }
}
