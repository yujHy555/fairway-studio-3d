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
      name: 'Pine Valley Low-Poly Links',
      author: 'Architect',
      gridWidth: terrain.width,
      gridLength: terrain.length,
      currentHoleIndex: 0,
      holes: [
        {
          number: 1,
          par: 4,
          name: 'The Valley Opener',
          teePosition: { x: 110, y: 0.5, z: 40 },
          pinPosition: { x: 110, y: 0.5, z: 360 },
          waypoints: [{ x: 110, y: 0, z: 200 }]
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
   * Builds an authentic, playable championship golf hole
   */
  public initDefaultChampionshipHole() {
    const cx = 110;

    // 1. Elevated Tee Box at Z=40
    this.terrain.stampFeature(cx, 40, 10, 16, 0, SurfaceType.TEE, 0.4);

    // 2. Primary Fairway Strip from Z=70 to Z=320
    this.terrain.stampFeature(cx, 150, 42, 130, 0, SurfaceType.FAIRWAY);
    this.terrain.stampFeature(cx, 260, 38, 120, 0, SurfaceType.FAIRWAY);

    // 3. Right Fairway Bunker at Z=190 (Championship deep pot bunker with raised lip)
    this.terrain.stampFeature(cx + 20, 195, 14, 24, 0.2, SurfaceType.BUNKER, -1.25, 0.60);

    // 4. Left Fairway Bunker at Z=240
    this.terrain.stampFeature(cx - 22, 245, 16, 28, -0.3, SurfaceType.BUNKER, -1.35, 0.65);

    // 5. Scenic Water Hazard Pond on right side between Z=260 and Z=300
    const pondRimElevation = this.terrain.getElevation(cx + 34, 280);
    this.terrain.stampFeature(cx + 34, 280, 26, 45, 0.1, SurfaceType.WATER, -2.4);
    const pondWater = this.scenery.createWaterPlane(cx + 34, pondRimElevation, 280, 24, 42);
    this.sceneryMeshes.push(pondWater);

    // 6. Tournament Green at Z=360
    this.terrain.stampFeature(cx, 360, 26, 34, 0, SurfaceType.GREEN, 0.35);

    // 7. Greenside Pot Bunker guarding left pin approach
    this.terrain.stampFeature(cx - 15, 355, 9, 12, 0.4, SurfaceType.BUNKER, -1.45, 0.75);

    // 8. Low-poly Pine and Oak trees lining the rough
    const treePositions = [
      { x: cx - 35, z: 80, type: 'pine', s: 1.1 },
      { x: cx - 42, z: 120, type: 'oak', s: 1.2 },
      { x: cx + 38, z: 100, type: 'pine', s: 1.0 },
      { x: cx + 45, z: 150, type: 'oak', s: 1.3 },
      { x: cx - 38, z: 200, type: 'pine', s: 1.2 },
      { x: cx - 44, z: 280, type: 'pine', s: 1.4 },
      { x: cx + 42, z: 340, type: 'pine', s: 1.2 },
      { x: cx - 28, z: 380, type: 'oak', s: 1.1 },
      { x: cx + 26, z: 385, type: 'pine', s: 1.3 }
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
