# Fairway Studio 3D: Low-Poly Golf Course Designer & Simulation

An online, browser-based 3D low-poly golf course architect and playable game powered by **Babylon.js (v7+)** and **Havok Physics (WASM)**.

Design custom individual golf holes or complete championship courses up to 9 holes on an authentic **1m x 1m real-world grid system**, with automatic terrain blending and an **aerodynamically realistic AAA ball flight model**.

---

## 🌟 Key Features

### 1. Course Designer Engine
- **1m x 1m Scale Grid**: Real-world scale (e.g. 220m wide $\times$ 460m long per hole). Each coordinate directly maps to 1 square meter.
- **Auto-Blending Feature Presets**:
  - **Bunkers**: Pot Bunkers, Crescent Fairway Bunkers, and Waste Areas that automatically carve into the fairway or rough with realistic concave depth profiles ($-0.75\text{m}$ to $-1.1\text{m}$), raised lips, and high-friction sand physics.
  - **Greens**: Tournament Ovals, Kidney Greens, Tiered Greens, and Turtlebacks with smooth plateaus and crown breaks.
  - **Fairways**: Straight landing strips, Doglegs (Left & Right), and green approach zones.
  - **Water Hazards & Dams**: Excavated ponds, meandering rivers, and retaining dam wall structures with low-poly reflective water planes.
  - **Tee Boxes**: Championship (Black), Member (White), and Forward (Red) pads with tee marker spheres.
  - **Scenery Props**: Low-poly evergreen Pines, broad Oaks, granite Boulder clusters, and flagsticks.
- **Dynamic Terrain Sculpting**:
  - Raise, Lower, Flatten (plateau), and Smooth brushes with smooth cosine falloffs.
  - Real-time physics collision mesh re-baking for instant collision accuracy.
- **Hole Architect Tools**:
  - Click-to-place Tee Box and Pin/Cup locations.
  - Par 3, Par 4, and Par 5 hole configurations.
  - Create up to 9 unique holes per course.
  - Export and Import course layouts as lightweight JSON files.

### 2. Green Contour & Break Visualizer
- **Topographic Contour Iso-lines**: Subtle elevation break lines.
- **PGA Tour-Style Animated Slope Beads**: Luminous moving particles that travel along downhill slope gradient vectors $(-n_x, -n_z)$.
  - Bead speed directly indicates the steepness of break for realistic green reading.
  - Toggleable in both Designer Mode and Play Mode.

### 3. AAA Ball Flight & Aerodynamics System
Unlike basic physics simulations that only apply gravity and linear damping, this simulation models the true aerodynamics of dimpled golf balls:
- **Magnus Effect (Lift Force)**: Backspin creates aerodynamic lift:
  $$\vec{F}_{\text{lift}} = \frac{1}{2} \rho A C_l |\vec{v}|^2 \frac{\vec{\omega} \times \vec{v}}{|\vec{\omega} \times \vec{v}|}$$
- **Aerodynamic Drag**: Speed-dependent and spin-dependent drag coefficient ($C_d$):
  $$\vec{F}_{\text{drag}} = -\frac{1}{2} \rho A C_d |\vec{v}| \vec{v}$$
- **Sidespin / Axis Tilt**: Mis-hits create draws/hooks or fades/slices that curve realistically in mid-air.
- **Dynamic Wind**: Speed and heading affect trajectory in 3D space.
- **Runge-Kutta 4th-Order (RK4) Integration**: Sub-millimeter trajectory calculation and visual aim arc preview.

### 4. Havok Ground Physics & Surface Interaction
- **Continuous Collision Detection (CCD)**: Prevents ball tunneling at high velocities ($>70\text{ m/s}$).
- **Surface Reaction Matrix**:
  - **Green**: Restitution $0.42$, dynamic friction $0.18$, true rolling resistance. Backspin bites and checks on high loft wedge shots.
  - **Fairway**: Restitution $0.35$, friction $0.30$, natural rollout.
  - **Rough**: Restitution $0.15$, friction $0.70$, high lie penalty ($75\%$ power, $50\%$ spin).
  - **Bunker (Sand)**: Restitution $0.04$, friction $0.95$, dead thud with plugged/minimal rollout.
  - **Water**: Penalty drop near hazard edge.
  - **Hole Cup**: Regulation 4.25-inch ($10.8\text{ cm}$) cup with capture physics and signature cup drop rattle.

### 5. Procedural Audio Synthesizer (Web Audio API)
Zero external audio files required! Synthesizes:
- Driver titanium "PING" & solid compression
- Iron crisp steel "THWACK"
- Wedge blade contact
- Putter subtle click
- Swing whoosh
- Surface bounce sounds (grass tap vs sand thud)
- Cup rattle / drop sound
- Water splash

---

## 🎮 Controls

### Play Mode
- **Spacebar / Swing Button**: 3-Click Swing
  - *Click 1*: Start backswing meter
  - *Click 2*: Lock in swing power
  - *Click 3*: Snap accuracy on the hash mark (snap early for hook/draw, snap late for slice/fade)
- **A / D or Left / Right Arrows**: Adjust aim heading left/right
- **Q / E or Prev/Next Buttons**: Change club (Driver, 3W, 3H, 5I, 7I, 9I, PW, SW, LW, Putter)
- **C**: Cycle camera view (Aim view behind ball $\to$ Green putting view $\to$ Free orbit)
- **R**: Reset / Mulligan shot

### Designer Mode
- **Left Click & Drag (Canvas)**: Orbit camera around course
- **Right Click & Drag**: Pan camera
- **Scroll Wheel**: Zoom in / out
- **Tool Selection**:
  - **Presets**: Select any preset card and click on the 1m grid to stamp and blend it into the terrain.
  - **Sculpt**: Click or drag across the terrain to Raise, Lower, Flatten, or Smooth topography.
  - **Set Tee / Set Pin**: Click anywhere to reposition the tee pad or hole flagstick.
- **1m Grid Button**: Toggles visual 1m grid wireframe overlay.
- **Contours Button**: Toggles animated green slope beads.

---

## 🚀 Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Run local dev server with hot reload
npm run dev

# 3. Build for production
npm run build

# 4. Preview production build locally
npm run preview
```

---

## 🌐 Deploying to Vercel & GitHub

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Fairway Studio 3D Low-Poly Golf Course Designer"
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```
2. **Deploy on Vercel**:
   - Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
   - Import your GitHub repository.
   - Vercel automatically detects **Vite**:
     - **Build Command**: `npm run build`
     - **Output Directory**: `dist`
     - **Install Command**: `npm install`
   - Click **Deploy**! Your 3D golf game and course designer will be live worldwide in seconds.
