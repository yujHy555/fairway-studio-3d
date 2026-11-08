import { PresetFeature } from '../core/Types';
import { SurfaceType } from '../core/Constants';

export const PRESET_FEATURES: PresetFeature[] = [
  // BUNKERS
  {
    id: 'bunker_pot',
    name: 'Kidney Greenside Bunker',
    category: 'bunker',
    description: 'Deep kidney-shaped greenside bunker with sharp revetted sod lip (-1.40m depth)',
    icon: '🕳️',
    surfaceType: SurfaceType.BUNKER,
    width: 12,
    length: 18,
    depthProfile: -1.40,
    lipHeight: 0.72
  },
  {
    id: 'bunker_fairway_crescent',
    name: 'Kidney Fairway Bunker',
    category: 'bunker',
    description: 'Sweeping kidney-shaped fairway hazard with raised sod berm (-1.35m depth)',
    icon: '🥐',
    surfaceType: SurfaceType.BUNKER,
    width: 15,
    length: 25,
    depthProfile: -1.35,
    lipHeight: 0.68
  },
  {
    id: 'bunker_greenside_waste',
    name: 'Large Kidney Waste Bunker',
    category: 'bunker',
    description: 'Expansive kidney sand hazard with defined turf lips (-1.30m depth)',
    icon: '🏖️',
    surfaceType: SurfaceType.BUNKER,
    width: 20,
    length: 34,
    depthProfile: -1.30,
    lipHeight: 0.65
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

  // FAIRWAYS
  {
    id: 'fringe_collar_expansion',
    name: 'Green Fringe Collar Strip',
    category: 'fringe',
    description: '4m wide manicured fringe collar around putting green',
    icon: '🟩',
    surfaceType: SurfaceType.FRINGE,
    width: 28,
    length: 36,
    depthProfile: 0.1
  },
  {
    id: 'first_cut_swath',
    name: 'First Cut Swath',
    category: 'first_cut',
    description: 'Intermediate playable rough strip bordering fairways',
    icon: '🌾',
    surfaceType: SurfaceType.FIRST_CUT,
    width: 44,
    length: 120,
    depthProfile: 0.0
  },
  {
    id: 'fairway_landing_straight',
    name: 'Straight Fairway Strip',
    category: 'fairway',
    description: '35m wide x 110m long pristine mowed fairway landing zone',
    icon: '🛣️',
    surfaceType: SurfaceType.FAIRWAY,
    width: 35,
    length: 110,
    depthProfile: 0.0
  },
  {
    id: 'fairway_dogleg_left',
    name: 'Dogleg Left Fairway',
    category: 'fairway',
    description: 'Curved fairway contouring around a left hazard',
    icon: '↩️',
    surfaceType: SurfaceType.FAIRWAY,
    width: 38,
    length: 120,
    depthProfile: 0.0
  },
  {
    id: 'fairway_dogleg_right',
    name: 'Dogleg Right Fairway',
    category: 'fairway',
    description: 'Curved fairway contouring around a right hazard',
    icon: '↪️',
    surfaceType: SurfaceType.FAIRWAY,
    width: 38,
    length: 120,
    depthProfile: 0.0
  },
  {
    id: 'fairway_approach',
    name: 'Green Approach',
    category: 'fairway',
    description: 'Narrowed fairway leading up to the putting surface',
    icon: '🎯',
    surfaceType: SurfaceType.FAIRWAY,
    width: 28,
    length: 50,
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
    id: 'scenery_pine',
    name: 'Augusta Pine Tree',
    category: 'scenery',
    description: 'Realistic tall evergreen conifer with layered needle boughs',
    icon: '🌲',
    surfaceType: SurfaceType.ROUGH,
    width: 4,
    length: 4,
    sceneryType: 'pine'
  },
  {
    id: 'scenery_oak',
    name: 'Championship Oak Tree',
    category: 'scenery',
    description: 'Broad organic canopy deciduous tree',
    icon: '🌳',
    surfaceType: SurfaceType.ROUGH,
    width: 6,
    length: 6,
    sceneryType: 'oak'
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
