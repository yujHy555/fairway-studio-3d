import {
  Scene,
  Vector3
} from '@babylonjs/core';
import { ClubSpec } from '../core/Types';
import { TerrainGrid } from '../terrain/TerrainGrid';

/**
 * Clean PGA Tour Aim State Tracker
 * Calculates aim azimuth and landing elevation along the player's target line
 * without placing any artificial blue target rings or beacons on the course.
 */
export class AimSystem {
  private terrain: TerrainGrid;

  public aimHeadingDeg: number = 0;
  public targetDistanceMeters: number = 220;
  public targetPosition: Vector3 = new Vector3(110, 0, 260);
  public isVisible: boolean = true;

  constructor(_scene: Scene, terrain: TerrainGrid) {
    this.terrain = terrain;
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
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
  }

  public dispose() {}
}
