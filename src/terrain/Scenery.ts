import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  VertexBuffer,
  VertexData,
  FresnelParameters
} from '@babylonjs/core';
import { GOLF_CONSTANTS } from '../core/Constants';
import { RealisticTextures } from './RealisticTextures';

export class SceneryFactory {
  private scene: Scene;

  // Shared realistic materials with seamless textures & normal maps
  private matPineTrunk: StandardMaterial;
  private matPineNeedles: StandardMaterial;
  private matOakFoliage: StandardMaterial;
  private matRock: StandardMaterial;
  private matDam: StandardMaterial;
  private matWater: StandardMaterial;
  private matPinPole: StandardMaterial;
  private matPinFlag: StandardMaterial;
  private matCup: StandardMaterial;
  private matCupLiner: StandardMaterial;
  private matGoldTrim: StandardMaterial;

  private activeFlags: Mesh[] = [];
  private windTime = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    // 1. Seamless Tree Bark Material
    const barkTex = RealisticTextures.createSeamlessBarkTextures(scene);
    barkTex.diffuse.uScale = 2;
    barkTex.diffuse.vScale = 4;
    barkTex.normal.uScale = 2;
    barkTex.normal.vScale = 4;

    this.matPineTrunk = new StandardMaterial('matPineTrunk', scene);
    this.matPineTrunk.diffuseTexture = barkTex.diffuse;
    this.matPineTrunk.bumpTexture = barkTex.normal;
    this.matPineTrunk.specularColor = new Color3(0.04, 0.03, 0.02);

    // 2. Seamless Pine Needles Material
    const pineTex = RealisticTextures.createSeamlessFoliageTextures(scene, 'pine');
    pineTex.diffuse.uScale = 4;
    pineTex.diffuse.vScale = 4;
    pineTex.normal.uScale = 4;
    pineTex.normal.vScale = 4;

    this.matPineNeedles = new StandardMaterial('matPineNeedles', scene);
    this.matPineNeedles.diffuseTexture = pineTex.diffuse;
    this.matPineNeedles.bumpTexture = pineTex.normal;
    this.matPineNeedles.specularColor = new Color3(0.06, 0.08, 0.05);
    this.matPineNeedles.specularPower = 32;

    // 3. Seamless Oak Canopy Material
    const oakTex = RealisticTextures.createSeamlessFoliageTextures(scene, 'oak');
    oakTex.diffuse.uScale = 5;
    oakTex.diffuse.vScale = 5;
    oakTex.normal.uScale = 5;
    oakTex.normal.vScale = 5;

    this.matOakFoliage = new StandardMaterial('matOakFoliage', scene);
    this.matOakFoliage.diffuseTexture = oakTex.diffuse;
    this.matOakFoliage.bumpTexture = oakTex.normal;
    this.matOakFoliage.specularColor = new Color3(0.08, 0.10, 0.06);
    this.matOakFoliage.specularPower = 36;

    // 4. Seamless Granite Boulder Material
    const rockTex = RealisticTextures.createSeamlessRockTextures(scene);
    rockTex.diffuse.uScale = 3;
    rockTex.diffuse.vScale = 3;
    rockTex.normal.uScale = 3;
    rockTex.normal.vScale = 3;

    this.matRock = new StandardMaterial('matRock', scene);
    this.matRock.diffuseTexture = rockTex.diffuse;
    this.matRock.bumpTexture = rockTex.normal;
    this.matRock.specularColor = new Color3(0.14, 0.14, 0.15);
    this.matRock.specularPower = 48;

    // 5. Stone Retaining / Dam Wall Material
    this.matDam = new StandardMaterial('matDam', scene);
    this.matDam.diffuseTexture = rockTex.diffuse;
    this.matDam.bumpTexture = rockTex.normal;
    this.matDam.diffuseColor = new Color3(0.82, 0.84, 0.86);
    this.matDam.specularColor = new Color3(0.12, 0.12, 0.12);

    // 6. Realistic Animated Water Material with Seamless Wave Normal Map & Sky Reflection
    const waterDiffuse = RealisticTextures.createSeamlessWaterDiffuseTexture(scene);
    waterDiffuse.uScale = 6;
    waterDiffuse.vScale = 9;

    const waterNormal = RealisticTextures.createSeamlessWaterNormalTexture(scene);
    waterNormal.uScale = 8;
    waterNormal.vScale = 12;
    waterNormal.level = 0.65;

    this.matWater = new StandardMaterial('matWater', scene);
    this.matWater.diffuseTexture = waterDiffuse;
    this.matWater.bumpTexture = waterNormal;
    this.matWater.diffuseColor = new Color3(0.16, 0.48, 0.64);
    this.matWater.specularColor = new Color3(0.85, 0.92, 1.0);
    this.matWater.specularPower = 128;
    this.matWater.alpha = 0.88;

    if (this.scene.environmentTexture) {
      this.matWater.reflectionTexture = this.scene.environmentTexture;
      this.matWater.reflectionFresnelParameters = new FresnelParameters();
      this.matWater.reflectionFresnelParameters.bias = 0.15;
      this.matWater.reflectionFresnelParameters.power = 2.5;
      this.matWater.reflectionFresnelParameters.leftColor = new Color3(0.55, 0.65, 0.75);
      this.matWater.reflectionFresnelParameters.rightColor = new Color3(0.08, 0.18, 0.28);
    }

    // Animate water ripples & waving tournament flags
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      waterNormal.uOffset = (waterNormal.uOffset + dt * 0.028) % 1.0;
      waterNormal.vOffset = (waterNormal.vOffset + dt * 0.018) % 1.0;
      waterDiffuse.uOffset = (waterDiffuse.uOffset - dt * 0.012) % 1.0;

      this.windTime += dt * 3.8;
      this.animateFlags();
    });

    // 7. Pin, Cup & Trim Materials
    this.matPinPole = new StandardMaterial('matPinPole', scene);
    this.matPinPole.diffuseColor = new Color3(0.95, 0.95, 0.92);
    this.matPinPole.specularColor = new Color3(0.5, 0.5, 0.5);
    this.matPinPole.specularPower = 64;

    this.matPinFlag = new StandardMaterial('matPinFlag', scene);
    this.matPinFlag.diffuseColor = new Color3(0.86, 0.12, 0.14); // Rich tournament crimson
    this.matPinFlag.specularColor = new Color3(0.15, 0.12, 0.12);
    this.matPinFlag.backFaceCulling = false;

    this.matCup = new StandardMaterial('matCup', scene);
    this.matCup.diffuseColor = new Color3(0.08, 0.09, 0.10);
    this.matCup.specularColor = new Color3(0.05, 0.05, 0.05);

    this.matCupLiner = new StandardMaterial('matCupLiner', scene);
    this.matCupLiner.diffuseColor = new Color3(0.92, 0.94, 0.96);
    this.matCupLiner.specularColor = new Color3(0.3, 0.3, 0.3);

    this.matGoldTrim = new StandardMaterial('matGoldTrim', scene);
    this.matGoldTrim.diffuseColor = new Color3(0.85, 0.68, 0.24);
    this.matGoldTrim.specularColor = new Color3(0.75, 0.65, 0.35);
    this.matGoldTrim.specularPower = 64;
  }

  /**
   * Sculpt a smooth mesh's vertices with organic 3D displacement and recompute smooth normals
   */
  private applyOrganicSmoothDisplacement(mesh: Mesh, amplitude: number, freq: number, seed: number) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getIndices();
    if (!positions || !indices) return;

    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i];
      const py = positions[i + 1];
      const pz = positions[i + 2];

      const n =
        Math.sin(px * freq + seed) * Math.cos(py * freq * 0.9 + seed * 1.3) * Math.sin(pz * freq + seed * 0.7) +
        0.5 * Math.cos((px + pz) * freq * 1.8 + seed * 2.1);

      const scale = 1.0 + n * amplitude;
      positions[i] = px * scale;
      positions[i + 1] = py * (1.0 + n * amplitude * 0.65);
      positions[i + 2] = pz * scale;
    }

    const normals = new Float32Array(positions.length);
    VertexData.ComputeNormals(positions, indices, normals);
    mesh.setVerticesData(VertexBuffer.PositionKind, positions, false);
    mesh.setVerticesData(VertexBuffer.NormalKind, normals, false);
  }

  /**
   * Realistic Championship Conifer / Pine Tree (Smooth high-segment trunk & scalloped bough layers)
   */
  public createPineTree(x: number, y: number, z: number, scale = 1.0): Mesh {
    const root = new Mesh(`pine_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    // Smooth cylindrical bark trunk with root flare
    const trunk = MeshBuilder.CreateCylinder(`trunk_pine_${x}_${z}`, {
      height: 2.8 * scale,
      diameterTop: 0.26 * scale,
      diameterBottom: 0.56 * scale,
      tessellation: 24,
      subdivisions: 4
    }, this.scene);
    trunk.position.y = 1.4 * scale;
    trunk.material = this.matPineTrunk;
    trunk.receiveShadows = true;
    trunk.parent = root;

    // 6 overlapping smooth organic pine bough layers
    const tiers = [
      { y: 1.85 * scale, d: 3.6 * scale, h: 1.9 * scale },
      { y: 2.65 * scale, d: 3.2 * scale, h: 1.8 * scale },
      { y: 3.45 * scale, d: 2.7 * scale, h: 1.7 * scale },
      { y: 4.20 * scale, d: 2.2 * scale, h: 1.55 * scale },
      { y: 4.90 * scale, d: 1.65 * scale, h: 1.4 * scale },
      { y: 5.55 * scale, d: 1.05 * scale, h: 1.25 * scale }
    ];

    for (let i = 0; i < tiers.length; i++) {
      const cone = MeshBuilder.CreateCylinder(`cone_${x}_${z}_${i}`, {
        height: tiers[i].h,
        diameterTop: 0.12 * scale,
        diameterBottom: tiers[i].d,
        tessellation: 32,
        subdivisions: 4
      }, this.scene);

      // Softly scallop the pine bough skirt for natural foliage droop with smooth normals
      this.applyOrganicSmoothDisplacement(cone, 0.11, 2.2, x * 0.3 + z * 0.7 + i * 3.1);

      cone.position.y = tiers[i].y;
      cone.rotation.y = i * 0.85;
      cone.material = this.matPineNeedles;
      cone.receiveShadows = true;
      cone.parent = root;
    }

    return root;
  }

  /**
   * Realistic Deciduous Oak / Maple Tree (Smooth trunk, primary limbs & organic leaf clusters)
   */
  public createOakTree(x: number, y: number, z: number, scale = 1.0): Mesh {
    const root = new Mesh(`oak_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    // Smooth tapered trunk
    const trunk = MeshBuilder.CreateCylinder(`trunk_oak_${x}_${z}`, {
      height: 2.7 * scale,
      diameterTop: 0.46 * scale,
      diameterBottom: 0.82 * scale,
      tessellation: 24,
      subdivisions: 3
    }, this.scene);
    trunk.position.y = 1.35 * scale;
    trunk.material = this.matPineTrunk;
    trunk.receiveShadows = true;
    trunk.parent = root;

    // 3 Smooth structural branches
    const branches = [
      { rx: 0.45, rz: 0.35, y: 2.3 * scale, h: 1.5 * scale },
      { rx: -0.40, rz: 0.30, y: 2.2 * scale, h: 1.4 * scale },
      { rx: 0.15, rz: -0.48, y: 2.35 * scale, h: 1.45 * scale }
    ];
    for (let b = 0; b < branches.length; b++) {
      const limb = MeshBuilder.CreateCylinder(`limb_oak_${x}_${z}_${b}`, {
        height: branches[b].h,
        diameterTop: 0.18 * scale,
        diameterBottom: 0.34 * scale,
        tessellation: 16
      }, this.scene);
      limb.position.y = branches[b].y;
      limb.rotation.x = branches[b].rx;
      limb.rotation.z = branches[b].rz;
      limb.material = this.matPineTrunk;
      limb.receiveShadows = true;
      limb.parent = root;
    }

    // 7 Smooth high-segment organic foliage lobes forming a lush, realistic crown
    const canopies = [
      { x: 0, y: 3.9 * scale, z: 0, sx: 3.5 * scale, sy: 2.7 * scale, sz: 3.5 * scale },
      { x: -1.15 * scale, y: 3.35 * scale, z: 0.65 * scale, sx: 2.5 * scale, sy: 2.1 * scale, sz: 2.5 * scale },
      { x: 1.10 * scale, y: 3.40 * scale, z: -0.60 * scale, sx: 2.4 * scale, sy: 2.0 * scale, sz: 2.4 * scale },
      { x: 0.55 * scale, y: 3.50 * scale, z: 1.05 * scale, sx: 2.3 * scale, sy: 1.95 * scale, sz: 2.3 * scale },
      { x: -0.65 * scale, y: 3.45 * scale, z: -1.00 * scale, sx: 2.35 * scale, sy: 2.0 * scale, sz: 2.35 * scale },
      { x: 0.25 * scale, y: 4.55 * scale, z: 0.20 * scale, sx: 2.6 * scale, sy: 2.1 * scale, sz: 2.6 * scale },
      { x: -0.35 * scale, y: 4.35 * scale, z: -0.25 * scale, sx: 2.4 * scale, sy: 1.9 * scale, sz: 2.4 * scale }
    ];

    for (let i = 0; i < canopies.length; i++) {
      const c = MeshBuilder.CreateSphere(`canopy_${x}_${z}_${i}`, {
        diameter: 1.0,
        segments: 20
      }, this.scene);
      c.scaling.set(canopies[i].sx, canopies[i].sy, canopies[i].sz);
      this.applyOrganicSmoothDisplacement(c, 0.09, 3.4, x * 0.5 + z * 0.4 + i * 2.3);
      c.position.set(canopies[i].x, canopies[i].y, canopies[i].z);
      c.material = this.matOakFoliage;
      c.receiveShadows = true;
      c.parent = root;
    }

    return root;
  }

  /**
   * Realistic Smooth Granite Boulders (Subdivided displaced spheres with smooth normals)
   */
  public createRockCluster(x: number, y: number, z: number, scale = 1.0): Mesh {
    const root = new Mesh(`rocks_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    const rocks = [
      { x: 0, y: 0.42 * scale, z: 0, sx: 1.9 * scale, sy: 1.15 * scale, sz: 1.6 * scale, rot: 0.4 },
      { x: 1.15 * scale, y: 0.28 * scale, z: 0.55 * scale, sx: 1.15 * scale, sy: 0.82 * scale, sz: 1.2 * scale, rot: 1.2 },
      { x: -0.95 * scale, y: 0.32 * scale, z: -0.45 * scale, sx: 1.35 * scale, sy: 0.92 * scale, sz: 1.35 * scale, rot: -0.7 }
    ];

    for (let i = 0; i < rocks.length; i++) {
      const r = MeshBuilder.CreateSphere(`rock_${x}_${z}_${i}`, {
        diameter: 1.2,
        segments: 24
      }, this.scene);
      this.applyOrganicSmoothDisplacement(r, 0.16, 2.8, x + z + i * 5.7);
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
    const root = new Mesh(`dam_${x}_${z}`, this.scene);
    root.position.set(x, y, z);

    const wall = MeshBuilder.CreateBox(`dam_body_${x}_${z}`, {
      width: width,
      height: height,
      depth: 3.4
    }, this.scene);
    wall.position.y = height * 0.5;
    wall.material = this.matDam;
    wall.receiveShadows = true;
    wall.parent = root;

    // Stone coping cap along top of dam wall
    const cap = MeshBuilder.CreateBox(`dam_cap_${x}_${z}`, {
      width: width + 0.4,
      height: 0.35,
      depth: 3.8
    }, this.scene);
    cap.position.y = height + 0.175;
    cap.material = this.matDam;
    cap.receiveShadows = true;
    cap.parent = root;

    return root;
  }

  public createWaterPlane(x: number, rimElevation: number, z: number, width: number, length: number): Mesh {
    const water = MeshBuilder.CreateDisc(`water_${x}_${z}`, {
      radius: 1.0,
      tessellation: 64
    }, this.scene);
    water.rotation.x = Math.PI * 0.5;
    water.scaling.set(width * 0.5, length * 0.5, 1.0);
    water.position.set(x, rimElevation - 0.20, z);
    water.material = this.matWater;
    water.receiveShadows = true;
    return water;
  }

  /**
   * Regulation USGA Golf Hole Cup + Metal Liner + Tapered Flagstick + Waving Cloth Flag
   */
  public createPinAndCup(x: number, groundY: number, z: number, holeNumber = 1): Mesh {
    const pinRoot = new Mesh(`pin_hole_${holeNumber}`, this.scene);
    pinRoot.position.set(x, groundY, z);

    // 1. Dark recessed cup interior
    const cup = MeshBuilder.CreateCylinder(`cup_${holeNumber}`, {
      height: GOLF_CONSTANTS.CUP_DEPTH,
      diameter: GOLF_CONSTANTS.CUP_RADIUS * 2,
      tessellation: 32
    }, this.scene);
    cup.position.y = -GOLF_CONSTANTS.CUP_DEPTH * 0.5 + 0.002;
    cup.material = this.matCup;
    cup.parent = pinRoot;

    // 2. White USGA metal cup sleeve rim
    const liner = MeshBuilder.CreateTorus(`cup_liner_${holeNumber}`, {
      diameter: GOLF_CONSTANTS.CUP_RADIUS * 2,
      thickness: 0.008,
      tessellation: 32
    }, this.scene);
    liner.position.y = 0.002;
    liner.material = this.matCupLiner;
    liner.parent = pinRoot;

    // 3. Smooth tapered tournament flagstick pole (2.4m tall)
    const pole = MeshBuilder.CreateCylinder(`pole_${holeNumber}`, {
      height: 2.4,
      diameterTop: 0.024,
      diameterBottom: 0.032,
      tessellation: 24
    }, this.scene);
    pole.position.y = 1.2;
    pole.material = this.matPinPole;
    pole.receiveShadows = true;
    pole.parent = pinRoot;

    // Brass top ferrule finial
    const finial = MeshBuilder.CreateSphere(`pole_finial_${holeNumber}`, {
      diameter: 0.048,
      segments: 16
    }, this.scene);
    finial.position.y = 2.41;
    finial.material = this.matGoldTrim;
    finial.parent = pinRoot;

    // 4. Subdivided waving cloth tournament flag
    const flag = MeshBuilder.CreateGround(`flag_${holeNumber}`, {
      width: 0.62,
      height: 0.40,
      subdivisionsX: 14,
      subdivisionsY: 6,
      updatable: true
    }, this.scene);
    flag.rotation.x = -Math.PI * 0.5;
    flag.position.set(0.32, 2.16, 0);
    flag.material = this.matPinFlag;
    flag.receiveShadows = true;
    flag.parent = pinRoot;

    this.activeFlags = this.activeFlags.filter(f => !f.isDisposed());
    this.activeFlags.push(flag);

    return pinRoot;
  }

  private animateFlags() {
    for (const flag of this.activeFlags) {
      if (flag.isDisposed()) continue;
      const positions = flag.getVerticesData(VertexBuffer.PositionKind);
      const indices = flag.getIndices();
      if (!positions || !indices) continue;

      for (let i = 0; i < positions.length; i += 3) {
        const px = positions[i]; // -0.31 to +0.31 (hoist is at -0.31)
        const distFromPole = Math.max(0, (px + 0.31) / 0.62);
        const wave =
          Math.sin(distFromPole * 5.5 - this.windTime) * 0.045 * distFromPole +
          Math.cos(distFromPole * 9.0 - this.windTime * 1.4) * 0.015 * distFromPole;
        positions[i + 1] = wave;
      }

      const normals = new Float32Array(positions.length);
      VertexData.ComputeNormals(positions, indices, normals);
      flag.updateVerticesData(VertexBuffer.PositionKind, positions);
      flag.updateVerticesData(VertexBuffer.NormalKind, normals);
    }
  }

  /**
   * Realistic Championship Tee Markers (Smooth lathed/rounded markers with brass trim)
   * Casts 100% real directional sunlight shadows with zero fake shadow discs!
   */
  public createTeeMarkers(x: number, groundY: number, z: number): Mesh {
    const root = new Mesh(`tee_markers_${x}_${z}`, this.scene);
    root.position.set(x, groundY, z);

    // Championship Navy Blue Lacquer
    const matLeft = new StandardMaterial('matTeeLeft', this.scene);
    matLeft.diffuseColor = new Color3(0.11, 0.25, 0.58);
    matLeft.specularColor = new Color3(0.32, 0.34, 0.38);
    matLeft.specularPower = 48;

    // Championship Crimson Lacquer
    const matRight = new StandardMaterial('matTeeRight', this.scene);
    matRight.diffuseColor = new Color3(0.68, 0.14, 0.15);
    matRight.specularColor = new Color3(0.34, 0.32, 0.32);
    matRight.specularPower = 48;

    [-1.6, 1.6].forEach((offset, i) => {
      // Smooth championship pedestal marker body
      const markerBody = MeshBuilder.CreateCylinder(`tee_cube_${i}`, {
        height: 0.16,
        diameterTop: 0.19,
        diameterBottom: 0.22,
        tessellation: 32
      }, this.scene);
      markerBody.position.set(offset, 0.08, 0);
      markerBody.material = i === 0 ? matLeft : matRight;
      markerBody.receiveShadows = true;
      markerBody.parent = root;

      // Smooth domed top cap
      const domeCap = MeshBuilder.CreateSphere(`tee_cap_${i}`, {
        diameterX: 0.19,
        diameterY: 0.06,
        diameterZ: 0.19,
        segments: 24
      }, this.scene);
      domeCap.position.set(offset, 0.16, 0);
      domeCap.material = i === 0 ? matLeft : matRight;
      domeCap.receiveShadows = true;
      domeCap.parent = root;

      // Brushed brass tournament accent ring
      const brassBand = MeshBuilder.CreateTorus(`tee_band_${i}`, {
        diameter: 0.195,
        thickness: 0.014,
        tessellation: 32
      }, this.scene);
      brassBand.position.set(offset, 0.12, 0);
      brassBand.material = this.matGoldTrim;
      brassBand.receiveShadows = true;
      brassBand.parent = root;
    });

    return root;
  }
}
