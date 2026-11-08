import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Material,
  Texture,
  Color3,
  VertexBuffer,
  VertexData,
  FresnelParameters
} from '@babylonjs/core';
import { GOLF_CONSTANTS } from '../core/Constants';
import { RealisticTextures } from './RealisticTextures';

export interface TreeCollider {
  x: number;
  y: number;
  z: number;
  trunkRadius: number;
  trunkHeight: number;
  canopyRadius: number;
  canopyBottomY: number;
  canopyTopY: number;
  isHero: boolean;
}

export class SceneryFactory {
  private scene: Scene;
  public treeColliders: TreeCollider[] = [];

  // Shared realistic materials
  private matGlbPineTree: StandardMaterial;
  private matHeroBranches: StandardMaterial;
  private matHeroLeaves: StandardMaterial;
  private matHeroTrunk: StandardMaterial;
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

  // Master geometry parsed directly from /models/hero_tree_01_01.glb (3 primitives: branches, leaves, trunk)
  private heroBranchesVertexData: VertexData | null = null;
  private heroLeavesVertexData: VertexData | null = null;
  private heroTrunkVertexData: VertexData | null = null;
  private activeHeroTrees: { branches: Mesh; leaves: Mesh; trunk: Mesh }[] = [];
  // Master geometry parsed directly from /models/bush_01.glb (2 primitives: twigs, leaves)
  private bushBranchesVertexData: VertexData | null = null;
  private bushLeavesVertexData: VertexData | null = null;
  private matBushBranches: StandardMaterial;
  private matBushLeaves: StandardMaterial;
  private activeBushes: { branches: Mesh; leaves: Mesh }[] = [];

  // Master geometry parsed directly from /models/Rock_01.glb (1 primitive: rock)
  private rockGlbVertexData: VertexData | null = null;
  private matGlbRock: StandardMaterial;
  private activeRocks: Mesh[] = [];

  // Master geometry parsed directly from /models/Cliff_01.glb (1 primitive: coastal cliff)
  private cliffVertexData: VertexData | null = null;
  private matCliff: StandardMaterial;
  private activeCliffs: Mesh[] = [];

  private activeFlags: Mesh[] = [];
  private windTime = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    // 1. Realistic GLB Pine Tree Material (pine_tree_medium_01_01.glb)
    // Naturally reacts to directional sun and HDRI environment light with clean needle alpha testing
    this.matGlbPineTree = new StandardMaterial('matGlbPineTree', scene);
    this.matGlbPineTree.diffuseColor = new Color3(1.0, 1.05, 0.95);
    // Rich natural translucent foliage ambient bounce (matching hero trees, eliminates dark/black planes)
    this.matGlbPineTree.emissiveColor = new Color3(0.20, 0.26, 0.16);
    this.matGlbPineTree.specularColor = new Color3(0.04, 0.05, 0.03);
    this.matGlbPineTree.specularPower = 32;
    this.matGlbPineTree.backFaceCulling = false;
    this.matGlbPineTree.twoSidedLighting = false; // Prevents back-face normals from being inverted into shadow
    this.matGlbPineTree.transparencyMode = Material.MATERIAL_ALPHATEST;
    this.matGlbPineTree.alphaCutOff = 0.44;

    // 1b. Hero Specimen Tree Materials (hero_tree_01_01.glb)
    this.matHeroBranches = new StandardMaterial('matHeroBranches', scene);
    this.matHeroBranches.diffuseColor = new Color3(0.95, 0.92, 0.88);
    this.matHeroBranches.emissiveColor = new Color3(0.12, 0.11, 0.09);
    this.matHeroBranches.specularColor = new Color3(0.05, 0.05, 0.05);
    this.matHeroBranches.backFaceCulling = false;

    this.matHeroLeaves = new StandardMaterial('matHeroLeaves', scene);
    this.matHeroLeaves.diffuseColor = new Color3(1.06, 1.12, 1.02);
    this.matHeroLeaves.emissiveColor = new Color3(0.22, 0.29, 0.18);
    this.matHeroLeaves.specularColor = new Color3(0.06, 0.08, 0.05);
    this.matHeroLeaves.specularPower = 48;
    this.matHeroLeaves.backFaceCulling = false;
    this.matHeroLeaves.twoSidedLighting = false;
    this.matHeroLeaves.transparencyMode = Material.MATERIAL_ALPHATEST;
    this.matHeroLeaves.alphaCutOff = 0.38;

    this.matHeroTrunk = new StandardMaterial('matHeroTrunk', scene);
    this.matHeroTrunk.diffuseColor = new Color3(0.96, 0.94, 0.90);
    this.matHeroTrunk.emissiveColor = new Color3(0.12, 0.11, 0.09);
    this.matHeroTrunk.specularColor = new Color3(0.05, 0.05, 0.05);
    this.matHeroTrunk.backFaceCulling = false;

    // 1c. Bush Materials (bush_01.glb)
    this.matBushBranches = new StandardMaterial('matBushBranches', scene);
    this.matBushBranches.diffuseColor = new Color3(0.95, 0.92, 0.88);
    this.matBushBranches.emissiveColor = new Color3(0.12, 0.11, 0.09);
    this.matBushBranches.backFaceCulling = false;

    this.matBushLeaves = new StandardMaterial('matBushLeaves', scene);
    this.matBushLeaves.diffuseColor = new Color3(1.05, 1.10, 1.0);
    this.matBushLeaves.emissiveColor = new Color3(0.20, 0.26, 0.16);
    this.matBushLeaves.specularColor = new Color3(0.05, 0.06, 0.04);
    this.matBushLeaves.backFaceCulling = false;
    this.matBushLeaves.twoSidedLighting = false;
    this.matBushLeaves.transparencyMode = Material.MATERIAL_ALPHATEST;
    this.matBushLeaves.alphaCutOff = 0.38;

    // 1d. High-Realism Rock Material (Rock_01.glb)
    this.matGlbRock = new StandardMaterial('matGlbRock', scene);
    this.matGlbRock.diffuseColor = new Color3(0.96, 0.96, 0.96);
    this.matGlbRock.emissiveColor = new Color3(0.08, 0.08, 0.08);
    this.matGlbRock.specularColor = new Color3(0.12, 0.12, 0.12);
    this.matGlbRock.specularPower = 36;
    this.matGlbRock.backFaceCulling = false;

    // 1e. Coastal Cliff Wall Material (Cliff_01.glb)
    this.matCliff = new StandardMaterial('matCliff', scene);
    this.matCliff.diffuseColor = new Color3(1.0, 1.0, 1.0);
    this.matCliff.emissiveColor = new Color3(0.06, 0.06, 0.06);
    this.matCliff.specularColor = new Color3(0.08, 0.08, 0.08);
    this.matCliff.specularPower = 28;
    this.matCliff.backFaceCulling = false;

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
   * Processes an embedded PNG foliage image by bleeding/dilating RGB colors into transparent border pixels
   * and boosting needle/leaf vibrancy so trilinear mipmaps stay razor-sharp with zero dark alpha haloing.
   */
  private createCrispFoliageTextureFromBlob(blob: Blob, name: string, colorBoost = 1.22): Promise<DynamicTexture> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = img.width;
        const h = img.height;
        // invertY = false to match glTF 2.0 top-left UV origin
        const dynTex = new DynamicTexture(name, { width: w, height: h }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
        dynTex.hasAlpha = true;
        dynTex.anisotropicFilteringLevel = 16;

        const ctx = dynTex.getContext() as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;

        // 1. Natural foliage edge filtering without glowing outlines
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (a > 15) {
            px[i] = Math.min(255, Math.round(px[i] * colorBoost));
            px[i + 1] = Math.min(255, Math.round(px[i + 1] * colorBoost));
            px[i + 2] = Math.min(255, Math.round(px[i + 2] * colorBoost));
          } else {
            // Fill fully transparent background with dark pine tone (24, 38, 20)
            // so hardware mipmaps never blend white or light halo fringes
            px[i] = 24;
            px[i + 1] = 38;
            px[i + 2] = 20;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        // update(false) preserves glTF top-left UV orientation
        dynTex.update(false);
        resolve(dynTex);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Loads both `/models/pine_tree_medium_01_01.glb` and `/models/hero_tree_01_01.glb`
   * directly from their glTF 2.0 binary containers.
   */
  public async loadTreeModels(): Promise<void> {
    await Promise.all([
      this.loadMediumPineTreeGlb(),
      this.loadHeroTreeGlb(),
      this.loadBushGlb(),
      this.loadRockGlb(),
      this.loadCliffGlb()
    ]);
  }

  private async loadMediumPineTreeGlb(): Promise<void> {
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

      const normAccessor = gltf.accessors[prim.attributes.NORMAL];
      const normBV = normAccessor ? gltf.bufferViews[normAccessor.bufferView] : null;
      const rawNormals = normBV ? new Float32Array(arrayBuf, binChunkStart + (normBV.byteOffset || 0), normAccessor.count * 3) : null;

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

        // Author-designed foliage normals: upward-facing vectors ensure consistent, lush 360-degree illumination
        let nx = rawNormals ? rawNormals[i * 3] : 0;
        let ny = rawNormals ? Math.max(0.68, rawNormals[i * 3 + 1]) : 0.85;
        let nz = rawNormals ? rawNormals[i * 3 + 2] : 0;
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

      for (const treeMesh of this.activeTreeMeshes) {
        if (!treeMesh.isDisposed()) {
          this.pineTreeVertexData.applyToMesh(treeMesh, false);
        }
      }

      const matDef = gltf.materials?.[0];
      const baseColorTexIdx = matDef?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (baseColorTexIdx !== undefined) {
        const imgIdx = gltf.textures?.[baseColorTexIdx]?.source;
        const imgDef = gltf.images?.[imgIdx];
        if (imgDef && imgDef.bufferView !== undefined) {
          const bv = gltf.bufferViews[imgDef.bufferView];
          const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
          const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
          const crispTex = await this.createCrispFoliageTextureFromBlob(blob, 'pineTreeGlbCrispAlbedo', 1.24);
          this.matGlbPineTree.diffuseTexture = crispTex;
          this.matGlbPineTree.opacityTexture = crispTex;
          this.matGlbPineTree.useAlphaFromDiffuseTexture = true;
        }
      }
    } catch (err) {
      console.error('Failed to load pine_tree_medium_01_01.glb:', err);
    }
  }

  private async loadHeroTreeGlb(): Promise<void> {
    try {
      const response = await fetch('/models/hero_tree_01_01.glb');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading hero_tree_01_01.glb`);
      }
      const arrayBuf = await response.arrayBuffer();
      const view = new DataView(arrayBuf);
      if (view.getUint32(0, true) !== 0x46546C67) {
        throw new Error('Invalid GLB header in hero_tree_01_01.glb');
      }

      const jsonChunkLen = view.getUint32(12, true);
      const gltf = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuf, 20, jsonChunkLen)));
      const binChunkStart = 20 + jsonChunkLen + 8;

      const buildPrimitiveVertexData = (primIdx: number): VertexData => {
        const prim = gltf.meshes[0].primitives[primIdx];
        const posAcc = gltf.accessors[prim.attributes.POSITION];
        const normAcc = gltf.accessors[prim.attributes.NORMAL];
        const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0];
        const idxAcc = gltf.accessors[prim.indices];

        const posBV = gltf.bufferViews[posAcc.bufferView];
        const normBV = gltf.bufferViews[normAcc.bufferView];
        const uvBV = gltf.bufferViews[uvAcc.bufferView];
        const idxBV = gltf.bufferViews[idxAcc.bufferView];

        const positions = new Float32Array(arrayBuf, binChunkStart + (posBV.byteOffset || 0), posAcc.count * 3);
        const normals = new Float32Array(arrayBuf, binChunkStart + (normBV.byteOffset || 0), normAcc.count * 3);
        const uvs = new Float32Array(arrayBuf, binChunkStart + (uvBV.byteOffset || 0), uvAcc.count * 2);

        let indices: Uint32Array | Uint16Array;
        if (idxAcc.componentType === 5125) {
          indices = new Uint32Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
        } else {
          indices = new Uint16Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
        }

        const vd = new VertexData();
        vd.positions = positions;
        vd.normals = normals;
        vd.uvs = uvs;
        vd.indices = indices;
        return vd;
      };

      this.heroBranchesVertexData = buildPrimitiveVertexData(0);
      this.heroLeavesVertexData = buildPrimitiveVertexData(1);
      this.heroTrunkVertexData = buildPrimitiveVertexData(2);

      for (const h of this.activeHeroTrees) {
        if (!h.branches.isDisposed()) this.heroBranchesVertexData.applyToMesh(h.branches, false);
        if (!h.leaves.isDisposed()) this.heroLeavesVertexData.applyToMesh(h.leaves, false);
        if (!h.trunk.isDisposed()) this.heroTrunkVertexData.applyToMesh(h.trunk, false);
      }

      const createOpaqueTextureFromImageIdx = (imgIdx: number, name: string): Texture | null => {
        const imgDef = gltf.images?.[imgIdx];
        if (!imgDef || imgDef.bufferView === undefined) return null;
        const bv = gltf.bufferViews[imgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        const tex = new Texture(url, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.name = name;
        tex.anisotropicFilteringLevel = 16;
        return tex;
      };

      const branchTex = createOpaqueTextureFromImageIdx(0, 'heroBranchDiff');
      if (branchTex) {
        this.matHeroBranches.diffuseTexture = branchTex;
      }

      const trunkTex = createOpaqueTextureFromImageIdx(2, 'heroTrunkDiff');
      if (trunkTex) {
        this.matHeroTrunk.diffuseTexture = trunkTex;
      }

      const leafImgDef = gltf.images?.[1];
      if (leafImgDef && leafImgDef.bufferView !== undefined) {
        const bv = gltf.bufferViews[leafImgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: leafImgDef.mimeType || 'image/png' });
        const crispLeafTex = await this.createCrispFoliageTextureFromBlob(blob, 'heroLeavesCrispDiff', 1.18);
        this.matHeroLeaves.diffuseTexture = crispLeafTex;
        this.matHeroLeaves.opacityTexture = crispLeafTex;
        this.matHeroLeaves.useAlphaFromDiffuseTexture = true;
      }
    } catch (err) {
      console.error('Failed to load hero_tree_01_01.glb:', err);
    }
  }

  private async loadBushGlb(): Promise<void> {
    try {
      const response = await fetch('/models/bush_01.glb');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading bush_01.glb`);
      }
      const arrayBuf = await response.arrayBuffer();
      const view = new DataView(arrayBuf);
      if (view.getUint32(0, true) !== 0x46546C67) {
        throw new Error('Invalid GLB header in bush_01.glb');
      }

      const jsonChunkLen = view.getUint32(12, true);
      const gltf = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuf, 20, jsonChunkLen)));
      const binChunkStart = 20 + jsonChunkLen + 8;

      const buildPrimitiveVertexData = (primIdx: number): VertexData => {
        const prim = gltf.meshes[0].primitives[primIdx];
        const posAcc = gltf.accessors[prim.attributes.POSITION];
        const normAcc = gltf.accessors[prim.attributes.NORMAL];
        const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0];
        const idxAcc = gltf.accessors[prim.indices];

        const posBV = gltf.bufferViews[posAcc.bufferView];
        const normBV = gltf.bufferViews[normAcc.bufferView];
        const uvBV = gltf.bufferViews[uvAcc.bufferView];
        const idxBV = gltf.bufferViews[idxAcc.bufferView];

        const positions = new Float32Array(arrayBuf, binChunkStart + (posBV.byteOffset || 0), posAcc.count * 3);
        const normals = new Float32Array(arrayBuf, binChunkStart + (normBV.byteOffset || 0), normAcc.count * 3);
        const uvs = new Float32Array(arrayBuf, binChunkStart + (uvBV.byteOffset || 0), uvAcc.count * 2);

        let indices: Uint32Array | Uint16Array;
        if (idxAcc.componentType === 5125) {
          indices = new Uint32Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
        } else {
          indices = new Uint16Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
        }

        const vd = new VertexData();
        vd.positions = positions;
        vd.normals = normals;
        vd.uvs = uvs;
        vd.indices = indices;
        return vd;
      };

      this.bushBranchesVertexData = buildPrimitiveVertexData(0);
      this.bushLeavesVertexData = buildPrimitiveVertexData(1);

      for (const b of this.activeBushes) {
        if (!b.branches.isDisposed()) this.bushBranchesVertexData.applyToMesh(b.branches, false);
        if (!b.leaves.isDisposed()) this.bushLeavesVertexData.applyToMesh(b.leaves, false);
      }

      const createOpaqueTextureFromImageIdx = (imgIdx: number, name: string): Texture | null => {
        const imgDef = gltf.images?.[imgIdx];
        if (!imgDef || imgDef.bufferView === undefined) return null;
        const bv = gltf.bufferViews[imgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        const tex = new Texture(url, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.name = name;
        tex.anisotropicFilteringLevel = 16;
        return tex;
      };

      const branchTex = createOpaqueTextureFromImageIdx(1, 'bushBranchDiff');
      if (branchTex) this.matBushBranches.diffuseTexture = branchTex;

      const branchNor = createOpaqueTextureFromImageIdx(0, 'bushBranchNor');
      if (branchNor) this.matBushBranches.bumpTexture = branchNor;

      const leafImgDef = gltf.images?.[3];
      if (leafImgDef && leafImgDef.bufferView !== undefined) {
        const bv = gltf.bufferViews[leafImgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: leafImgDef.mimeType || 'image/png' });
        const crispLeafTex = await this.createCrispFoliageTextureFromBlob(blob, 'bushLeavesCrispDiff', 1.15);
        this.matBushLeaves.diffuseTexture = crispLeafTex;
        this.matBushLeaves.opacityTexture = crispLeafTex;
        this.matBushLeaves.useAlphaFromDiffuseTexture = true;
      }
    } catch (err) {
      console.error('Failed to load bush_01.glb:', err);
    }
  }

  private async loadRockGlb(): Promise<void> {
    try {
      const response = await fetch('/models/Rock_01.glb');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading Rock_01.glb`);
      }
      const arrayBuf = await response.arrayBuffer();
      const view = new DataView(arrayBuf);
      if (view.getUint32(0, true) !== 0x46546C67) {
        throw new Error('Invalid GLB header in Rock_01.glb');
      }

      const jsonChunkLen = view.getUint32(12, true);
      const gltf = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuf, 20, jsonChunkLen)));
      const binChunkStart = 20 + jsonChunkLen + 8;

      const prim = gltf.meshes[0].primitives[0];
      const posAcc = gltf.accessors[prim.attributes.POSITION];
      const normAcc = gltf.accessors[prim.attributes.NORMAL];
      const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0];
      const idxAcc = gltf.accessors[prim.indices];

      const posBV = gltf.bufferViews[posAcc.bufferView];
      const normBV = gltf.bufferViews[normAcc.bufferView];
      const uvBV = gltf.bufferViews[uvAcc.bufferView];
      const idxBV = gltf.bufferViews[idxAcc.bufferView];

      const positions = new Float32Array(arrayBuf, binChunkStart + (posBV.byteOffset || 0), posAcc.count * 3);
      const normals = new Float32Array(arrayBuf, binChunkStart + (normBV.byteOffset || 0), normAcc.count * 3);
      const uvs = new Float32Array(arrayBuf, binChunkStart + (uvBV.byteOffset || 0), uvAcc.count * 2);

      let indices: Uint32Array | Uint16Array;
      if (idxAcc.componentType === 5125) {
        indices = new Uint32Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
      } else {
        indices = new Uint16Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
      }

      const vd = new VertexData();
      vd.positions = positions;
      vd.normals = normals;
      vd.uvs = uvs;
      vd.indices = indices;
      this.rockGlbVertexData = vd;

      for (const r of this.activeRocks) {
        if (!r.isDisposed()) this.rockGlbVertexData.applyToMesh(r, false);
      }

      const createOpaqueTextureFromImageIdx = (imgIdx: number, name: string): Texture | null => {
        const imgDef = gltf.images?.[imgIdx];
        if (!imgDef || imgDef.bufferView === undefined) return null;
        const bv = gltf.bufferViews[imgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        const tex = new Texture(url, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.name = name;
        tex.anisotropicFilteringLevel = 16;
        return tex;
      };

      const rockDiffTex = createOpaqueTextureFromImageIdx(2, 'rockGlbDiff');
      if (rockDiffTex) this.matGlbRock.diffuseTexture = rockDiffTex;

      const rockNorTex = createOpaqueTextureFromImageIdx(0, 'rockGlbNor');
      if (rockNorTex) this.matGlbRock.bumpTexture = rockNorTex;
    } catch (err) {
      console.error('Failed to load Rock_01.glb:', err);
    }
  }

  private async loadCliffGlb(): Promise<void> {
    try {
      const response = await fetch('/models/Cliff_01.glb');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading Cliff_01.glb`);
      }
      const arrayBuf = await response.arrayBuffer();
      const view = new DataView(arrayBuf);
      if (view.getUint32(0, true) !== 0x46546C67) {
        throw new Error('Invalid GLB header in Cliff_01.glb');
      }

      const jsonChunkLen = view.getUint32(12, true);
      const gltf = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuf, 20, jsonChunkLen)));
      const binChunkStart = 20 + jsonChunkLen + 8;

      const prim = gltf.meshes[0].primitives[0];
      const posAcc = gltf.accessors[prim.attributes.POSITION];
      const normAcc = gltf.accessors[prim.attributes.NORMAL];
      const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0];
      const idxAcc = gltf.accessors[prim.indices];

      const posBV = gltf.bufferViews[posAcc.bufferView];
      const normBV = gltf.bufferViews[normAcc.bufferView];
      const uvBV = gltf.bufferViews[uvAcc.bufferView];
      const idxBV = gltf.bufferViews[idxAcc.bufferView];

      const positions = new Float32Array(arrayBuf, binChunkStart + (posBV.byteOffset || 0), posAcc.count * 3);
      const normals = new Float32Array(arrayBuf, binChunkStart + (normBV.byteOffset || 0), normAcc.count * 3);
      const uvs = new Float32Array(arrayBuf, binChunkStart + (uvBV.byteOffset || 0), uvAcc.count * 2);

      let indices: Uint32Array | Uint16Array;
      if (idxAcc.componentType === 5125) {
        indices = new Uint32Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
      } else {
        indices = new Uint16Array(arrayBuf, binChunkStart + (idxBV.byteOffset || 0), idxAcc.count);
      }

      const vd = new VertexData();
      vd.positions = positions;
      vd.normals = normals;
      vd.uvs = uvs;
      vd.indices = indices;
      this.cliffVertexData = vd;

      for (const c of this.activeCliffs) {
        if (!c.isDisposed()) this.cliffVertexData.applyToMesh(c, false);
      }

      const createOpaqueTextureFromImageIdx = (imgIdx: number, name: string): Texture | null => {
        const imgDef = gltf.images?.[imgIdx];
        if (!imgDef || imgDef.bufferView === undefined) return null;
        const bv = gltf.bufferViews[imgDef.bufferView];
        const bytes = new Uint8Array(arrayBuf, binChunkStart + (bv.byteOffset || 0), bv.byteLength);
        const blob = new Blob([bytes], { type: imgDef.mimeType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const tex = new Texture(url, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.name = name;
        tex.anisotropicFilteringLevel = 16;
        return tex;
      };

      // image 1: diffuse 2K texture
      const cliffDiffTex = createOpaqueTextureFromImageIdx(1, 'cliffGlbDiff');
      if (cliffDiffTex) this.matCliff.diffuseTexture = cliffDiffTex;

      // image 0: normal map texture
      const cliffNorTex = createOpaqueTextureFromImageIdx(0, 'cliffGlbNor');
      if (cliffNorTex) this.matCliff.bumpTexture = cliffNorTex;
    } catch (err) {
      console.error('Failed to load Cliff_01.glb:', err);
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
    // Crossed foliage planes should cast shadows onto the terrain without harsh 90-deg self-shadow artifacts
    treeMesh.receiveShadows = false;
    treeMesh.isPickable = false;

    this.activeTreeMeshes.push(treeMesh);

    // Track tree collider for realistic physics deflections
    this.treeColliders.push({
      x,
      y,
      z,
      trunkRadius: 0.28 * scale,
      trunkHeight: 3.2 * scale,
      canopyRadius: 2.3 * scale,
      canopyBottomY: y + 1.8 * scale,
      canopyTopY: y + 12.0 * scale,
      isHero: false
    });

    return treeMesh;
  }

  /**
   * Creates an instance of the high-detail Hero Specimen Tree (`hero_tree_01_01.glb`)
   * Used sparingly (1-2 near the Tee Box) for maximum close-up realism and performance.
   */
  public createHeroTree(x: number, y: number, z: number, scale = 1.0, rotationY?: number): Mesh {
    const idx = this.activeHeroTrees.length;
    const root = new Mesh(`hero_tree_root_${idx}`, this.scene);
    root.position.set(x, y - 0.08, z);
    // Native height in Blender is ~4.5m; 3.1x scale gives a majestic ~14m specimen tree
    const s = scale * 3.1;
    root.scaling.set(s, s, s);
    root.rotation.y = rotationY !== undefined ? rotationY : ((x * 1.37 + z * 2.19) % (Math.PI * 2));

    const branches = new Mesh(`hero_tree_branches_${idx}`, this.scene);
    branches.material = this.matHeroBranches;
    branches.isPickable = false;
    branches.parent = root;

    const leaves = new Mesh(`hero_tree_leaves_${idx}`, this.scene);
    leaves.material = this.matHeroLeaves;
    leaves.receiveShadows = false;
    leaves.isPickable = false;
    leaves.parent = root;

    const trunk = new Mesh(`hero_tree_trunk_${idx}`, this.scene);
    trunk.material = this.matHeroTrunk;
    trunk.receiveShadows = true;
    trunk.isPickable = false;
    trunk.parent = root;

    if (this.heroBranchesVertexData) this.heroBranchesVertexData.applyToMesh(branches, false);
    if (this.heroLeavesVertexData) this.heroLeavesVertexData.applyToMesh(leaves, false);
    if (this.heroTrunkVertexData) this.heroTrunkVertexData.applyToMesh(trunk, false);

    this.activeHeroTrees.push({ branches, leaves, trunk });

    // Track hero tree collider
    this.treeColliders.push({
      x,
      y,
      z,
      trunkRadius: 0.55 * scale,
      trunkHeight: 4.5 * scale,
      canopyRadius: 4.8 * scale,
      canopyBottomY: y + 2.8 * scale,
      canopyTopY: y + 14.5 * scale,
      isHero: true
    });

    return root;
  }

  /**
   * Creates an instance of the realistic 3D Bush (`bush_01.glb`)
   * Scattered along rough borders, treelines, and green backdrops for natural foliage depth.
   */
  public createBush(x: number, y: number, z: number, scale = 1.0, rotationY?: number): Mesh {
    const idx = this.activeBushes.length;
    const root = new Mesh(`bush_root_${idx}`, this.scene);
    root.position.set(x, y - 0.02, z);
    const s = scale * 1.35;
    root.scaling.set(s, s, s);
    root.rotation.y = rotationY !== undefined ? rotationY : ((x * 1.73 + z * 2.41) % (Math.PI * 2));

    const branches = new Mesh(`bush_branches_${idx}`, this.scene);
    branches.material = this.matBushBranches;
    branches.isPickable = false;
    branches.parent = root;

    const leaves = new Mesh(`bush_leaves_${idx}`, this.scene);
    leaves.material = this.matBushLeaves;
    leaves.receiveShadows = false;
    leaves.isPickable = false;
    leaves.parent = root;

    if (this.bushBranchesVertexData) this.bushBranchesVertexData.applyToMesh(branches, false);
    if (this.bushLeavesVertexData) this.bushLeavesVertexData.applyToMesh(leaves, false);

    this.activeBushes.push({ branches, leaves });

    this.treeColliders.push({
      x,
      y,
      z,
      trunkRadius: 0,
      trunkHeight: 0,
      canopyRadius: 0.75 * s,
      canopyBottomY: y,
      canopyTopY: y + 1.15 * s,
      isHero: true
    });

    return root;
  }

  /**
   * Creates an instance of the realistic 3D Granite Boulder (`Rock_01.glb`)
   * Natural glacial rock formations scattered along rough corridors and water hazard borders.
   */
  public createRock(x: number, y: number, z: number, scale = 1.0, rotationY?: number): Mesh {
    const idx = this.activeRocks.length;
    const root = new Mesh(`rock_glb_root_${idx}`, this.scene);
    root.position.set(x, y + 0.05, z);
    const s = scale * 1.35;
    root.scaling.set(s, s, s);
    root.rotation.y = rotationY !== undefined ? rotationY : ((x * 2.11 + z * 1.49) % (Math.PI * 2));

    const rockMesh = new Mesh(`rock_glb_mesh_${idx}`, this.scene);
    rockMesh.material = this.matGlbRock;
    rockMesh.receiveShadows = true;
    rockMesh.isPickable = false;
    rockMesh.parent = root;
    rockMesh.rotation.x = -Math.PI / 2;

    if (this.rockGlbVertexData) this.rockGlbVertexData.applyToMesh(rockMesh, false);

    this.activeRocks.push(rockMesh);

    this.treeColliders.push({
      x,
      y,
      z,
      trunkRadius: 1.15 * s,
      trunkHeight: 1.55 * s,
      canopyRadius: 0,
      canopyBottomY: 0,
      canopyTopY: 0,
      isHero: false
    });

    return root;
  }

  /**
   * Alias for backward compatibility so all tree calls use the new realistic 3D pine tree model
   */
  public createOakTree(x: number, y: number, z: number, scale = 1.0, rotationY?: number): Mesh {
    return this.createPineTree(x, y, z, scale, rotationY);
  }

  /**
   * Creates an instance of the coastal cliff wall (Cliff_01.glb) along the hole boundary.
   */
  public createCliff(x: number, y: number, z: number, scale = 1.0, rotationY = 0): Mesh {
    const idx = this.activeCliffs.length;
    const root = new Mesh(`cliff_glb_root_${idx}`, this.scene);
    root.position.set(x, y - 0.2, z);
    root.scaling.set(scale, scale, scale);
    root.rotation.y = rotationY;

    const cliffMesh = new Mesh(`cliff_glb_mesh_${idx}`, this.scene);
    cliffMesh.material = this.matCliff;
    cliffMesh.receiveShadows = true;
    cliffMesh.isPickable = false;
    cliffMesh.parent = root;

    if (this.cliffVertexData) {
      this.cliffVertexData.applyToMesh(cliffMesh, false);
    }

    this.activeCliffs.push(cliffMesh);

    // Multi-point physical barrier collider along the ~80m cliff span
    const cosR = Math.cos(rotationY);
    const sinR = Math.sin(rotationY);
    const span = 36 * scale;
    for (let offset = -span; offset <= span; offset += 9 * scale) {
      this.treeColliders.push({
        x: x + offset * cosR,
        y: y,
        z: z - offset * sinR,
        trunkRadius: 4.8 * scale,
        trunkHeight: 12.0 * scale,
        canopyRadius: 0,
        canopyBottomY: 0,
        canopyTopY: 0,
        isHero: false
      });
    }

    return root;
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
   * Realistic Championship Tee Markers: Red cubes with rounded corners,
   * compact PGA size (~13cm), and spaced further apart (~4.8m).
   */
  public createTeeMarkers(x: number, groundY: number, z: number): Mesh {
    const root = new Mesh(`tee_markers_${x}_${z}`, this.scene);
    root.position.set(x, groundY, z);

    const matTeeRed = new StandardMaterial('matTeeRed', this.scene);
    matTeeRed.diffuseColor = new Color3(0.82, 0.10, 0.12);
    matTeeRed.specularColor = new Color3(0.55, 0.45, 0.45);
    matTeeRed.specularPower = 64;

    const size = 0.125;
    const cornerRadius = 0.022;

    [-2.4, 2.4].forEach((offset, i) => {
      // 1. Core cube body
      const cube = MeshBuilder.CreateBox(`tee_red_cube_${i}`, {
        width: size,
        height: size,
        depth: size
      }, this.scene);
      cube.position.set(offset, size * 0.5 + 0.008, 0);
      cube.material = matTeeRed;
      cube.receiveShadows = true;
      cube.parent = root;

      // 2. Smooth rounded corner edge caps for sleek rounded-corner cube appearance
      const topCap = MeshBuilder.CreateSphere(`tee_red_cap_${i}`, {
        diameterX: size * 0.98,
        diameterY: cornerRadius * 2.2,
        diameterZ: size * 0.98,
        segments: 18
      }, this.scene);
      topCap.position.set(offset, size + 0.005, 0);
      topCap.material = matTeeRed;
      topCap.receiveShadows = true;
      topCap.parent = root;

      // 3. Grounding brass bezel plate at turf level
      const brassPlate = MeshBuilder.CreateBox(`tee_brass_plate_${i}`, {
        width: size * 1.12,
        height: 0.016,
        depth: size * 1.12
      }, this.scene);
      brassPlate.position.set(offset, 0.008, 0);
      brassPlate.material = this.matGoldTrim;
      brassPlate.receiveShadows = true;
      brassPlate.parent = root;
    });

    return root;
  }
}
