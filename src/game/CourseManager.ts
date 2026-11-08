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
  private activePinMesh: Mesh | null = null;
  private activeTeeMesh: Mesh | null = null;
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
  }

  public get currentHole(): GolfHole {
    return this.courseData.holes[this.currentHoleIndex];
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

    // 2. Continuous Seamless Dogleg-Right Fairway descending into the valley
    this.terrain.stampDoglegFairway([
      { x: 95, z: 62, width: 24 },
      { x: 97, z: 185, width: 42 },
      { x: 124, z: 275, width: 36 },
      { x: 145, z: 334, width: 28 }
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

    // 9. Scatter High-Detail Hero Specimen Trees (hero_tree_01_01.glb) with varied scaling and orientation:
    // Framing Elevated Tee Box, flanking fairway rough borders, and creating majestic backdrops behind the green
    const heroTreePositions = [
      // Elevated Tee Box Framing
      { x: 74, z: 48, s: 1.05, rot: 0.45 },
      { x: 116, z: 50, s: 0.94, rot: 2.35 },

      // Left Rough Corridor along Dogleg Fairway
      { x: 68, z: 125, s: 1.18, rot: 1.20 },
      { x: 74, z: 180, s: 0.88, rot: 3.10 },
      { x: 70, z: 245, s: 1.25, rot: 0.80 },
      { x: 92, z: 295, s: 0.92, rot: 4.40 },

      // Right Rough Corridor along Dogleg Fairway
      { x: 135, z: 115, s: 0.90, rot: 5.10 },
      { x: 148, z: 165, s: 1.22, rot: 2.70 },
      { x: 156, z: 230, s: 1.05, rot: 1.50 },
      { x: 158, z: 305, s: 0.85, rot: 3.80 },

      // Behind & Framing the Putting Green Complex
      { x: 130, z: 388, s: 1.30, rot: 0.90 },
      { x: 148, z: 396, s: 1.12, rot: 2.40 },
      { x: 168, z: 388, s: 1.22, rot: 4.10 },
      { x: 120, z: 370, s: 0.86, rot: 1.70 },
      { x: 176, z: 358, s: 0.95, rot: 3.30 },

      // Hero specimen tree guarding the front-right of the green
      { x: 170, z: 346, s: 1.18, rot: 0.92 }
    ];
    for (const h of heroTreePositions) {
      const hy = this.terrain.getElevation(h.x, h.z);
      const heroTree = this.scenery.createHeroTree(h.x, hy, h.z, h.s, h.rot);
      this.sceneryMeshes.push(heroTree);
    }

    // 10. Scatter the realistic 3D Pine Tree model (pine_tree_medium_01_01.glb) around the level/scene
    const treePositions = [
      // Framing behind & around the Elevated Tee Box
      { x: 58, z: 24, s: 0.95 }, { x: 74, z: 20, s: 1.08 }, { x: 116, z: 22, s: 1.02 }, { x: 134, z: 28, s: 0.90 },
      { x: 54, z: 46, s: 1.10 }, { x: 64, z: 62, s: 0.92 }, { x: 128, z: 48, s: 1.05 }, { x: 138, z: 66, s: 0.96 },

      // Left Rough & Outer Woodland Corridor along the Dogleg
      { x: 34, z: 85, s: 1.12 }, { x: 56, z: 95, s: 0.88 }, { x: 42, z: 122, s: 1.04 }, { x: 60, z: 138, s: 0.95 },
      { x: 30, z: 155, s: 1.15 }, { x: 54, z: 175, s: 1.00 }, { x: 38, z: 198, s: 0.92 }, { x: 52, z: 215, s: 1.08 },
      { x: 32, z: 240, s: 1.14 }, { x: 54, z: 262, s: 0.96 }, { x: 44, z: 288, s: 1.05 }, { x: 68, z: 305, s: 0.90 },
      { x: 82, z: 325, s: 1.02 }, { x: 60, z: 342, s: 1.10 }, { x: 96, z: 356, s: 0.94 },

      // Right Rough & Dogleg Corner Woodland
      { x: 146, z: 88, s: 1.06 }, { x: 168, z: 105, s: 0.94 }, { x: 142, z: 128, s: 0.98 }, { x: 164, z: 148, s: 1.12 },
      { x: 154, z: 168, s: 0.88 }, { x: 178, z: 185, s: 1.05 }, { x: 162, z: 215, s: 0.96 }, { x: 186, z: 235, s: 1.10 },
      { x: 194, z: 268, s: 1.02 }, { x: 196, z: 298, s: 0.92 }, { x: 188, z: 328, s: 1.08 }, { x: 196, z: 355, s: 0.95 },

      // Championship Green Amphitheater Backdrop
      { x: 108, z: 382, s: 0.92 }, { x: 124, z: 394, s: 1.06 }, { x: 142, z: 400, s: 1.14 },
      { x: 160, z: 398, s: 1.02 }, { x: 178, z: 390, s: 0.96 }, { x: 190, z: 378, s: 1.08 },
      { x: 94, z: 408, s: 1.10 }, { x: 132, z: 418, s: 0.98 }, { x: 168, z: 416, s: 1.12 },

      // Towering large pine trees along the outer course borders
      { x: 22, z: 60, s: 1.65 }, { x: 18, z: 130, s: 1.75 }, { x: 24, z: 210, s: 1.80 },
      { x: 20, z: 280, s: 1.70 }, { x: 35, z: 350, s: 1.60 }, { x: 65, z: 25, s: 1.60 },
      { x: 145, z: 20, s: 1.65 }, { x: 205, z: 70, s: 1.65 }, { x: 215, z: 140, s: 1.75 },
      { x: 210, z: 220, s: 1.82 }, { x: 218, z: 300, s: 1.68 }, { x: 212, z: 370, s: 1.72 },
      { x: 80, z: 425, s: 1.85 }, { x: 110, z: 435, s: 1.78 }, { x: 150, z: 438, s: 1.82 },
      { x: 185, z: 430, s: 1.74 }
    ];

    for (let i = 0; i < treePositions.length; i++) {
      const t = treePositions[i];
      const ty = this.terrain.getElevation(t.x, t.z);
      const rotY = (i * 2.39996) % (Math.PI * 2); // Golden-angle rotation so every tree silhouette is distinct
      const tree = this.scenery.createPineTree(t.x, ty, t.z, t.s, rotY);
      this.sceneryMeshes.push(tree);
    }

        // 11. Scatter 95+ Realistic 3D Bushes (bush_01.glb) with varied sizes (0.85 - 2.20) including large specimens
    const bushPositions = [
      // Left rough corridor along the dogleg fairway & cliff base
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

      // Lush foliage backdrop nestled behind tournament green
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

    for (let i = 0; i < bushPositions.length; i++) {
      const b = bushPositions[i];
      const by = this.terrain.getElevation(b.x, b.z);
      const rotY = (i * 2.618) % (Math.PI * 2);
      const bush = this.scenery.createBush(b.x, by, b.z, b.s, rotY);
      this.sceneryMeshes.push(bush);
    }

    // 12. Scatter Realistic 3D Granite Rocks (Rock_01.glb) along rough corridors, water edges, and behind green
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

    // Refresh hole markers
    

    // 13. Coastal Cliff Walls (Cliff_01.glb) rotated 90 degrees anti-clockwise
    const cliffSegments = [
      // Far left rough boundary cliffs
      { x: 38, z: 120, s: 0.85, rot: 0.22 - Math.PI / 2 },
      { x: 42, z: 205, s: 0.90, rot: 0.35 - Math.PI / 2 },
      { x: 50, z: 288, s: 0.86, rot: 0.52 - Math.PI / 2 },
      // Right boundary cliffs
      { x: 205, z: 255, s: 0.86, rot: 1.57 - Math.PI / 2 },
      { x: 208, z: 330, s: 0.84, rot: 1.70 - Math.PI / 2 }
    ];

    for (const c of cliffSegments) {
      const cy = this.terrain.getElevation(c.x, c.z);
      const cliff = this.scenery.createCliff(c.x, cy, c.z, c.s, c.rot);
      this.sceneryMeshes.push(cliff);
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
    this.activeTeeMesh = this.scenery.createTeeMarkers(hole.teePosition.x, teeY, hole.teePosition.z);

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
