import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3
} from '@babylonjs/core';
import { GOLF_CONSTANTS } from '../core/Constants';

export class SceneryFactory {
  private scene: Scene;

  // Shared reusable materials
  private matPineTrunk: StandardMaterial;
  private matPineNeedles: StandardMaterial;
  private matOakFoliage: StandardMaterial;
  private matRock: StandardMaterial;
  private matDam: StandardMaterial;
  private matWater: StandardMaterial;
  private matPinPole: StandardMaterial;
  private matPinFlag: StandardMaterial;
  private matCup: StandardMaterial;

  constructor(scene: Scene) {
    this.scene = scene;

    // Materials
    this.matPineTrunk = new StandardMaterial('matPineTrunk', scene);
    this.matPineTrunk.diffuseColor = new Color3(0.35, 0.22, 0.12);
    this.matPineTrunk.specularColor = new Color3(0, 0, 0);

    this.matPineNeedles = new StandardMaterial('matPineNeedles', scene);
    this.matPineNeedles.diffuseColor = new Color3(0.12, 0.35, 0.18);
    this.matPineNeedles.specularColor = new Color3(0.05, 0.05, 0.05);

    this.matOakFoliage = new StandardMaterial('matOakFoliage', scene);
    this.matOakFoliage.diffuseColor = new Color3(0.24, 0.58, 0.20);
    this.matOakFoliage.specularColor = new Color3(0.05, 0.05, 0.05);

    this.matRock = new StandardMaterial('matRock', scene);
    this.matRock.diffuseColor = new Color3(0.52, 0.53, 0.55);
    this.matRock.specularColor = new Color3(0.1, 0.1, 0.1);

    this.matDam = new StandardMaterial('matDam', scene);
    this.matDam.diffuseColor = new Color3(0.42, 0.44, 0.46);
    this.matDam.specularColor = new Color3(0.1, 0.1, 0.1);

    this.matWater = new StandardMaterial('matWater', scene);
    this.matWater.diffuseColor = new Color3(0.12, 0.48, 0.72);
    this.matWater.specularColor = new Color3(0.6, 0.8, 1.0);
    this.matWater.alpha = 0.85;

    this.matPinPole = new StandardMaterial('matPinPole', scene);
    this.matPinPole.diffuseColor = new Color3(0.95, 0.95, 0.95);
    this.matPinPole.specularColor = new Color3(0.3, 0.3, 0.3);

    this.matPinFlag = new StandardMaterial('matPinFlag', scene);
    this.matPinFlag.diffuseColor = new Color3(0.9, 0.15, 0.15); // Bright tournament red
    this.matPinFlag.backFaceCulling = false;

    this.matCup = new StandardMaterial('matCup', scene);
    this.matCup.diffuseColor = new Color3(0.15, 0.15, 0.15);
  }

  public createPineTree(x: number, y: number, z: number, scale = 1.0): Mesh {
    const root = new Mesh(`pine_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    // Trunk
    const trunk = MeshBuilder.CreateCylinder(`trunk_pine_${x}_${z}`, {
      height: 2.2 * scale,
      diameterTop: 0.3 * scale,
      diameterBottom: 0.5 * scale,
      tessellation: 6 // Low poly hex cylinder
    }, this.scene);
    trunk.position.y = (2.2 * scale) * 0.5;
    trunk.material = this.matPineTrunk;
    trunk.receiveShadows = true;
    trunk.parent = root;

    // 3 Foliage cones
    const tiers = [
      { y: 1.8 * scale, d: 3.2 * scale, h: 2.5 * scale },
      { y: 3.2 * scale, d: 2.4 * scale, h: 2.2 * scale },
      { y: 4.5 * scale, d: 1.5 * scale, h: 2.0 * scale }
    ];

    for (let i = 0; i < tiers.length; i++) {
      const cone = MeshBuilder.CreateCylinder(`cone_${x}_${z}_${i}`, {
        height: tiers[i].h,
        diameterTop: 0.05,
        diameterBottom: tiers[i].d,
        tessellation: 7
      }, this.scene);
      cone.position.y = tiers[i].y;
      cone.material = this.matPineNeedles;
      cone.receiveShadows = true;
      cone.parent = root;
    }

    return root;
  }

  public createOakTree(x: number, y: number, z: number, scale = 1.0): Mesh {
    const root = new Mesh(`oak_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    // Trunk
    const trunk = MeshBuilder.CreateCylinder(`trunk_oak_${x}_${z}`, {
      height: 2.5 * scale,
      diameterTop: 0.5 * scale,
      diameterBottom: 0.8 * scale,
      tessellation: 6
    }, this.scene);
    trunk.position.y = (2.5 * scale) * 0.5;
    trunk.material = this.matPineTrunk;
    trunk.receiveShadows = true;
    trunk.parent = root;

    // Canopy spheres (low-poly icosahedrons)
    const canopies = [
      { x: 0, y: 3.4 * scale, z: 0, s: 3.2 * scale },
      { x: -0.8 * scale, y: 3.0 * scale, z: 0.6 * scale, s: 2.4 * scale },
      { x: 0.7 * scale, y: 3.1 * scale, z: -0.5 * scale, s: 2.2 * scale }
    ];

    for (let i = 0; i < canopies.length; i++) {
      const c = MeshBuilder.CreatePolyhedron(`canopy_${x}_${z}_${i}`, {
        type: 1, // Icosahedron
        size: canopies[i].s * 0.5
      }, this.scene);
      c.position.set(canopies[i].x, canopies[i].y, canopies[i].z);
      c.material = this.matOakFoliage;
      c.receiveShadows = true;
      c.parent = root;
    }

    return root;
  }

  public createRockCluster(x: number, y: number, z: number, scale = 1.0): Mesh {
    const root = new Mesh(`rocks_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    const rocks = [
      { x: 0, y: 0.5 * scale, z: 0, sx: 1.8 * scale, sy: 1.1 * scale, sz: 1.5 * scale, rot: 0.4 },
      { x: 1.1 * scale, y: 0.3 * scale, z: 0.5 * scale, sx: 1.0 * scale, sy: 0.8 * scale, sz: 1.1 * scale, rot: 1.2 },
      { x: -0.9 * scale, y: 0.35 * scale, z: -0.4 * scale, sx: 1.2 * scale, sy: 0.9 * scale, sz: 1.3 * scale, rot: -0.7 }
    ];

    for (let i = 0; i < rocks.length; i++) {
      const r = MeshBuilder.CreatePolyhedron(`rock_${x}_${z}_${i}`, {
        type: 2, // Octahedron / low-poly boulder
        size: 0.7
      }, this.scene);
      r.position.set(rocks[i].x, rocks[i].y, rocks[i].z);
      r.scaling.set(rocks[i].sx, rocks[i].sy, rocks[i].sz);
      r.rotation.y = rocks[i].rot;
      r.material = this.matRock;
      r.receiveShadows = true;
      r.parent = root;
    }

    return root;
  }

  public createDamWall(x: number, y: number, z: number, width = 30, height = 4): Mesh {
    const wall = MeshBuilder.CreateBox(`dam_${x}_${z}`, {
      width: width,
      height: height,
      depth: 3.5
    }, this.scene);
    wall.position.set(x, y + height * 0.5, z);
    wall.material = this.matDam;
    wall.receiveShadows = true;
    return wall;
  }

  public createWaterPlane(x: number, rimElevation: number, z: number, width: number, length: number): Mesh {
    // Elliptical water disc that matches pond contours without sharp 90-deg corners clipping into shores
    const water = MeshBuilder.CreateDisc(`water_${x}_${z}`, {
      radius: 1.0,
      tessellation: 36
    }, this.scene);
    water.rotation.x = Math.PI * 0.5;
    water.scaling.set(width * 0.5, length * 0.5, 1.0);
    // Position comfortably 0.22m below the surrounding terrain rim inside the carved basin
    water.position.set(x, rimElevation - 0.22, z);
    water.material = this.matWater;
    water.receiveShadows = true;
    return water;
  }

  /**
   * Regulation Golf Hole Cup + Flagstick
   */
  public createPinAndCup(x: number, groundY: number, z: number, holeNumber = 1): Mesh {
    const pinRoot = new Mesh(`pin_hole_${holeNumber}`, this.scene);
    pinRoot.position.set(x, groundY, z);

    // Cup rim / hole
    const cup = MeshBuilder.CreateCylinder(`cup_${holeNumber}`, {
      height: GOLF_CONSTANTS.CUP_DEPTH,
      diameter: GOLF_CONSTANTS.CUP_RADIUS * 2,
      tessellation: 16
    }, this.scene);
    cup.position.y = -GOLF_CONSTANTS.CUP_DEPTH * 0.5;
    cup.material = this.matCup;
    cup.parent = pinRoot;

    // Flagstick pole (2.4m tall, 3.5cm diameter for prominent cast shadow)
    const pole = MeshBuilder.CreateCylinder(`pole_${holeNumber}`, {
      height: 2.4,
      diameter: 0.035,
      tessellation: 8
    }, this.scene);
    pole.position.y = 1.2;
    pole.material = this.matPinPole;
    pole.receiveShadows = true;
    pole.parent = pinRoot;

    // Tournament Flag cloth (0.65m x 0.40m vibrant tournament red)
    const flag = MeshBuilder.CreatePlane(`flag_${holeNumber}`, {
      width: 0.65,
      height: 0.40
    }, this.scene);
    flag.position.set(0.33, 2.15, 0);
    flag.material = this.matPinFlag;
    flag.receiveShadows = true;
    flag.parent = pinRoot;

    return pinRoot;
  }

  /**
   * Tournament Tee Markers (Pair of low-poly championship cubes with grounded contact shadow bases)
   */
  public createTeeMarkers(x: number, groundY: number, z: number): Mesh {
    const root = new Mesh(`tee_markers_${x}_${z}`, this.scene);
    root.position.set(x, groundY, z);

    // Tournament Left Tee: Championship Navy Blue
    const matLeft = new StandardMaterial('matTeeLeft', this.scene);
    matLeft.diffuseColor = new Color3(0.12, 0.28, 0.65);
    matLeft.specularColor = new Color3(0.15, 0.15, 0.15);
    matLeft.specularPower = 16;

    // Tournament Right Tee: Championship Crimson Red
    const matRight = new StandardMaterial('matTeeRight', this.scene);
    matRight.diffuseColor = new Color3(0.72, 0.16, 0.16);
    matRight.specularColor = new Color3(0.15, 0.15, 0.15);
    matRight.specularPower = 16;

    // Dark contact shadow plate under each marker
    const matBase = new StandardMaterial('matTeeBase', this.scene);
    matBase.diffuseColor = new Color3(0.04, 0.04, 0.04);
    matBase.specularColor = new Color3(0, 0, 0);
    matBase.disableLighting = true;
    matBase.alpha = 0.55;

    // Left and right markers 3.0 meters apart, 0.20m championship size
    [-1.5, 1.5].forEach((offset, i) => {
      // 1. Soft contact shadow disc under marker
      const shadowBase = MeshBuilder.CreateDisc(`tee_shadow_${i}`, {
        radius: 0.16,
        tessellation: 16
      }, this.scene);
      shadowBase.rotation.x = Math.PI * 0.5;
      shadowBase.position.set(offset, 0.008, 0);
      shadowBase.material = matBase;
      shadowBase.parent = root;

      // 2. Bevelled tournament block
      const cube = MeshBuilder.CreateBox(`tee_cube_${i}`, {
        width: 0.20,
        height: 0.16,
        depth: 0.20
      }, this.scene);
      cube.position.set(offset, 0.08, 0);
      cube.rotation.y = (i === 0 ? 0.3 : -0.3);
      cube.material = i === 0 ? matLeft : matRight;
      cube.receiveShadows = true;
      cube.parent = root;
    });

    return root;
  }
}
