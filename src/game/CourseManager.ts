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
      { x: 96, z: 78, width: 28 },
      { x: 100, z: 195, width: 42 },
      { x: 126, z: 280, width: 38 },
      { x: 145, z: 332, width: 30 }
    ]);

    // 3. Right Dogleg Corner Kidney Bunker (guards aggressive line cutting the dogleg)
    this.terrain.stampFeature(124, 192, 14, 24, 0.35, SurfaceType.BUNKER, -1.35, 0.72);

    // 4. Left Outer Elbow Kidney Bunker (catches long drives through the dogleg turn)
    this.terrain.stampFeature(78, 232, 15, 26, -0.25, SurfaceType.BUNKER, -1.40, 0.75);

    // 5. Scenic Water Hazard Pond flanking the right side of the valley approach
    const pondRimElevation = this.terrain.getElevation(162, 285);
    this.terrain.stampFeature(162, 285, 26, 44, 0.25, SurfaceType.WATER, -2.4);
    const pondWater = this.scenery.createWaterPlane(162, pondRimElevation, 285, 24, 41);
    this.sceneryMeshes.push(pondWater);

    // 6. Lower Tournament Green at (148, 360) — sits ~0.95m lower than the approach fairway
    this.terrain.stampFeature(148, 360, 28, 34, 0.15, SurfaceType.GREEN, 0.0);

    // 7. Greenside Front-Left Kidney Bunker with deep revetted sod lip
    this.terrain.stampFeature(131, 350, 12, 18, 0.45, SurfaceType.BUNKER, -1.45, 0.78);

    // 8. Greenside Back-Right Kidney Bunker
    this.terrain.stampFeature(164, 366, 11, 16, -0.40, SurfaceType.BUNKER, -1.35, 0.70);

    // 9. Realistic Pine and Oak trees framing the dogleg-right valley corridor
    const treePositions = [
      { x: 64, z: 65, type: 'pine', s: 1.15 },
      { x: 58, z: 115, type: 'oak', s: 1.25 },
      { x: 132, z: 95, type: 'pine', s: 1.10 },
      { x: 142, z: 145, type: 'oak', s: 1.30 },
      { x: 60, z: 175, type: 'pine', s: 1.25 },
      { x: 56, z: 255, type: 'pine', s: 1.40 },
      { x: 88, z: 315, type: 'oak', s: 1.20 },
      { x: 184, z: 335, type: 'pine', s: 1.25 },
      { x: 120, z: 386, type: 'oak', s: 1.15 },
      { x: 174, z: 388, type: 'pine', s: 1.35 }
    ];

    for (const t of treePositions) {
      const ty = this.terrain.getElevation(t.x, t.z);
      const tree = t.type === 'pine'
        ? this.scenery.createPineTree(t.x, ty, t.z, t.s)
        : this.scenery.createOakTree(t.x, ty, t.z, t.s);
      this.sceneryMeshes.push(tree);
    }

    // Refresh hole markers
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
