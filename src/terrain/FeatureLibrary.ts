import { PresetFeature } from '../core/Types';
import { SurfaceType } from '../core/Constants';

export const PRESET_FEATURES: PresetFeature[] = [
  // BUNKERS
  {
    id: 'bunker_pot',
    name: 'Kidney Greenside Bunker',
    category: 'bunker',
    description: 'Deep kidney-shaped greenside bunker with sharp revetted sod lip (-0.78m depth)',
    icon: '🕳️',
    surfaceType: SurfaceType.BUNKER,
    width: 12,
    length: 18,
    depthProfile: -0.78,
    lipHeight: 0.60,
    bunkerShapeIndex: 0
  },
  {
    id: 'bunker_fairway_crescent',
    name: 'Kidney Fairway Bunker',
    category: 'bunker',
    description: 'Sweeping kidney-shaped fairway hazard with raised sod berm (-0.80m depth)',
    icon: '🥐',
    surfaceType: SurfaceType.BUNKER,
    width: 15,
    length: 25,
    depthProfile: -0.80,
    lipHeight: 0.60,
    bunkerShapeIndex: 1
  },
  {
    id: 'bunker_greenside_waste',
    name: 'Large Kidney Waste Bunker',
    category: 'bunker',
    description: 'Expansive kidney sand hazard with defined turf lips (-0.75m depth)',
    icon: '🏖️',
    surfaceType: SurfaceType.BUNKER,
    width: 20,
    length: 34,
    depthProfile: -0.75,
    lipHeight: 0.55,
    bunkerShapeIndex: 4
  },

  // GREENS
  {
    id: 'green_oval',
    name: 'Tournament Oval Green',
    category: 'green',
    description: '24m x 32m championship bentgrass green with subtle crown',
    icon: '⛳',
    surfaceType: SurfaceType.GREEN,
    width: 24,
    length: 32,
    depthProfile: 0.25
  },
  {
    id: 'green_kidney',
    name: 'Kidney Green',
    category: 'green',
    description: '20m x 28m contoured green with dual pin locations',
    icon: '🟢',
    surfaceType: SurfaceType.GREEN,
    width: 20,
    length: 28,
    depthProfile: 0.3
  },
  {
    id: 'green_two_tier',
    name: 'Two-Tier Green',
    category: 'green',
    description: 'Dramatic tiered green with an upper and lower shelf',
    icon: '📶',
    surfaceType: SurfaceType.GREEN,
    width: 24,
    length: 36,
    depthProfile: 0.6
  },
  {
    id: 'green_turtleback',
    name: 'Turtleback Green',
    category: 'green',
    description: 'Pinehurst style raised dome green rejecting weak approaches',
    icon: '🐢',
    surfaceType: SurfaceType.GREEN,
    width: 18,
    length: 18,
    depthProfile: 0.5
  },

  // FAIRWAYS (Complete Fixed AAA Sculpted Fairway Contours)
  {
    id: 'fairway_dogleg_right',
    name: 'AAA Dogleg-Right Fairway',
    category: 'fairway',
    description: 'Complete sculpted AAA dogleg-right fairway with organic landing zones & first cut',
    icon: '↪️',
    surfaceType: SurfaceType.FAIRWAY,
    width: 38,
    length: 240,
    depthProfile: 0.0
  },
  {
    id: 'fairway_dogleg_left',
    name: 'AAA Dogleg-Left Fairway',
    category: 'fairway',
    description: 'Complete sculpted AAA dogleg-left fairway with organic landing zones & first cut',
    icon: '↩️',
    surfaceType: SurfaceType.FAIRWAY,
    width: 38,
    length: 240,
    depthProfile: 0.0
  },
  {
    id: 'fairway_landing_straight',
    name: 'AAA Championship Fairway',
    category: 'fairway',
    description: 'Complete sculpted AAA championship fairway with rounded walk-on & approach apron',
    icon: '🛣️',
    surfaceType: SurfaceType.FAIRWAY,
    width: 36,
    length: 220,
    depthProfile: 0.0
  },

  // WATER HAZARDS & DAMS
  {
    id: 'water_pond',
    name: 'Natural Water Hazard',
    category: 'water',
    description: 'Excavated pond basin with animated reflective water (-2.2m depth)',
    icon: '🌊',
    surfaceType: SurfaceType.WATER,
    width: 26,
    length: 42,
    depthProfile: -2.2
  },
  {
    id: 'water_dam',
    name: 'Dam & Reservoir',
    category: 'water',
    description: 'Steep reservoir with stone retaining dam structure (-2.5m depth)',
    icon: '🧱',
    surfaceType: SurfaceType.WATER,
    width: 32,
    length: 48,
    depthProfile: -2.5,
    sceneryType: 'dam_wall'
  },
  {
    id: 'water_river',
    name: 'Creek / River Section',
    category: 'water',
    description: 'Meandering stream crossing the hole',
    icon: '🏞️',
    surfaceType: SurfaceType.WATER,
    width: 12,
    length: 70,
    depthProfile: -1.6
  },

  // TEE BOXES
  {
    id: 'tee_championship',
    name: 'Championship Tee Box',
    category: 'tee',
    description: 'Elevated tournament tee pad with Championship markers',
    icon: '⬛',
    surfaceType: SurfaceType.TEE,
    width: 10,
    length: 14,
    depthProfile: 0.25
  },
  {
    id: 'tee_standard',
    name: 'Member Tee Box',
    category: 'tee',
    description: 'Standard tee pad with Member markers',
    icon: '⬜',
    surfaceType: SurfaceType.TEE,
    width: 9,
    length: 12,
    depthProfile: 0.2
  },
  {
    id: 'tee_forward',
    name: 'Forward Tee Box',
    category: 'tee',
    description: 'Forward tee pad with Red markers',
    icon: '🔴',
    surfaceType: SurfaceType.TEE,
    width: 8,
    length: 10,
    depthProfile: 0.15
  },

  // SCENERY PROPS
  {
    id: 'scenery_pine_medium_01',
    name: 'Medium Pine Tree 01',
    category: 'scenery',
    description: 'Realistic 3D pine tree model (pine_tree_medium_01_01.glb)',
    icon: '🌲',
    surfaceType: SurfaceType.ROUGH,
    width: 6,
    length: 6,
    sceneryType: 'pine'
  },
  {
    id: 'scenery_hero_tree_01',
    name: 'Hero Specimen Tree 01',
    category: 'scenery',
    description: 'High-detail Poly Haven specimen tree (hero_tree_01_01.glb) — use sparingly',
    icon: '🌳',
    surfaceType: SurfaceType.ROUGH,
    width: 7,
    length: 7,
    sceneryType: 'hero_tree'
  },
  {
    id: 'scenery_rocks',
    name: 'Granite Boulder Outcrop',
    category: 'scenery',
    description: 'Natural cluster of sculpted granite boulders',
    icon: '🪨',
    surfaceType: SurfaceType.ROUGH,
    width: 5,
    length: 5,
    sceneryType: 'rock_cluster'
  }
];
