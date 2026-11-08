import {
  Scene,
  Vector3,
  Mesh,
  VertexData,
  StandardMaterial,
  DynamicTexture,
  Material,
  Color3
} from '@babylonjs/core';
import { ClubSpec } from '../core/Types';
import { TerrainGrid } from '../terrain/TerrainGrid';

/**
 * Clean PGA Tour Aim State Tracker & Modern 3D Directional Arrow Indicator
 * Displays a sleek, terrain-conforming 3D directional arrow in front of the ball
 * whenever the player uses the aiming arrow keys to dial in their shot heading.
 */
export class AimSystem {
  private scene: Scene;
  private terrain: TerrainGrid;

  public aimHeadingDeg: number = 0;
  public targetDistanceMeters: number = 220;
  public targetPosition: Vector3 = new Vector3(110, 0, 260);
  public isVisible: boolean = true;

  private arrowMesh: Mesh;
  private arrowMat: StandardMaterial;
  private arrowTex: DynamicTexture;
  private isArrowActive: boolean = false;
  private pulseTime: number = 0;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    this.arrowMesh = new Mesh('cup_modernAimArrow', this.scene);
    this.arrowMesh.isPickable = false;
    this.arrowMesh.setEnabled(false);

    this.arrowTex = new DynamicTexture('modernAimArrowTex', { width: 256, height: 512 }, this.scene, false);
    this.drawModernArrowTexture();

    this.arrowMat = new StandardMaterial('modernAimArrowMat', this.scene);
    this.arrowMat.diffuseTexture = this.arrowTex;
    this.arrowMat.opacityTexture = this.arrowTex;
    this.arrowMat.emissiveColor = new Color3(0.20, 0.96, 0.72);
    this.arrowMat.specularColor = new Color3(0, 0, 0);
    this.arrowMat.disableLighting = true;
    this.arrowMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.arrowMat.backFaceCulling = false;
    this.arrowMat.zOffset = -2;
    this.arrowMesh.material = this.arrowMat;
  }

  /**
   * Renders a sleek, modern broadcast-style directional arrow with forward chevrons
   * onto a high-res alpha texture (V=0 is near the ball, V=1 is the arrowhead tip).
   */
  private drawModernArrowTexture() {
    const ctx = this.arrowTex.getContext() as CanvasRenderingContext2D;
    const W = 256;
    const H = 512;
    ctx.clearRect(0, 0, W, H);

    // Note: in Babylon UV space, canvas Y=0 is at the far tip (V=1) and canvas Y=H is near the ball (V=0)
    // Soft outer glow behind the shaft & arrowhead
    const glowGrad = ctx.createLinearGradient(0, H, 0, 0);
    glowGrad.addColorStop(0.0, 'rgba(16, 245, 165, 0.0)');
    glowGrad.addColorStop(0.25, 'rgba(16, 245, 165, 0.35)');
    glowGrad.addColorStop(0.85, 'rgba(56, 255, 200, 0.85)');
    glowGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.95)');

    // 1. Tapered sleek central shaft (from Y = 460 up to Y = 135)
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.moveTo(128 - 10, 465);
    ctx.lineTo(128 + 10, 465);
    ctx.lineTo(128 + 20, 140);
    ctx.lineTo(128 - 20, 140);
    ctx.closePath();
    ctx.fill();

    // Crisp dark contrast outline on shaft
    ctx.strokeStyle = 'rgba(6, 38, 28, 0.65)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 2. Three modern forward speed chevrons along the shaft
    const chevronYs = [380, 295, 210];
    for (let i = 0; i < chevronYs.length; i++) {
      const cy = chevronYs[i];
      const halfSpan = 38 + i * 6;
      ctx.fillStyle = i === 2 ? '#ffffff' : 'rgba(185, 255, 232, 0.92)';
      ctx.beginPath();
      ctx.moveTo(128 - halfSpan, cy + 26);
      ctx.lineTo(128, cy - 8);
      ctx.lineTo(128 + halfSpan, cy + 26);
      ctx.lineTo(128 + halfSpan - 11, cy + 36);
      ctx.lineTo(128, cy + 10);
      ctx.lineTo(128 - halfSpan + 11, cy + 36);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Sleek swept-wing arrowhead at the front tip (Y = 18..155)
    const tipGrad = ctx.createLinearGradient(0, 155, 0, 18);
    tipGrad.addColorStop(0, '#22f5a8');
    tipGrad.addColorStop(0.6, '#7affd2');
    tipGrad.addColorStop(1, '#ffffff');

    ctx.fillStyle = tipGrad;
    ctx.beginPath();
    ctx.moveTo(128, 18);          // Sharp front apex
    ctx.lineTo(206, 148);         // Right swept wingtip
    ctx.lineTo(164, 132);         // Right inner notch
    ctx.lineTo(128, 92);          // Center inner notch
    ctx.lineTo(92, 132);          // Left inner notch
    ctx.lineTo(50, 148);          // Left swept wingtip
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(6, 42, 30, 0.78)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    this.arrowTex.hasAlpha = true;
    this.arrowTex.update(false);
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
    if (!visible) {
      this.hideAimArrow();
    }
  }

  /**
   * Called when the player presses Left/Right aiming arrow keys (or UI aim buttons)
   * so the modern directional arrow immediately appears and tracks the chosen direction.
   */
  public showAimArrow(ballPos: Vector3) {
    this.isArrowActive = true;
    this.arrowMesh.setEnabled(true);
    this.rebuildConformingArrowGeometry(ballPos);
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

  private rebuildConformingArrowGeometry(ballPos: Vector3) {
    const rad = (this.aimHeadingDeg * Math.PI) / 180.0;
    const dirX = Math.sin(rad);
    const dirZ = Math.cos(rad);
    const rightX = Math.cos(rad);
    const rightZ = -Math.sin(rad);

    const startDist = 0.18;
    const endDist = 2.35;
    const halfWidth = 0.28;
    const segments = 14;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const d = startDist + (endDist - startDist) * t;
      const cx = ballPos.x + dirX * d;
      const cz = ballPos.z + dirZ * d;

      const lx = cx - rightX * halfWidth;
      const lz = cz - rightZ * halfWidth;
      const ly = this.terrain.getElevation(lx, lz) + 0.018;

      const rx = cx + rightX * halfWidth;
      const rz = cz + rightZ * halfWidth;
      const ry = this.terrain.getElevation(rx, rz) + 0.018;

      positions.push(lx, ly, lz);
      positions.push(rx, ry, rz);

      normals.push(0, 1, 0);
      normals.push(0, 1, 0);

      uvs.push(0, 1 - t);
      uvs.push(1, 1 - t);

      if (i < segments) {
        const base = i * 2;
        indices.push(base, base + 2, base + 1);
        indices.push(base + 1, base + 2, base + 3);
      }
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(this.arrowMesh, false);
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

    if (this.isArrowActive && this.isVisible) {
      this.pulseTime += 0.06;
      this.arrowMat.alpha = 0.84 + Math.sin(this.pulseTime) * 0.14;
      this.rebuildConformingArrowGeometry(ballPos);
    }
  }

  public dispose() {
    this.arrowMesh.dispose();
    this.arrowMat.dispose();
    this.arrowTex.dispose();
  }
}
