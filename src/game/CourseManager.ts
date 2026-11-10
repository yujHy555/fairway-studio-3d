import { GolfCourseData, GolfHole, HoleScore } from '../core/Types';
import { GOLF_CONSTANTS, SurfaceType } from '../core/Constants';
import { TerrainGrid } from '../terrain/TerrainGrid';
import { SceneryFactory } from '../terrain/Scenery';
import { Mesh } from '@babylonjs/core';

export class CourseManager {
  public courseData: GolfCourseData;
  public currentHoleIndex = 0;
  public scores: HoleScore[] = [];
  public currentStrokes = 0;
  public currentPutts = 0;

  private terrain: TerrainGrid;
  private scenery: SceneryFactory;
  public activePinMesh: Mesh | null = null;
  public activeTeeMesh: Mesh | null = null;
  private sceneryMeshes: Mesh[] = [];

  constructor(terrain: TerrainGrid, scenery: SceneryFactory) {
    this.terrain = terrain;
    this.scenery = scenery;

    this.courseData = {
      id: 'default_course',
      name: 'Pine Valley Championship Links',
      author: 'Architect',
      gridWidth: terrain.width,
      gridLength: terrain.length,
      currentHoleIndex: 0,
      holes: [
        {
          number: 1,
          par: 4,
          name: 'The Valley Dogleg',
          teePosition: { x: 95, y: 8.0, z: 42 },
          pinPosition: { x: 148, y: 1.25, z: 360 },
          waypoints: [{ x: 102, y: 2.2, z: 200 }]
        }
      ],
      features: [],
      heightMap: [],
      surfaceMap: []
    };

    this.initDefaultChampionshipHole();

    // Check if custom saved default hole exists in localStorage
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('fairway_studio_custom_default_hole') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.holes && parsed.heightMap && parsed.surfaceMap) {
          this.courseData = parsed;
          this.terrain.heights.set(parsed.heightMap);
          this.terrain.surfaceTypes.set(parsed.surfaceMap);
          this.terrain.rebuildMesh();
          this.setupHoleVisuals();
        }
      }
    } catch (e) {
      console.warn('Could not restore saved custom default hole:', e);
    }
  }

  public get currentHole(): GolfHole {
    return this.courseData.holes[this.currentHoleIndex];
  }

  public getActiveHole(): GolfHole {
    return this.currentHole;
  }

  /**
   * Builds an authentic championship dogleg-right golf hole:
   * - Starts from a high elevated Tee Box (~8.0m) at (95, 42)
   * - Continuous, seamless Dogleg-Right Fairway descending into a small valley (~2.2m)
   * - Kidney-shaped bunkers with sharply defined revetted sod lips guarding the dogleg & green
   * - Putting green nestled slightly lower (~1.25m) than the approach fairway at (148, 360)
   */
  public initDefaultChampionshipHole() {
    // 1. Elevated Championship Tee Box on the high bluff at (95, 42)
    this.terrain.stampFeature(95, 42, 12, 16, 0.05, SurfaceType.TEE, 1.30);

    // 2. Continuous Seamless Dogleg-Right Fairway with clear spacing from Tee Box and Putting Green
    this.terrain.stampDoglegFairway([
      { x: 95, z: 74, width: 24 },
      { x: 97, z: 185, width: 42 },
      { x: 124, z: 275, width: 36 },
      { x: 138, z: 316, width: 28 }
    ]);

    // 3. Right Dogleg Corner Scalloped Multi-Bay Bunker (Variant 2: asymmetric fingers & flared tongue)
    this.terrain.stampFeature(132, 190, 14, 24, 0.30, SurfaceType.BUNKER, -0.80, 0.15, undefined, 4);

    // 4. Left Outer Elbow Coastal Links Multi-Lobe Hazard (Variant 0: deep organic finger bays hugging the bend)
    this.terrain.stampFeature(80, 232, 15, 26, -0.25, SurfaceType.BUNKER, -0.82, 0.18, undefined, 0);

    // 4b. Middle Fairway Organic Amoeba Hazard at 250m (Variant 3: undulating bays guarding landing zone)
    this.terrain.stampFeature(122, 280, 13, 21, -0.15, SurfaceType.BUNKER, -0.80, 0.16, undefined, 4);

    // 5. Scenic Water Hazard Pond flanking the right side of the valley approach
    const pondRimElevation = this.terrain.getBaseElevation(168, 282);
    this.terrain.stampFeature(168, 282, 24, 42, 0.22, SurfaceType.WATER, -2.4);
    const pondWater = this.scenery.createWaterPlane(168, pondRimElevation, 282, 24, 42, 0.22);
    this.sceneryMeshes.push(pondWater);

    // 6. Lower Tournament Green at (148, 360) — sits ~0.95m lower than the approach fairway
    this.terrain.stampFeature(148, 360, 28, 34, 0.15, SurfaceType.GREEN, 0.0);

    // 7. Greenside Front-Left Tri-Lobed Bunker (Variant 1: tri-lobed fingers wrapping around front-left green collar)
    this.terrain.stampFeature(123, 353, 12, 20, 0.22, SurfaceType.BUNKER, -0.78, 0.08, undefined, 1);

    // 8. Greenside Right Clover Apron Bunker (Variant 4: scalloped clover lobes guarding right water approach)
    this.terrain.stampFeature(172, 365, 11, 18, -0.28, SurfaceType.BUNKER, -0.75, 0.08, undefined, 4);

    // 9. Coastal Cliff Walls (Cliff_01.glb): Left rotated 180° clockwise, Right rotated 90° counter-clockwise
    const cliffSegments = [
      // Far left rough boundary cliffs (rotated 180 degrees clockwise)
      { x: 38, z: 120, s: 0.85, rot: 0.22 + Math.PI },
      { x: 42, z: 205, s: 0.90, rot: 0.35 + Math.PI },
      { x: 50, z: 288, s: 0.86, rot: 0.52 + Math.PI },
      // Right boundary cliffs (rotated 90 degrees counter-clockwise)
      { x: 205, z: 255, s: 0.86, rot: 1.57 - Math.PI / 2 },
      { x: 208, z: 330, s: 0.84, rot: 1.70 - Math.PI / 2 }
    ];

    for (const c of cliffSegments) {
      const cy = this.terrain.getElevation(c.x, c.z);
      const cliff = this.scenery.createCliff(c.x, cy, c.z, c.s, c.rot);
      this.sceneryMeshes.push(cliff);
    }

    // 10. Scatter Realistic 3D Granite Rocks (Rock_01.glb) along rough corridors, water edges, and behind green
    const rockPositions = [
      // Left rough natural glacial outcrops
      { x: 68, z: 122, s: 1.2 },
      { x: 63, z: 192, s: 1.4 },
      { x: 70, z: 262, s: 1.1 },
      { x: 86, z: 312, s: 1.3 },
      // Flanking water hazard shoreline
      { x: 186, z: 262, s: 1.4 },
      { x: 192, z: 292, s: 1.5 },
      { x: 185, z: 318, s: 1.2 },
      // Rugged granite boulders framing behind the green
      { x: 130, z: 394, s: 1.3 },
      { x: 144, z: 402, s: 1.6 },
      { x: 162, z: 396, s: 1.2 },
      // Elevated Tee Box hillside slopes
      { x: 74, z: 32, s: 1.3 },
      { x: 118, z: 36, s: 1.4 }
    ];

    for (let i = 0; i < rockPositions.length; i++) {
      const r = rockPositions[i];
      const ry = this.terrain.getElevation(r.x, r.z);
      const rotY = (i * 1.942) % (Math.PI * 2);
      const rock = this.scenery.createRock(r.x, ry, r.z, r.s, rotY);
      this.sceneryMeshes.push(rock);
    }

    // 11. Immovable Obstacles List (Cliff Barrier Points + Rocks) for strict Zero-Intersection spatial clearance
    interface PlacedEntity { x: number; z: number; radius: number; }
    const obstacles: PlacedEntity[] = [];

    // Register cliff barrier lines (span ~36m per cliff)
    for (const c of cliffSegments) {
      const cosR = Math.cos(c.rot);
      const sinR = Math.sin(c.rot);
      const span = 36 * c.s;
      for (let offset = -span; offset <= span; offset += 6) {
        obstacles.push({
          x: c.x + offset * cosR,
          z: c.z - offset * sinR,
          radius: 4.8 * c.s + 1.8 // Solid cliff face clearance
        });
      }
    }

    // Register rocks
    for (const r of rockPositions) {
      obstacles.push({
        x: r.x,
        z: r.z,
        radius: 1.15 * (r.s * 1.35) + 1.5 // Rock radius clearance
      });
    }

    // Register all stamped features (bunkers, greens, water, tees) so no foliage spawns in hazards
    for (const f of this.terrain.stampedFeatures) {
      const rad = Math.max(f.width, f.length) * 0.5;
      obstacles.push({
        x: f.centerX,
        z: f.centerZ,
        radius: rad + (f.surfaceType === SurfaceType.BUNKER ? 1.6 : 0.8)
      });
    }

    const placedHeroTrees: PlacedEntity[] = [];
    const placedPines: PlacedEntity[] = [];
    const placedBushes: PlacedEntity[] = [];

    // 12. Scatter High-Detail Hero Specimen Trees (hero_tree_01_01.glb)
    const rawHeroTrees = [
      { x: 74, z: 48, s: 1.05, rot: 0.45 },
      { x: 116, z: 50, s: 0.94, rot: 2.35 },
      { x: 68, z: 125, s: 1.18, rot: 1.20 },
      { x: 74, z: 180, s: 0.88, rot: 3.10 },
      { x: 70, z: 245, s: 1.25, rot: 0.80 },
      { x: 92, z: 295, s: 0.92, rot: 4.40 },
      { x: 135, z: 115, s: 0.90, rot: 5.10 },
      { x: 148, z: 165, s: 1.22, rot: 2.70 },
      { x: 156, z: 230, s: 1.05, rot: 1.50 },
      { x: 158, z: 305, s: 0.85, rot: 3.80 },
      { x: 130, z: 388, s: 1.30, rot: 0.90 },
      { x: 148, z: 396, s: 1.12, rot: 2.40 },
      { x: 168, z: 388, s: 1.22, rot: 4.10 },
      { x: 120, z: 370, s: 0.86, rot: 1.70 },
      { x: 176, z: 358, s: 0.95, rot: 3.30 },
      // Hero specimen tree front-right of green
      { x: 170, z: 346, s: 1.18, rot: 0.92 }
    ];

    for (const h of rawHeroTrees) {
      let x = h.x;
      let z = h.z;
      const rReq = 4.8 * h.s;

      // Relax away from obstacles & other hero trees
      for (let iter = 0; iter < 12; iter++) {
        let collided = false;
        for (const obs of [...obstacles, ...placedHeroTrees]) {
          const dx = x - obs.x;
          const dz = z - obs.z;
          const d = Math.hypot(dx, dz) || 0.001;
          const minD = rReq + obs.radius;
          if (d < minD) {
            const push = (minD - d) + 0.5;
            x += (dx / d) * push;
            z += (dz / d) * push;
            collided = true;
          }
        }
        if (!collided) break;
      }

      const surf = this.terrain.getSurfaceAt(x, z);
      if (surf === SurfaceType.BUNKER || surf === SurfaceType.GREEN || surf === SurfaceType.WATER || surf === SurfaceType.TEE) {
        continue;
      }

      placedHeroTrees.push({ x, z, radius: rReq });
      const hy = this.terrain.getElevation(x, z);
      const heroTree = this.scenery.createHeroTree(x, hy, z, h.s, h.rot);
      this.sceneryMeshes.push(heroTree);
    }

    // 13. Scatter Dense Pines across Far Corners, Land Edges, and Corridors
    const rawPines = [
      // Far Bottom-Left Corner & Border
      { x: 14, z: 14, s: 1.25 }, { x: 26, z: 16, s: 1.45 }, { x: 38, z: 18, s: 1.15 }, { x: 16, z: 32, s: 1.65 },
      { x: 28, z: 40, s: 1.35 }, { x: 14, z: 52, s: 1.75 }, { x: 24, z: 62, s: 1.40 },

      // Far Bottom-Right Corner & Border
      { x: 178, z: 16, s: 1.30 }, { x: 192, z: 18, s: 1.55 }, { x: 206, z: 20, s: 1.75 }, { x: 184, z: 34, s: 1.35 },
      { x: 198, z: 42, s: 1.65 }, { x: 208, z: 56, s: 1.80 }, { x: 188, z: 66, s: 1.45 },

      // Left Land Edge Corridor
      { x: 15, z: 80, s: 1.70 }, { x: 25, z: 98, s: 1.40 }, { x: 16, z: 118, s: 1.80 }, { x: 24, z: 142, s: 1.45 },
      { x: 18, z: 168, s: 1.75 }, { x: 26, z: 192, s: 1.50 }, { x: 15, z: 218, s: 1.82 }, { x: 25, z: 242, s: 1.45 },
      { x: 16, z: 268, s: 1.70 }, { x: 24, z: 295, s: 1.50 }, { x: 22, z: 322, s: 1.65 }, { x: 30, z: 345, s: 1.55 },

      // Right Land Edge Corridor
      { x: 202, z: 84, s: 1.65 }, { x: 212, z: 106, s: 1.80 }, { x: 204, z: 130, s: 1.55 }, { x: 214, z: 156, s: 1.75 },
      { x: 202, z: 182, s: 1.60 }, { x: 212, z: 208, s: 1.82 }, { x: 204, z: 234, s: 1.50 }, { x: 215, z: 262, s: 1.70 },
      { x: 205, z: 290, s: 1.60 }, { x: 214, z: 316, s: 1.75 }, { x: 204, z: 342, s: 1.55 }, { x: 212, z: 368, s: 1.70 },

      // Far Top-Left Corner & Amphitheater
      { x: 18, z: 388, s: 1.75 }, { x: 32, z: 402, s: 1.55 }, { x: 48, z: 418, s: 1.80 }, { x: 68, z: 428, s: 1.65 },
      { x: 24, z: 425, s: 1.85 }, { x: 42, z: 432, s: 1.70 }, { x: 88, z: 435, s: 1.85 },

      // Far Top-Right Corner & Amphitheater
      { x: 192, z: 388, s: 1.65 }, { x: 208, z: 402, s: 1.80 }, { x: 178, z: 422, s: 1.75 }, { x: 198, z: 428, s: 1.82 },
      { x: 158, z: 436, s: 1.85 }, { x: 135, z: 435, s: 1.75 }, { x: 110, z: 435, s: 1.78 },

      // Framing Elevated Tee Box & Woodland
      { x: 58, z: 24, s: 0.95 }, { x: 74, z: 20, s: 1.08 }, { x: 116, z: 22, s: 1.02 }, { x: 134, z: 28, s: 0.90 },
      { x: 54, z: 46, s: 1.10 }, { x: 64, z: 62, s: 0.92 }, { x: 128, z: 48, s: 1.05 }, { x: 138, z: 66, s: 0.96 },

      // Left & Right Dogleg Rough Flanks
      { x: 42, z: 92, s: 1.05 }, { x: 56, z: 102, s: 0.92 }, { x: 44, z: 132, s: 1.08 }, { x: 58, z: 148, s: 0.95 },
      { x: 40, z: 182, s: 1.10 }, { x: 52, z: 202, s: 0.98 }, { x: 42, z: 232, s: 1.12 }, { x: 54, z: 254, s: 0.95 },
      { x: 46, z: 280, s: 1.05 }, { x: 64, z: 302, s: 0.92 }, { x: 78, z: 322, s: 1.02 }, { x: 94, z: 342, s: 0.95 },

      { x: 146, z: 88, s: 1.06 }, { x: 168, z: 105, s: 0.94 }, { x: 142, z: 128, s: 0.98 }, { x: 164, z: 148, s: 1.12 },
      { x: 154, z: 168, s: 0.88 }, { x: 178, z: 185, s: 1.05 }, { x: 162, z: 215, s: 0.96 }, { x: 186, z: 235, s: 1.10 },
      { x: 194, z: 268, s: 1.02 }, { x: 196, z: 298, s: 0.92 }, { x: 188, z: 328, s: 1.08 }, { x: 196, z: 355, s: 0.95 },

      // Tournament Green Amphitheater
      { x: 108, z: 382, s: 0.92 }, { x: 124, z: 394, s: 1.06 }, { x: 142, z: 400, s: 1.14 },
      { x: 160, z: 398, s: 1.02 }, { x: 178, z: 390, s: 0.96 }, { x: 94, z: 408, s: 1.10 }
    ];

    for (let i = 0; i < rawPines.length; i++) {
      const p = rawPines[i];
      let x = p.x;
      let z = p.z;
      const rReq = 2.4 * p.s;

      // Relax away from cliffs, rocks, hero trees, and previously placed pines
      for (let iter = 0; iter < 12; iter++) {
        let collided = false;
        for (const obs of [...obstacles, ...placedHeroTrees, ...placedPines]) {
          const dx = x - obs.x;
          const dz = z - obs.z;
          const d = Math.hypot(dx, dz) || 0.001;
          const minD = rReq + obs.radius;
          if (d < minD) {
            const push = (minD - d) + 0.45;
            x += (dx / d) * push;
            z += (dz / d) * push;
            collided = true;
          }
        }
        if (!collided) break;
      }

      const surf = this.terrain.getSurfaceAt(x, z);
      if (surf === SurfaceType.BUNKER || surf === SurfaceType.GREEN || surf === SurfaceType.WATER || surf === SurfaceType.TEE) {
        continue;
      }

      placedPines.push({ x, z, radius: rReq });
      const ty = this.terrain.getElevation(x, z);
      const rotY = (i * 2.39996) % (Math.PI * 2);
      const tree = this.scenery.createPineTree(x, ty, z, p.s, rotY);
      this.sceneryMeshes.push(tree);
    }

    // 14. Scatter Realistic 3D Bushes (bush_01.glb) with varied sizes (0.85 - 2.20)
    const rawBushes = [
      // Left rough corridor
      { x: 74, z: 98, s: 1.15 }, { x: 58, z: 115, s: 1.85 }, { x: 71, z: 132, s: 1.30 }, { x: 54, z: 152, s: 2.10 },
      { x: 67, z: 168, s: 0.95 }, { x: 52, z: 188, s: 1.65 }, { x: 62, z: 206, s: 1.95 }, { x: 56, z: 224, s: 1.10 },
      { x: 66, z: 242, s: 1.45 }, { x: 60, z: 260, s: 2.15 }, { x: 78, z: 278, s: 1.35 }, { x: 70, z: 298, s: 1.70 },
      { x: 92, z: 322, s: 1.10 }, { x: 84, z: 336, s: 1.90 }, { x: 108, z: 348, s: 1.25 }, { x: 100, z: 362, s: 1.60 },
      { x: 48, z: 105, s: 1.40 }, { x: 62, z: 125, s: 2.05 }, { x: 46, z: 165, s: 1.20 }, { x: 58, z: 180, s: 1.75 },
      { x: 44, z: 220, s: 1.90 }, { x: 68, z: 235, s: 0.90 }, { x: 48, z: 270, s: 2.20 }, { x: 64, z: 285, s: 1.30 },
      { x: 76, z: 310, s: 1.80 }, { x: 86, z: 330, s: 1.15 }, { x: 94, z: 345, s: 1.65 },

      // Right rough corridor flanking dogleg and water hazard
      { x: 124, z: 104, s: 1.30 }, { x: 138, z: 120, s: 1.80 }, { x: 130, z: 138, s: 1.05 }, { x: 150, z: 154, s: 2.00 },
      { x: 144, z: 172, s: 1.45 }, { x: 160, z: 192, s: 1.90 }, { x: 154, z: 212, s: 1.20 }, { x: 170, z: 232, s: 1.75 },
      { x: 158, z: 252, s: 1.15 }, { x: 174, z: 258, s: 2.10 }, { x: 184, z: 268, s: 1.35 }, { x: 196, z: 284, s: 1.85 },
      { x: 188, z: 304, s: 1.25 }, { x: 198, z: 322, s: 2.05 }, { x: 176, z: 342, s: 1.10 }, { x: 186, z: 350, s: 1.65 },
      { x: 132, z: 110, s: 0.90 }, { x: 142, z: 132, s: 1.60 }, { x: 158, z: 145, s: 1.30 }, { x: 168, z: 168, s: 2.15 },
      { x: 164, z: 202, s: 1.10 }, { x: 178, z: 220, s: 1.70 }, { x: 166, z: 242, s: 1.95 }, { x: 180, z: 275, s: 1.25 },
      { x: 192, z: 310, s: 1.80 }, { x: 202, z: 335, s: 1.40 }, { x: 182, z: 360, s: 2.10 },

      // Behind putting green
      { x: 114, z: 374, s: 1.30 }, { x: 126, z: 384, s: 1.95 }, { x: 120, z: 396, s: 1.45 }, { x: 136, z: 392, s: 2.10 },
      { x: 132, z: 406, s: 1.35 }, { x: 146, z: 396, s: 1.85 }, { x: 144, z: 412, s: 1.40 }, { x: 156, z: 394, s: 2.05 },
      { x: 158, z: 408, s: 1.60 }, { x: 166, z: 388, s: 1.40 }, { x: 172, z: 402, s: 1.80 }, { x: 138, z: 404, s: 1.25 },
      { x: 152, z: 406, s: 1.90 }, { x: 168, z: 414, s: 1.15 }, { x: 180, z: 382, s: 1.70 }, { x: 184, z: 398, s: 1.30 },
      { x: 104, z: 380, s: 2.00 }, { x: 110, z: 392, s: 1.20 }, { x: 118, z: 408, s: 1.75 }, { x: 128, z: 418, s: 1.35 },
      { x: 140, z: 422, s: 2.15 }, { x: 154, z: 418, s: 1.50 }, { x: 164, z: 424, s: 1.85 }, { x: 176, z: 410, s: 1.25 },
      { x: 188, z: 406, s: 2.05 }, { x: 194, z: 390, s: 1.40 },

      // Framing Elevated Tee Box
      { x: 76, z: 46, s: 1.35 }, { x: 68, z: 38, s: 1.90 }, { x: 116, z: 50, s: 1.15 }, { x: 122, z: 40, s: 1.80 },
      { x: 88, z: 28, s: 1.05 }, { x: 106, z: 26, s: 1.70 }, { x: 62, z: 42, s: 1.45 }, { x: 82, z: 32, s: 2.00 },
      { x: 128, z: 34, s: 1.25 }, { x: 134, z: 48, s: 1.65 }, { x: 96, z: 20, s: 1.50 }, { x: 70, z: 24, s: 1.95 }
    ];

    for (let i = 0; i < rawBushes.length; i++) {
      const b = rawBushes[i];
      let x = b.x;
      let z = b.z;
      const rReq = 1.15 * b.s;

      // Relax away from all obstacles, hero trees, pine trees, and other bushes
      for (let iter = 0; iter < 12; iter++) {
        let collided = false;
        for (const obs of [...obstacles, ...placedHeroTrees, ...placedPines, ...placedBushes]) {
          const dx = x - obs.x;
          const dz = z - obs.z;
          const d = Math.hypot(dx, dz) || 0.001;
          const minD = rReq + obs.radius;
          if (d < minD) {
            const push = (minD - d) + 0.35;
            x += (dx / d) * push;
            z += (dz / d) * push;
            collided = true;
          }
        }
        if (!collided) break;
      }

      const surf = this.terrain.getSurfaceAt(x, z);
      if (surf === SurfaceType.BUNKER || surf === SurfaceType.GREEN || surf === SurfaceType.WATER || surf === SurfaceType.TEE) {
        continue;
      }

      placedBushes.push({ x, z, radius: rReq });
      const by = this.terrain.getElevation(x, z);
      const rotY = (i * 2.618) % (Math.PI * 2);
      const bush = this.scenery.createBush(x, by, z, b.s, rotY);
      this.sceneryMeshes.push(bush);
    }
    this.setupHoleVisuals();
  }

  public setupHoleVisuals() {
    const hole = this.currentHole;

    if (this.activePinMesh) this.activePinMesh.dispose();
    if (this.activeTeeMesh) this.activeTeeMesh.dispose();

    const pinY = this.terrain.getElevation(hole.pinPosition.x, hole.pinPosition.z);
    hole.pinPosition.y = pinY;
    this.activePinMesh = this.scenery.createPinAndCup(hole.pinPosition.x, pinY, hole.pinPosition.z, hole.number);

    const teeY = this.terrain.getElevation(hole.teePosition.x, hole.teePosition.z);
    hole.teePosition.y = teeY;
    this.activeTeeMesh = this.scenery.createTeeMarkers(hole.teePosition.x, teeY, hole.teePosition.z, hole.pinPosition.x, hole.pinPosition.z);

    // Orient tee markers perpendicular to the initial fairway target line
    const targetPt = hole.waypoints && hole.waypoints.length > 0 ? hole.waypoints[0] : hole.pinPosition;
    const headingRad = Math.atan2(targetPt.x - hole.teePosition.x, targetPt.z - hole.teePosition.z);
    this.activeTeeMesh.rotation.y = headingRad;
  }

  public getSceneryMeshes(): Mesh[] {
    const list: Mesh[] = [...this.sceneryMeshes];
    if (this.activePinMesh) list.push(this.activePinMesh);
    if (this.activeTeeMesh) list.push(this.activeTeeMesh);
    return list;
  }

  public addSceneryMesh(mesh: Mesh) {
    if (!this.sceneryMeshes.includes(mesh)) {
      this.sceneryMeshes.push(mesh);
    }
  }

  public removeSceneryMesh(mesh: Mesh) {
    const idx = this.sceneryMeshes.indexOf(mesh);
    if (idx !== -1) {
      this.sceneryMeshes.splice(idx, 1);
    }
  }

  /**
   * Automatically clears foliage, bushes, rocks, and trees from hazards, greens, and tee boxes,
   * keeping the course realistic and clean whenever features are added, moved, or transformed.
   */
  public refreshSceneryForFeatures() {
    if (!this.terrain) return;

    for (const mesh of this.sceneryMeshes) {
      if (!mesh || mesh.isDisposed()) continue;
      // Preserve water planes, cliff formations, pin flag, and tee markers
      if (
        mesh.name.startsWith('water') ||
        mesh.name.startsWith('cliff') ||
        mesh.name.startsWith('pin') ||
        mesh.name.startsWith('tee')
      ) {
        continue;
      }

      const x = mesh.position.x;
      const z = mesh.position.z;
      const surf = this.terrain.getSurfaceAt(x, z);

      let inHazard = (
        surf === SurfaceType.BUNKER ||
        surf === SurfaceType.GREEN ||
        surf === SurfaceType.WATER ||
        surf === SurfaceType.TEE
      );

      if (!inHazard) {
        for (const feat of this.terrain.stampedFeatures) {
          if (feat.surfaceType === SurfaceType.BUNKER) {
            const halfW = feat.width * 0.5;
            const halfL = feat.length * 0.5;
            const dx = x - feat.centerX;
            const dz = z - feat.centerZ;
            const maxR = Math.max(halfW, halfL) * 1.6;
            if (Math.abs(dx) <= maxR && Math.abs(dz) <= maxR) {
              const cosR = Math.cos(-feat.rotationRad);
              const sinR = Math.sin(-feat.rotationRad);
              const lx = dx * cosR - dz * sinR;
              const lz = dx * sinR + dz * cosR;
              const shapeIdx = feat.bunkerShapeIndex ?? 0;
              const theta = Math.atan2(lz / Math.max(1, halfL), lx / Math.max(1, halfW));
              const k = TerrainGrid.getBunkerRadiusFactor(theta, shapeIdx);
              const baseRad = Math.hypot(halfW * Math.cos(theta), halfL * Math.sin(theta)) * k;
              const rMeters = Math.hypot(lx, lz);
              if (rMeters <= baseRad * 0.78 + 0.6) {
                inHazard = true;
                break;
              }
            }
          } else if (
            feat.surfaceType === SurfaceType.GREEN ||
            feat.surfaceType === SurfaceType.TEE ||
            feat.surfaceType === SurfaceType.WATER
          ) {
            const halfW = feat.width * 0.5;
            const halfL = feat.length * 0.5;
            const dx = x - feat.centerX;
            const dz = z - feat.centerZ;
            const cosR = Math.cos(-feat.rotationRad);
            const sinR = Math.sin(-feat.rotationRad);
            const lx = dx * cosR - dz * sinR;
            const lz = dx * sinR + dz * cosR;
            const normDist = Math.sqrt((lx / halfW) * (lx / halfW) + (lz / halfL) * (lz / halfL));
            if (normDist <= 1.05) {
              inHazard = true;
              break;
            }
          }
        }
      }

      if (inHazard) {
        mesh.setEnabled(false);
      } else {
        mesh.setEnabled(true);
        mesh.position.y = this.terrain.getElevation(x, z);
      }
    }
  }

  public saveCurrentAsDefault(): boolean {
    try {
      const json = this.exportCourseJSON();
      localStorage.setItem('fairway_studio_custom_default_hole', json);
      return true;
    } catch (e) {
      console.error('Failed to save default hole to localStorage:', e);
      return false;
    }
  }

  public resetToFactoryDefault(): void {
    try {
      localStorage.removeItem('fairway_studio_custom_default_hole');
    } catch (e) {}
    window.location.reload();
  }

  public addHole(par: 3 | 4 | 5 = 4, name?: string): GolfHole | null {
    if (this.courseData.holes.length >= 9) {
      return null;
    }

    const nextNum = this.courseData.holes.length + 1;
    const prevHole = this.courseData.holes[this.courseData.holes.length - 1];

    // Position next hole tee near previous green with gentle layout offset
    const newTeeX = Math.max(30, Math.min(this.terrain.width - 30, prevHole.pinPosition.x + (nextNum % 2 === 0 ? 30 : -30)));
    const newTeeZ = Math.max(30, Math.min(this.terrain.length - 150, 40));

    const distance = par === 3 ? 150 : par === 4 ? 320 : 440;
    const newPinZ = Math.min(this.terrain.length - 30, newTeeZ + distance);

    const newHole: GolfHole = {
      number: nextNum,
      par,
      name: name || `Hole ${nextNum}`,
      teePosition: { x: newTeeX, y: this.terrain.getElevation(newTeeX, newTeeZ), z: newTeeZ },
      pinPosition: { x: newTeeX, y: this.terrain.getElevation(newTeeX, newPinZ), z: newPinZ },
      waypoints: []
    };

    this.courseData.holes.push(newHole);
    return newHole;
  }

  public selectHole(index: number) {
    if (index >= 0 && index < this.courseData.holes.length) {
      this.currentHoleIndex = index;
      this.currentStrokes = 0;
      this.currentPutts = 0;
      this.setupHoleVisuals();
    }
  }

  public recordStroke(isPutt = false) {
    this.currentStrokes++;
    if (isPutt) this.currentPutts++;
  }

  public completeHole(): HoleScore {
    const hole = this.currentHole;
    const strokes = Math.max(1, this.currentStrokes);
    const diff = strokes - hole.par;
    let scoreText = 'Par (E)';
    if (strokes === 1) scoreText = 'HOLE IN ONE! 🌟';
    else if (diff <= -3) scoreText = 'Albatross (-3) 🦅';
    else if (diff === -2) scoreText = 'Eagle (-2) 🦅';
    else if (diff === -1) scoreText = 'Birdie (-1) 🐦';
    else if (diff === 0) scoreText = 'Par (E) ⛳';
    else if (diff === 1) scoreText = 'Bogey (+1)';
    else if (diff === 2) scoreText = 'Double Bogey (+2)';
    else scoreText = `+${diff}`;

    const score: HoleScore = {
      holeNumber: hole.number,
      par: hole.par,
      strokes,
      putts: this.currentPutts,
      scoreText
    };

    this.scores.push(score);
    return score;
  }

  public exportCourseJSON(): string {
    // Pack heightmap and surfacemap into array
    this.courseData.heightMap = Array.from(this.terrain.heights);
    this.courseData.surfaceMap = Array.from(this.terrain.surfaceTypes);
    return JSON.stringify(this.courseData, null, 2);
  }

  public importCourseJSON(jsonStr: string): boolean {
    try {
      const data = JSON.parse(jsonStr) as GolfCourseData;
      if (!data.holes || !data.gridWidth) return false;

      this.courseData = data;
      this.terrain.heights.set(data.heightMap);
      this.terrain.surfaceTypes.set(data.surfaceMap);
      this.terrain.rebuildMesh();
      this.selectHole(0);
      return true;
    } catch (e) {
      console.error('Failed to import course:', e);
      return false;
    }
  }
}
