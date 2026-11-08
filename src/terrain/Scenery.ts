import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Material,
  Texture,
  Color3,
  VertexBuffer,
  VertexData,
  FresnelParameters
} from '@babylonjs/core';
import { GOLF_CONSTANTS } from '../core/Constants';
import { RealisticTextures } from './RealisticTextures';

export class SceneryFactory {
  private scene: Scene;

  // Shared realistic materials
  private matGlbPineTree: StandardMaterial;
  private matRock: StandardMaterial;
  private matDam: StandardMaterial;
  private matWater: StandardMaterial;
  private matPinPole: StandardMaterial;
  private matPinFlag: StandardMaterial;
  private matCup: StandardMaterial;
  private matCupLiner: StandardMaterial;
  private matGoldTrim: StandardMaterial;

  // Master geometry parsed directly from /models/pine_tree_medium_01_01.glb
  private pineTreeVertexData: VertexData | null = null;
  private activeTreeMeshes: Mesh[] = [];

  private activeFlags: Mesh[] = [];
  private windTime = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    // 1. Realistic GLB Pine Tree Material (pine_tree_medium_01_01.glb)
    this.matGlbPineTree = new StandardMaterial('matGlbPineTree', scene);
    this.matGlbPineTree.diffuseColor = new Color3(0.96, 0.98, 0.94);
    this.matGlbPineTree.emissiveColor = new Color3(0.05, 0.07, 0.04);
    this.matGlbPineTree.specularColor = new Color3(0.04, 0.05, 0.03);
    this.matGlbPineTree.specularPower = 32;
    this.matGlbPineTree.backFaceCulling = false;
    this.matGlbPineTree.twoSidedLighting = true;
    this.matGlbPineTree.transparencyMode = Material.MATERIAL_ALPHATEST;
    this.matGlbPineTree.alphaCutOff = 0.32;

    // 2. Seamless Granite Boulder Material
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

    // 3. Stone Retaining / Dam Wall Material
    this.matDam = new StandardMaterial('matDam', scene);
    this.matDam.diffuseTexture = rockTex.diffuse;
    this.matDam.bumpTexture = rockTex.normal;
    this.matDam.diffuseColor = new Color3(0.82, 0.84, 0.86);
    this.matDam.specularColor = new Color3(0.12, 0.12, 0.12);

    // 4. Realistic Animated Water Material with HDRI Sky Fresnel Reflections & Organic Wind Normal Map
    const waterDiffuse = RealisticTextures.createSeamlessWaterDiffuseTexture(scene);
    waterDiffuse.uScale = 2.5;
    waterDiffuse.vScale = 2.5;

    const waterNormal = RealisticTextures.createSeamlessWaterNormalTexture(scene);
    waterNormal.uScale = 3.2;
    waterNormal.vScale = 3.2;
    waterNormal.level = 0.58;

    this.matWater = new StandardMaterial('matWater', scene);
    this.matWater.diffuseTexture = waterDiffuse;
    this.matWater.bumpTexture = waterNormal;
    this.matWater.diffuseColor = new Color3(0.08, 0.28, 0.38);
    this.matWater.emissiveColor = new Color3(0.01, 0.05, 0.08);
    this.matWater.specularColor = new Color3(0.88, 0.94, 1.0);
    this.matWater.specularPower = 260;
    this.matWater.alpha = 0.88;
    this.matWater.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.matWater.backFaceCulling = false;

    if (this.scene.environmentTexture) {
      this.matWater.reflectionTexture = this.scene.environmentTexture;
      this.matWater.reflectionFresnelParameters = new FresnelParameters();
      this.matWater.reflectionFresnelParameters.bias = 0.06;
      this.matWater.reflectionFresnelParameters.power = 3.0;
      this.matWater.reflectionFresnelParameters.leftColor = new Color3(0.46, 0.56, 0.66);
      this.matWater.reflectionFresnelParameters.rightColor = new Color3(0.03, 0.11, 0.17);
    }

    // Animate water ripples & waving tournament flags
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      waterNormal.uOffset = (waterNormal.uOffset + dt * 0.024) % 1.0;
      waterNormal.vOffset = (waterNormal.vOffset + dt * 0.016) % 1.0;
      waterDiffuse.uOffset = (waterDiffuse.uOffset - dt * 0.010) % 1.0;
      waterDiffuse.vOffset = (waterDiffuse.vOffset + dt * 0.008) % 1.0;

      this.windTime += dt * 3.8;
      this.animateFlags();
    });

    // 5. Pin, Cup & Trim Materials
    this.matPinPole = new StandardMaterial('matPinPole', scene);
    this.matPinPole.diffuseColor = new Color3(0.95, 0.95, 0.92);
    this.matPinPole.specularColor = new Color3(0.5, 0.5, 0.5);
    this.matPinPole.specularPower = 64;

    this.matPinFlag = new StandardMaterial('matPinFlag', scene);
    this.matPinFlag.diffuseColor = new Color3(0.86, 0.12, 0.14);
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
   * Loads the realistic 3D tree model `/models/pine_tree_medium_01_01.glb` directly from its glTF 2.0 binary container,
   * extracting the exact mesh geometry, UVs, and embedded PNG foliage/bark atlas & normal textures.
   */
  public async loadTreeModels(): Promise<void> {
    try {
      const response = await fetch('/models/pine_tree_medium_01_01.glb');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading pine_tree_medium_01_01.glb`);
      }
      const arrayBuf = await response.arrayBuffer();
      const view = new DataView(arrayBuf);

      const magic = view.getUint32(0, true);
      if (magic !== 0x46546C67) {
        throw new Error('Invalid GLB magic header');
      }

      const jsonChunkLen = view.getUint32(12, true);
      const jsonBytes = new Uint8Array(arrayBuf, 20, jsonChunkLen);
      const gltf = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));

      const binChunkStart = 20 + jsonChunkLen + 8;

      const nodeTranslation: [number, number, number] = gltf.nodes?.[0]?.translation || [0, 8.0455818, 0];
      const prim = gltf.meshes[0].primitives[0];

      const posAccessor = gltf.accessors[prim.attributes.POSITION];
      const posBV = gltf.bufferViews[posAccessor.bufferView];
      const rawPos = new Float32Array(arrayBuf, binChunkStart + (posBV.byteOffset || 0), posAccessor.count * 3);

      const uvAccessor = gltf.accessors[prim.attributes.TEXCOORD_0];
      const uvBV = gltf.bufferViews[uvAccessor.bufferView];
      const rawUvs = new Float32Array(arrayBuf, binChunkStart + (uvBV.byteOffset || 0), uvAccessor.count * 2);

      const idxAccessor = gltf.accessors[prim.indices];
      const idxBV = gltf.bufferViews[idxAccessor.bufferView];
      const rawIndices = new Uint16Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAccessor.count);

      const positions = new Float32Array(posAccessor.count * 3);
      const normals = new Float32Array(posAccessor.count * 3);
      const uvs = new Float32Array(uvAccessor.count * 2);
      const indices = new Uint32Array(idxAccessor.count);

      for (let i = 0; i < posAccessor.count; i++) {
        const px = rawPos[i * 3] + nodeTranslation[0];
        const py = rawPos[i * 3 + 1] + nodeTranslation[1];
        const pz = rawPos[i * 3 + 2] + nodeTranslation[2];

        positions[i * 3] = px;
        positions[i * 3 + 1] = py;
        positions[i * 3 + 2] = pz;

        // Smooth hemisphere-biased foliage normal so cross-planes receive natural sunlight from all angles
        const rLen = Math.hypot(px, pz) || 1.0;
        const nx = (px / rLen) * 0.42;
        const ny = 0.86;
        const nz = (pz / rLen) * 0.42;
        const nNorm = Math.hypot(nx, ny, nz) || 1.0;
        normals[i * 3] = nx / nNorm;
        normals[i * 3 + 1] = ny / nNorm;
        normals[i * 3 + 2] = nz / nNorm;

        uvs[i * 2] = rawUvs[i * 2];
        uvs[i * 2 + 1] = rawUvs[i * 2 + 1];
      }

      for (let i = 0; i < idxAccessor.count; i++) {
        indices[i] = rawIndices[i];
      }

      const vd = new VertexData();
      vd.positions = positions;
      vd.normals = normals;
      vd.uvs = uvs;
      vd.indices = indices;
      this.pineTreeVertexData = vd;

      // Apply geometry to any trees already created
      for (const treeMesh of this.activeTreeMeshes) {
        if (!treeMesh.isDisposed()) {
          this.pineTreeVertexData.applyToMesh(treeMesh, false);
        }
      }

      // Extract embedded PNG textures from GLB bufferViews
      const matDef = gltf.materials?.[0];
      const baseColorTexIdx = matDef?.pbrMetallicRoughness?.baseColorTexture?.index;
      const normalTexIdx = matDef?.normalTexture?.index;

      const createTextureFromGlbImage = (texIdx: number | undefined, name: string, hasAlpha: boolean): Texture | null => {
        if (texIdx === undefined) return null;
        const imgIdx = gltf.textures?.[texIdx]?.source;
        const imgDef = gltf.images?.[imgIdx];
        if (!imgDef || imgDef.bufferView === undefined) return null;
        const bv = gltf.bufferViews[imgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        // glTF 2.0 UV origin is top-left -> invertY = false
        const tex = new Texture(url, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.name = name;
        tex.hasAlpha = hasAlpha;
        tex.anisotropicFilteringLevel = 16;
        return tex;
      };

      const albedoTex = createTextureFromGlbImage(baseColorTexIdx, 'pineTreeGlbAlbedo', true);
      const normalTex = createTextureFromGlbImage(normalTexIdx, 'pineTreeGlbNormal', false);

      if (albedoTex) {
        this.matGlbPineTree.diffuseTexture = albedoTex;
        this.matGlbPineTree.opacityTexture = albedoTex;
        this.matGlbPineTree.useAlphaFromDiffuseTexture = true;
      }
      if (normalTex) {
        normalTex.level = 0.45;
        this.matGlbPineTree.bumpTexture = normalTex;
      }
    } catch (err) {
      console.error('Failed to load pine_tree_medium_01_01.glb:', err);
    }
  }

  /**
   * Creates an instance of the realistic 3D Pine Tree (`pine_tree_medium_01_01.glb`)
   */
  public createPineTree(x: number, y: number, z: number, scale = 1.0, rotationY?: number): Mesh {
    const treeMesh = new Mesh(`pine_glb_${Math.round(x)}_${Math.round(z)}_${this.activeTreeMeshes.length}`, this.scene);
    if (this.pineTreeVertexData) {
      this.pineTreeVertexData.applyToMesh(treeMesh, false);
    }

    // Seat trunk slightly into the terrain so it never floats on hillside slopes
    treeMesh.position.set(x, y - 0.14, z);
    treeMesh.scaling.set(scale, scale, scale);
    treeMesh.rotation.y = rotationY !== undefined ? rotationY : ((x * 1.73 + z * 2.41) % (Math.PI * 2));
    treeMesh.material = this.matGlbPineTree;
    treeMesh.receiveShadows = true;
    treeMesh.isPickable = false;

    this.activeTreeMeshes.push(treeMesh);
    return treeMesh;
  }

  /**
   * Alias for backward compatibility so all tree calls use the new realistic 3D pine tree model
   */
  public createOakTree(x: number, y: number, z: number, scale = 1.0, rotationY?: number): Mesh {
    return this.createPineTree(x, y, z, scale, rotationY);
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

  /**
   * Creates an optimized, realistic multi-ring radial water surface mesh that aligns 1:1 with
   * the stamped water feature's dimensions (`width`, `length`) and orientation (`rotationRad`).
   * Features radial depth-tinted vertex colors and soft shoreline alpha feathering.
   */
  public createWaterPlane(
    x: number,
    rimElevation: number,
    z: number,
    width: number,
    length: number,
    rotationRad = 0
  ): Mesh {
    const water = new Mesh(`water_${Math.round(x)}_${Math.round(z)}`, this.scene);
    const halfW = width * 0.5 * 0.96;
    const halfL = length * 0.5 * 0.96;

    const segs = 96;
    const rings = [
      { r: 0.00, col: [0.06, 0.26, 0.38, 0.96] },
      { r: 0.58, col: [0.09, 0.34, 0.46, 0.93] },
      { r: 0.84, col: [0.16, 0.48, 0.56, 0.84] },
      { r: 0.95, col: [0.28, 0.58, 0.62, 0.62] },
      { r: 1.00, col: [0.42, 0.66, 0.65, 0.08] }
    ];

    const numRings = rings.length;
    const totalVerts = 1 + (numRings - 1) * (segs + 1);
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const colors = new Float32Array(totalVerts * 4);
    const indices: number[] = [];

    // Center vertex (index 0)
    positions[0] = 0;
    positions[1] = 0;
    positions[2] = 0;
    normals[0] = 0;
    normals[1] = 1;
    normals[2] = 0;
    uvs[0] = 0.5;
    uvs[1] = 0.5;
    colors[0] = rings[0].col[0];
    colors[1] = rings[0].col[1];
    colors[2] = rings[0].col[2];
    colors[3] = rings[0].col[3];

    let vIdx = 1;
    for (let rIdx = 1; rIdx < numRings; rIdx++) {
      const rFrac = rings[rIdx].r;
      const c = rings[rIdx].col;
      for (let s = 0; s <= segs; s++) {
        const theta = (s / segs) * Math.PI * 2;
        const lx = Math.cos(theta) * halfW * rFrac;
        const lz = Math.sin(theta) * halfL * rFrac;

        positions[vIdx * 3] = lx;
        positions[vIdx * 3 + 1] = 0;
        positions[vIdx * 3 + 2] = lz;

        normals[vIdx * 3] = 0;
        normals[vIdx * 3 + 1] = 1;
        normals[vIdx * 3 + 2] = 0;

        // World-proportional UV coordinates so water ripples are never stretched on elongated ponds
        uvs[vIdx * 2] = 0.5 + lx / 28.0;
        uvs[vIdx * 2 + 1] = 0.5 + lz / 28.0;

        colors[vIdx * 4] = c[0];
        colors[vIdx * 4 + 1] = c[1];
        colors[vIdx * 4 + 2] = c[2];
        colors[vIdx * 4 + 3] = c[3];

        vIdx++;
      }
    }

    // Inner fan (center 0 to ring 1)
    const ring1Start = 1;
    for (let s = 0; s < segs; s++) {
      indices.push(0, ring1Start + s + 1, ring1Start + s);
    }

    // Outer quad strips between rings
    for (let rIdx = 1; rIdx < numRings - 1; rIdx++) {
      const innerStart = 1 + (rIdx - 1) * (segs + 1);
      const outerStart = 1 + rIdx * (segs + 1);
      for (let s = 0; s < segs; s++) {
        const i0 = innerStart + s;
        const i1 = innerStart + s + 1;
        const o0 = outerStart + s;
        const o1 = outerStart + s + 1;
        indices.push(i0, o1, o0);
        indices.push(i0, i1, o1);
      }
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.colors = colors;
    vd.indices = indices;
    vd.applyToMesh(water, false);

    water.hasVertexAlpha = true;
    water.position.set(x, rimElevation - 0.19, z);
    // Match the exact rotation angle of the terrain's stamped feature (note: TerrainGrid uses localX = dx*cos(-rot) - dz*sin(-rot))
    water.rotation.y = -rotationRad;
    water.material = this.matWater;
    water.receiveShadows = true;
    water.isPickable = false;
    return water;
  }

  /**
   * Regulation USGA Golf Hole Cup + Metal Liner + Tapered Flagstick + Waving Cloth Flag
   */
  public createPinAndCup(x: number, groundY: number, z: number, holeNumber = 1): Mesh {
    const pinRoot = new Mesh(`pin_hole_${holeNumber}`, this.scene);
    pinRoot.position.set(x, groundY, z);

    const cup = MeshBuilder.CreateCylinder(`cup_${holeNumber}`, {
      height: GOLF_CONSTANTS.CUP_DEPTH,
      diameter: GOLF_CONSTANTS.CUP_RADIUS * 2,
      tessellation: 32
    }, this.scene);
    cup.position.y = -GOLF_CONSTANTS.CUP_DEPTH * 0.5 + 0.002;
    cup.material = this.matCup;
    cup.parent = pinRoot;

    const liner = MeshBuilder.CreateTorus(`cup_liner_${holeNumber}`, {
      diameter: GOLF_CONSTANTS.CUP_RADIUS * 2,
      thickness: 0.008,
      tessellation: 32
    }, this.scene);
    liner.position.y = 0.002;
    liner.material = this.matCupLiner;
    liner.parent = pinRoot;

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

    const finial = MeshBuilder.CreateSphere(`pole_finial_${holeNumber}`, {
      diameter: 0.048,
      segments: 16
    }, this.scene);
    finial.position.y = 2.41;
    finial.material = this.matGoldTrim;
    finial.parent = pinRoot;

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
        const px = positions[i];
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
   */
  public createTeeMarkers(x: number, groundY: number, z: number): Mesh {
    const root = new Mesh(`tee_markers_${x}_${z}`, this.scene);
    root.position.set(x, groundY, z);

    const matLeft = new StandardMaterial('matTeeLeft', this.scene);
    matLeft.diffuseColor = new Color3(0.11, 0.25, 0.58);
    matLeft.specularColor = new Color3(0.32, 0.34, 0.38);
    matLeft.specularPower = 48;

    const matRight = new StandardMaterial('matTeeRight', this.scene);
    matRight.diffuseColor = new Color3(0.68, 0.14, 0.15);
    matRight.specularColor = new Color3(0.34, 0.32, 0.32);
    matRight.specularPower = 48;

    [-1.6, 1.6].forEach((offset, i) => {
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
