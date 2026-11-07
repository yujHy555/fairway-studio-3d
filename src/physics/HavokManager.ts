import {
  Scene,
  Vector3,
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeMesh,
  PhysicsShapeSphere
} from '@babylonjs/core';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import HavokPhysics from '@babylonjs/havok';
import { GOLF_CONSTANTS } from '../core/Constants';

export class HavokManager {
  private static instance: HavokManager | null = null;
  public plugin: HavokPlugin | null = null;
  public isReady = false;

  private scene: Scene;
  private terrainBody: PhysicsBody | null = null;
  private terrainShape: PhysicsShapeMesh | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public async initialize(): Promise<boolean> {
    try {
      const havokInterface = await HavokPhysics({
        locateFile: () => '/HavokPhysics.wasm'
      });

      this.plugin = new HavokPlugin(true, havokInterface);
      this.scene.enablePhysics(new Vector3(0, GOLF_CONSTANTS.GRAVITY, 0), this.plugin);
      this.isReady = true;
      console.log('Havok Physics Engine initialized successfully.');
      return true;
    } catch (err) {
      console.error('Failed to initialize Havok WASM:', err);
      return false;
    }
  }

  /**
   * Generates or updates static collision body for the 1m grid terrain mesh
   */
  public updateTerrainCollision(terrainMesh: Mesh) {
    if (!this.isReady || !this.plugin) return;

    if (this.terrainBody) {
      this.terrainBody.dispose();
      this.terrainBody = null;
    }
    if (this.terrainShape) {
      this.terrainShape.dispose();
      this.terrainShape = null;
    }

    try {
      this.terrainShape = new PhysicsShapeMesh(terrainMesh, this.scene);
      this.terrainShape.material = {
        friction: 0.5,
        restitution: 0.25
      };

      this.terrainBody = new PhysicsBody(
        terrainMesh,
        PhysicsMotionType.STATIC,
        false,
        this.scene
      );
      this.terrainBody.shape = this.terrainShape;
      this.terrainBody.setMassProperties({ mass: 0 });
    } catch (e) {
      console.warn('Terrain collision update warning:', e);
    }
  }

  /**
   * Creates a high-precision dynamic physics body for the golf ball
   */
  public createBallPhysicsBody(ballMesh: Mesh): PhysicsBody {
    const shape = new PhysicsShapeSphere(
      Vector3.Zero(),
      GOLF_CONSTANTS.BALL_RADIUS,
      this.scene
    );
    shape.material = {
      friction: 0.25,
      restitution: 0.40
    };

    const body = new PhysicsBody(
      ballMesh,
      PhysicsMotionType.DYNAMIC,
      false,
      this.scene
    );
    body.shape = shape;
    body.setMassProperties({
      mass: GOLF_CONSTANTS.BALL_MASS,
      inertia: new Vector3(
        0.4 * GOLF_CONSTANTS.BALL_MASS * Math.pow(GOLF_CONSTANTS.BALL_RADIUS, 2),
        0.4 * GOLF_CONSTANTS.BALL_MASS * Math.pow(GOLF_CONSTANTS.BALL_RADIUS, 2),
        0.4 * GOLF_CONSTANTS.BALL_MASS * Math.pow(GOLF_CONSTANTS.BALL_RADIUS, 2)
      )
    });

    // Linear and angular damping
    body.setLinearDamping(0.02);
    body.setAngularDamping(0.04);

    return body;
  }
}
