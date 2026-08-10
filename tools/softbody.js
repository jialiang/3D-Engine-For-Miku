// Simulate a hood ribbon as CLOTH and write the per-vertex cache the mode basis is
// built from (.ignored/make-basis.js). The other half of the ribbon story: this
// replaces the rod bake, kept under .ignored/rod-bake, for the parts a rod cannot reach.
//
// WHY NOT A BONE. Measured with .ignored/probe-modes.js, the best possible single
// bone fitted per frame to this cloth leaves 24 to 41 mm rms per vertex and explains
// only 68 to 81% of its head-local variance, because the drawn strip's shape is a
// two-parameter family and cloth is not. Sixteen vertex modes off this cache
// reconstruct it to 2.0 mm rms. The rod bake stays for comparison and as the
// fallback. This is what the shape actually needs.
//
// WHY JOLT AND NOT MAYA, which the alt route used: measured on the same proxy and
// window, Jolt kinks 12 degrees where nCloth kinks 80 to 105, opens 2 mm edges
// against 16 to 20 and runs the take in seconds rather than half an hour.
//
// WHAT IT COLLIDES AGAINST is the per-bone hulls in tools/osage-colliders.js, not
// the costume's three proxies. The proxies stand for the shoulders, one upper arm
// and the chest, while the ribbon's nearest surface is the tights half the time. And
// measured against them the sim buried free stations 84 to 102 mm deep, with one
// proxy swallowing the held root by 40 mm. A pinned vertex inside a
// collider can never be pushed out, so the solver shoves the first FREE station
// instead, which is a fold that looks like cloth failure and is not.
//
// ONE RIBBON PER RUN. Both at once exhausted the WASM heap in the probe this grew
// out of and the two chains never interact (the game only collides chain against
// chain when colli_tgt_osg is set, which the F 2nd data never sets).
//
// usage: node tools/softbody.js --only JOINT [--out DIR] [--proxy PATH]
//                              [--frames N] [--from N] [--bend N] [--retention N]
//                              [--vertex-radius MM] [--gravity FACTOR] [--skin-reach MM]
//                              [--held-damping F] [--iterations N] [--friction F]
//                              [--batten COMPLIANCE] [--binary-hold]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const initJolt = require("jolt-physics/wasm-compat").default;
const { loadMergedMotion } = require("./mot1");
const { buildHulls, createHullBodies } = require("./osage-colliders");

const ROOT = path.join(__dirname, "..");
const MOTIONS = path.join(ROOT, "motions");

const readOption = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : fallback;
};

// Substeps per frame. Four is what the probe this grew out of used and the cloth is
// heavily damped, so the count buys collision robustness rather than accuracy.
const SUBSTEPS = 4;

// Frames simulated before the take starts and thrown away, so the strip hangs where
// it belongs at frame 0 instead of dropping into place on screen.
const PREROLL = 60;

// THE THREE KNOBS THAT SET HOW LIVELY THE RIBBON IS and they are not interchangeable: only one
// of them dissipates, one changes shape rather than motion and the one that actually answers
// "reduce the energy" is gravity, below.
//
// RETENTION is how much speed a vertex keeps per frame and it becomes mLinearDamping below.
// It is the DISSIPATION: lower means a flung strip dies away instead of ringing on. This is
// the one to turn when the ribbon has too much energy.
//
// Measured with .ignored/probe-settling.js. Read its quiet/busy column, not its settling
// times: the times are a RELATIVE threshold, a fifth of the speed the tail reached during the
// throw and more damping lowers that peak, so the target moves down with it and the metric
// is not monotonic in damping. It duly reports 0.86 as worse than 0.90 on the right ribbon
// while 0.82 is worse than both. Residual motion as a share of driven motion has no such
// problem and on the right ribbon it falls 15%, 12%, 11%, 10% across 0.95, 0.90, 0.86 and
// 0.82, against a busy speed of 12.16, 10.95, 10.68 and 10.49 mm per frame.
//
// 0.95 rang: it never fell to a fifth within 1.5s. 0.90 took most of that out for 9% of the
// swing and 0.86 is a small further step on an aesthetic call that is the user's to make.
//
// BEND is the bend compliance, an inverse stiffness in metres per newton and IT IS NOT A
// LIVELINESS KNOB. Measured with .ignored/probe-settling.js across five orders of magnitude at
// a fixed retention, residual motion as a share of driven motion sits at 12 to 13% for every
// value from 1e-2 to 0 and the stiffest settings ring slightly LONGER if anything, since a
// stiff spring returns the energy it stores. Turning this to calm the ribbon does nothing.
//
// MOST OF ITS RANGE DOES NOTHING AT ALL, either. An XPBD constraint is scaled by
// compliance / dt^2 and dt here is 1/(60 * 4) seconds, so 1e-2 comes to 576 against an
// inverse mass of 1 and the bend constraints are effectively switched off. They only begin to
// bite below about 1.7e-5. That is why 1e-3 measures identical to 1e-2: both are off.
//
// WHAT IT ACTUALLY CHANGES is the shape and not in the direction the word "stiffer" suggests.
// Over 1e-2 to 0, measured by .ignored/probe-ripple.js, the sharpest bends get gentler (99th
// percentile curvature 41.2 down to 36.1 deg/cm) while the strip curls MORE overall (median
// 2.81 up to 3.50): a stiff strip holds a broad smooth arc where a floppy one hangs nearly
// straight and creases. Reach for it to remove creases, not to remove motion.
const BEND = Number(readOption("--bend", 1e-5));
const RETENTION = Number(readOption("--retention", 0.9));

// GRAVITY IS THE BEST OF THE THREE FOR CALMING THE RIBBON and it is not the same trade as
// damping. Damping removes energy by opposing motion, so it opposes the motion being asked for
// as well and the strip goes quiet by going slack. Gravity removes it by giving the strip
// somewhere to return TO: a heavier ribbon is thrown just as readily, flies less far and comes
// back to hanging sooner, which reads as weight rather than as deadness. The strip is 26cm, so
// its pendulum period is about a second, right in the band the choreography drives it at and
// raising the restoring force detunes it away from that band.
//
// WHY THE SPEED-BASED MEASURES ALMOST MISSED IT. Probe-settling.js only moves from 13% to 11%
// residual across a factor of eight here, which reads as "gravity does nothing". What it changes
// is how far the tail goes and nothing here measured that until it was asked directly: on the
// right ribbon, excursion from hanging at 1x, 2x, 4x and 8x runs 82, 72, 65 and 59mm at the
// median and 188, 153, 139 and 127mm at the 90th percentile.
//
// 4x buys a quarter less excursion and a quarter less snaking (probe-ripple.js: median curvature
// 2.94 to 2.18 deg/cm, total curl 181 to 146 degrees) for 5% of the busy speed and the basis
// reconstructs BETTER for it, 4.07mm rms down to 3.17mm, since there is less motion to carry.
// It costs a little clipping, 22.4% of frames to 24.6%, because the tail is held down against
// her harder.
//
// Yes, this is a lie about gravity. It is the cleanest way to say "heavier fabric" when every
// vertex has the same mass and a bake has no obligation to be honest about g.
const GRAVITY = Number(readOption("--gravity", 4));

// Solver iterations per substep. This is the remedy for an ill-conditioned solve rather than a
// quality dial: the graded mass puts a 50kg vertex next to a 1kg one and too few iterations
// leave that unresolved as chatter.
const ITERATIONS = Number(readOption("--iterations", 12));

// How much the cloth grips what it touches. Jolt defaults soft bodies to zero, so without this
// the strip SKATES across her skin: it is held off by the contact but free to slide along it,
// which is its own kind of restlessness and a plausible source of chatter in contact.
const FRICTION = Number(readOption("--friction", 0));

// Compliance of the width battens. Rigid battens are REDUNDANT with the row's own rigid edges,
// and the two are only both satisfiable while the row is dead straight: a row that curves has a
// shorter chord than its arc, so the set becomes infeasible and the solver oscillates between
// them. A little compliance lets the row curve while still refusing to collapse.
const BATTEN = Number(readOption("--batten", 0));

// Extra speed taken out of the partly held rows each substep, FLAT ACROSS THE GRADED BAND
// rather than scaled by how much the hood holds each row. Scaling was the obvious form and it
// leaves the rows nearest the held block barely damped, which is exactly where the residual
// chatter lives: those rows sit against a kinematic block on one side and free cloth on the
// other. Damping is safe where an attract was not, since it only ever removes energy and so
// cannot set up a limit cycle against the contact pushing out.
const HELD_DAMPING = Number(readOption("--held-damping", 0.6));

// How far a FREE vertex may sit from where the hood's skinning would put it, in MILLIMETRES.
// The hold scales it down, so a vertex held outright gets zero and is pinned to the skin. This
// is the allowance in Jolt's own skinned constraints, which is where the holding lives now.
const SKIN_REACH = Number(readOption("--skin-reach", 120)) / 1000;

// Influences per skinned constraint in Jolt's fixed inline array. Only the first is used here,
// since every cage vertex hangs off the head alone, but the others must be zeroed.
const SKIN_WEIGHTS = 4;

// HULLS THE RIBBON IS ATTACHED TO RATHER THAN RESTING AGAINST. The bow is sewn to the hood on
// her head and its authored position sits inside the hulls grouped under the head and neck
// bones, so colliding it against those asks for something impossible: a kinematic vertex is held
// where the hood puts it while its neighbour, on a rigid edge from it, is told to be outside a
// hull the whole edge is inside. The solver cannot satisfy both and chatters. A ribbon does not
// collide with the thing it hangs from.
const ATTACHED_BONES = ["j_kao_wj", "n_kubi_wj_ex"];

// Round the hold to held-or-free, which is what it was before it was graded. Kept as an escape
// hatch because grading buys less bow clipping and costs chatter.
const IS_BINARY_HOLD = process.argv.includes("--binary-hold");

// How thick each cloth vertex is to the solver, in MILLIMETRES, matching how
// the rod bake states its radii.
//
// THIS IS THE MODE BASIS'S ERROR BUDGET, which is what sets it rather than any belief about
// how thick the cloth is. The drawn ribbon is reconstructed from 24 modes and misses by a
// few millimetres (7.7mm at its worst on frame 3963), so a sheet resting flat on her skin
// has nothing to spend and the error goes straight through her. Standing the sheet off by
// more than the error puts the mistake in fresh air instead.
//
// Swept end to end, crossings against the stand-off it costs: 3mm leaves 48.8% of frames
// crossing with the ribbon a median 1.7mm off her, 5mm gives 26.2% at 3.0mm, 8mm gives
// 12.2% at 5.7mm and 12mm gives 5.4% but holds the ribbon 9.5mm off her and within 2mm of
// her on only 3.3% of frames, which reads as hovering. 8 is the knee.
const VERTEX_RADIUS = Number(readOption("--vertex-radius", 8)) / 1000;

// PENETRATION SLOP IS NOT A KNOB HERE and it looked like the obvious one. Jolt defaults
// mPenetrationSlop to 20mm, which is sized for metre-scale rigid bodies and is wider than
// this whole ribbon, so it read as the likely reason the cloth sits inside her. It is not:
// setting it to 1mm through PhysicsSystem.SetPhysicsSettings, verified to have taken by
// reading it back, leaves the cache identical to every digit reported. The slop governs
// rigid contacts and does not reach soft-body vertex contacts (jolt-physics wasm-compat,
// the version in package.json). Measure something else before spending a bake on this.

const LAYER_CLOTH = 0;
const LAYER_HULL = 1;
const OBJECT_LAYERS = 2;
const BROAD_PHASE_LAYERS = 2;

const loadClasses = () => {
  const sources = [
    "glMatrix-mat4.js",
    "Utilities.js",
    "FileParser.js",
    "GLTF.js",
    "Animation.js",
    "OsageRig.js",
    "BoneMath.js",
    "Rig.js",
    "Skeleton.js",
  ]
    .map((file) => fs.readFileSync(path.join(ROOT, "engine", file), "utf8"))
    .join("\n");

  return vm.runInThisContext(sources + "\n({ mat4, Utilities, GLTF, Animation, Skeleton })");
};

const transformPoint = (matrix, point) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

const readBuffer = (file) => {
  const buffer = fs.readFileSync(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

const setupCollisionFiltering = (Jolt, settings) => {
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(OBJECT_LAYERS);
  objectFilter.EnableCollision(LAYER_CLOTH, LAYER_HULL);

  const broadPhase = new Jolt.BroadPhaseLayerInterfaceTable(OBJECT_LAYERS, BROAD_PHASE_LAYERS);
  broadPhase.MapObjectToBroadPhaseLayer(LAYER_CLOTH, new Jolt.BroadPhaseLayer(1));
  broadPhase.MapObjectToBroadPhaseLayer(LAYER_HULL, new Jolt.BroadPhaseLayer(0));

  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = broadPhase;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    broadPhase,
    BROAD_PHASE_LAYERS,
    objectFilter,
    OBJECT_LAYERS,
  );
};

// HOW MUCH THE HOOD HOLDS EACH CAGE VERTEX, from 1 for driven entirely by the head to
// 0 for free cloth. Make-sim-proxy.js grades this off SEGA's own weight ramp so the bow
// can sit where it was authored and still be pushed off her skin, which a flag cannot
// express. Older proxies carry only a binary pin list, which reads as 1 and 0.
const holdFractions = (proxy) => {
  const count = proxy.vertices.length / 3;
  if (proxy.hold) return Float64Array.from(proxy.hold);

  const held = new Set(proxy.pins ?? []);

  return Float64Array.from({ length: count }, (unused, index) => (held.has(index) ? 1 : 0));
};

const main = async () => {
  const only = readOption("--only", null);
  if (!only) throw new Error("--only JOINT is required, one ribbon per run");

  const outputDirectory = path.resolve(readOption("--out", path.join(ROOT, ".ignored")));
  const proxyPath = path.resolve(readOption("--proxy", path.join(ROOT, ".ignored/sim-proxy.json")));

  const { mat4, Utilities, GLTF, Animation, Skeleton } = loadClasses();
  Utilities.loadImage = async () => null;

  const gltf = await GLTF.load(readBuffer(path.join(ROOT, "models/pierretta/pierretta.glb")));
  const skeletonJson = JSON.parse(fs.readFileSync(path.join(MOTIONS, "mik_skeleton.json"), "utf8"));

  const animation = new Animation("pv_743.bin", loadMergedMotion(path.join(MOTIONS, "pv_743")));
  const skeleton = new Skeleton(skeletonJson, animation, gltf.skin, gltf.nodes);

  const proxies = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
  const proxy = proxies.ribbons.find((entry) => entry.joint === only);
  if (!proxy) throw new Error(`${proxyPath} has no proxy for ${only}`);

  const from = Number(readOption("--from", 0));
  const frames = Math.min(
    Number(readOption("--frames", animation.frameCount)),
    animation.frameCount - from,
  );

  const count = proxy.vertices.length / 3;
  const hold = holdFractions(proxy);
  if (IS_BINARY_HOLD)
    for (let index = 0; index < hold.length; index++) hold[index] = hold[index] >= 0.5 ? 1 : 0;
  const headJoint = gltf.skin.jointNames.indexOf("j_kao_wj");
  if (headJoint < 0) throw new Error("no j_kao_wj in the skin");

  const fullyHeld = [...hold].filter((fraction) => fraction >= 1).length;
  const partlyHeld = [...hold].filter((fraction) => fraction > 0 && fraction < 1).length;

  console.log(
    `${only}: ${count} cage vertices (${fullyHeld} held, ${partlyHeld} partly), ` +
      `frames ${from}..${from + frames - 1}, bend ${BEND}, retention ${RETENTION}, ` +
      `radius ${(VERTEX_RADIUS * 1000).toFixed(1)}mm`,
  );

  // Where the head alone puts the cage on a frame: the shape it starts from and the
  // target every held vertex is driven to.
  const goalAt = (frame) => {
    const palette = skeleton.pose(animation, frame);
    const head = palette.subarray(headJoint * 16, headJoint * 16 + 16);

    const goal = [];
    for (let vertex = 0; vertex < count; vertex++) {
      goal.push(transformPoint(head, proxy.vertices.slice(vertex * 3, vertex * 3 + 3)));
    }

    return goal;
  };

  const Jolt = await initJolt();
  const joltSettings = new Jolt.JoltSettings();
  setupCollisionFiltering(Jolt, joltSettings);

  const joltInterface = new Jolt.JoltInterface(joltSettings);
  const physics = joltInterface.GetPhysicsSystem();
  const bodies = physics.GetBodyInterface();

  // Scratch for the skinned constraints: an identity inverse bind (see below) and a
  // one-element joint matrix array whose data() is the Mat44MemRef SkinVertices wants.
  const identity = Jolt.Mat44.prototype.sIdentity();
  const jointMatrices = new Jolt.ArrayMat44();
  jointMatrices.resize(1);
  const scratchColumn = new Jolt.Vec4(0, 0, 0, 0);

  // THE BIND-SPACE REST, not the posed start. Jolt's skinned constraints skin from the shared
  // settings' own vertex positions, so those have to BE the rest the joint matrix is meant to
  // carry: seeding them with the already-posed position at the start frame applies the palette
  // twice and pins every held vertex most of a metre from where it belongs. The body still ends
  // up in world space, because the opening SkinVertices call hard-skins it there and the
  // preroll swallows the transient.
  const settings = new Jolt.SoftBodySharedSettings();
  for (let index = 0; index < count; index++) {
    const point = proxy.vertices.slice(index * 3, index * 3 + 3);
    const vertex = new Jolt.SoftBodySharedSettingsVertex();
    vertex.set_mPosition(new Jolt.Float3(point[0], point[1], point[2]));
    // ZERO WHERE THE HOOD HOLDS IT OUTRIGHT and one everywhere else. The rows that must be
    // exactly on the hood stay kinematic, because a skinned constraint is SOLVED rather than
    // assigned and cannot keep up with her head: at mMaxDistance zero it still lagged by up to
    // 48.8mm over the take. Everything else gets uniform mass, which also removes a chatter
    // source: grading the mass put a 50kg vertex beside a 1kg one, an ill-conditioned solve at
    // any iteration count and it never held anything anyway, since gravity is an acceleration
    // and mass does not resist it.
    vertex.mInvMass = hold[index] >= 1 ? 0 : 1;
    settings.get_mVertices().push_back(vertex);
  }

  for (let corner = 0; corner + 2 < proxy.faces.length; corner += 3) {
    const face = new Jolt.SoftBodySharedSettingsFace();
    for (const slot of [0, 1, 2]) face.set_mVertex(slot, proxy.faces[corner + slot]);
    settings.AddFace(face);
  }

  const attributes = new Jolt.SoftBodySharedSettingsVertexAttributes();
  attributes.mCompliance = 0;
  attributes.mBendCompliance = BEND;
  settings.CreateConstraints(
    attributes,
    1,
    Jolt.SoftBodySharedSettings_EBendType_Distance,
    Jolt.SoftBodySharedSettings_ELRAType_None,
  );

  // A BATTEN ACROSS EVERY ROW, or the strip is drawn thin. Rigid edges do not stop a
  // quad grid folding along the diagonal each quad is split on and at BEND = 1e-2
  // folding is cheap, so the sheet accordions across its width: measured over the take,
  // rows sit at a median 75.4% of their authored width and the worst at 1.8%, while
  // their LENGTH holds at 95.6%. The drawn ribbon follows, since its two edges anchor
  // near the sheet's outer columns and because the collapse is in the mean as well as
  // the motion it is baked in permanently rather than only while she moves.
  //
  // One rigid edge from the first column to the last fixes each row's span without
  // touching how freely the strip bends along its length, which is the motion wanted.
  // A real ribbon behaves the same way: it will not stretch across its narrow
  // dimension, whatever it does along the other one.
  for (let row = 0; row < proxy.stations; row++) {
    const first = row * proxy.across;
    const batten = new Jolt.SoftBodySharedSettingsEdge(first, first + proxy.across - 1, BATTEN);
    settings.get_mEdgeConstraints().push_back(batten);
  }

  // THE SEAM, when make-sim-proxy.js split the bow off as its own piece (--bow-cage). The
  // bow's cage and the tail's sheet are different tessellations of one ribbon, so they
  // share no vertices and the faces alone leave two loose bodies in one soft body. These
  // edges are the join and they are rigid: the tail hangs off the bow through them.
  for (const [from, to] of proxy.stitch ?? []) {
    settings.get_mEdgeConstraints().push_back(new Jolt.SoftBodySharedSettingsEdge(from, to, 0));
  }

  // Fills in every rest length from the vertex positions, the battens and the seam included.
  settings.CalculateEdgeLengths();

  // HOLDING THE BOW, as a constraint the solver owns rather than something imposed on it.
  //
  // Every hand-rolled attempt at this fought the contact and chattered, because each of them
  // ran OUTSIDE the solver: pull the vertex toward the head, let the solver push it out, pull it
  // again. Jolt's skinned constraints say the thing that was actually meant, which is that a
  // vertex may be anywhere within mMaxDistance of where the skin puts it and they are resolved
  // in the same pass as collision. A contact that needs the vertex somewhere inside its
  // allowance simply gets it, with nothing to argue with.
  //
  // ONE JOINT, WEIGHT 1, AND AN IDENTITY INVERSE BIND. Jolt skins a vertex by
  // jointMatrix * invBind * rest and the palette this bake already computes IS
  // headWorld * headInverseBind, so handing the palette in as the joint matrix and leaving the
  // inverse bind as identity reproduces goalAt exactly. Doing it the other way round would mean
  // carrying the head's inverse bind here as well, for the same answer.
  //
  // These types have no constructor in the IDL, so the arrays are resized and their elements
  // filled in place. Their defaults matter: mMaxDistance and mBackStopDistance both start
  // effectively infinite, so a vertex left alone is unconstrained.
  const invBinds = settings.get_mInvBindMatrices();
  invBinds.resize(1);
  invBinds.at(0).mJointIndex = 0;
  invBinds.at(0).mInvBind = identity;

  const skinned = settings.get_mSkinnedConstraints();
  // Only the graded band. A fully held vertex has zero inverse mass, so no constraint can move
  // it and one would be pointless. A free one is meant to go where it likes.
  const heldVertices = [...hold.keys()].filter((index) => hold[index] > 0 && hold[index] < 1);
  skinned.resize(heldVertices.length);

  heldVertices.forEach((index, slot) => {
    const entry = skinned.at(slot);
    entry.mVertex = index;

    // the allowance: nothing where the hood holds it outright, the full reach where it is free
    entry.mMaxDistance = SKIN_REACH * (1 - hold[index]);

    // one influence and the other three zeroed or they would each pull toward the origin
    for (let weight = 0; weight < SKIN_WEIGHTS; weight++) {
      entry.get_mWeights(weight).mInvBindIndex = 0;
      entry.get_mWeights(weight).mWeight = weight ? 0 : 1;
    }
  });

  // Needed by the backstop and it is what makes a skinned vertex know which way is out.
  settings.CalculateSkinnedConstraintNormals();
  settings.Optimize();

  const creation = new Jolt.SoftBodyCreationSettings(
    settings,
    new Jolt.RVec3(0, 0, 0),
    new Jolt.Quat(0, 0, 0, 1),
    LAYER_CLOTH,
  );
  // The body's own transform stays at the origin and the vertices carry the motion,
  // so every position read back is already world space.
  creation.mUpdatePosition = false;
  creation.mAllowSleeping = false;
  creation.mNumIterations = ITERATIONS;
  creation.mLinearDamping = animation.frameRate * SUBSTEPS * (1 - RETENTION ** (1 / SUBSTEPS));
  creation.mVertexRadius = VERTEX_RADIUS;
  creation.mGravityFactor = GRAVITY;
  creation.mFriction = FRICTION;

  const body = bodies.CreateSoftBody(creation);
  bodies.AddBody(body.GetID(), Jolt.EActivation_Activate);

  const properties = Jolt.castObject(body.GetMotionProperties(), Jolt.SoftBodyMotionProperties);

  skeleton.pose(animation, from);
  const { hulls, skipped } = buildHulls(mat4, gltf, skeletonJson, [only]);
  const colliding = hulls.filter((hull) => !ATTACHED_BONES.includes(hull.name));
  const hullBodies = createHullBodies(Jolt, bodies, colliding, LAYER_HULL, skeleton.worldMatrices);

  console.log(
    `colliding against ${hullBodies.count} per-bone hulls` +
      (skipped.length ? ` (${skipped.length} bones too small)` : ""),
  );

  const substep = 1 / (animation.frameRate * SUBSTEPS);
  const rootTransform = Jolt.RMat44.prototype.sIdentity();
  const tempAllocator = joltInterface.GetTempAllocator();

  // Hand the head's palette to the solver as this frame's joint matrix, so its skinned
  // constraints know where the hood would put every vertex. `isFirst` hard-skins on the opening
  // call, which snaps the held rows onto the skin instead of letting them converge to it.
  const skinTo = (frame, isFirst) => {
    const palette = skeleton.pose(animation, frame);
    const head = palette.subarray(headJoint * 16, headJoint * 16 + 16);
    const matrix = jointMatrices.at(0);

    for (let column = 0; column < 4; column++) {
      scratchColumn.Set(
        head[column * 4],
        head[column * 4 + 1],
        head[column * 4 + 2],
        head[column * 4 + 3],
      );
      matrix.SetColumn4(column, scratchColumn);
    }

    properties.SkinVertices(rootTransform, jointMatrices.data(), 1, isFirst, tempAllocator);
  };
  const scratchVelocity = new Jolt.Vec3(0, 0, 0);
  // REUSED, not allocated per vertex per substep. A Jolt.Vec3 is a handle into the wasm
  // heap that has to be destroyed by hand and one per held vertex per substep is 884k
  // allocations at 12 pins, which survives, against 7.1M at 96, which aborts the whole
  // run with OOM inside the solver rather than anywhere near this line.
  const scratchPosition = new Jolt.Vec3(0, 0, 0);
  const inverseHead = mat4.create();

  const cache = [];
  let worstDrift = 0;
  let worstHeldGap = 0;
  let isOpening = true;
  const started = Date.now();

  for (let offset = -PREROLL; offset < frames; offset++) {
    const frame = from + Math.max(offset, 0);

    for (let step = 0; step < SUBSTEPS; step++) {
      // The substeps advance INTO this frame so the last lands exactly on it. Sweeping
      // out of it instead leaves the recorded positions a quarter-frame ahead of the
      // pose they get compared against, which is tens of millimetres while she moves.
      const at =
        offset <= 0 ? frame : Math.min(frame - 1 + (step + 1) / SUBSTEPS, animation.frameCount - 1);

      // POSED ONCE for the whole substep. GoalAt poses too, so calling it inside the loop below
      // would re-pose the skeleton for every vertex.
      const goal = goalAt(at);
      hullBodies.pose(skeleton.worldMatrices, substep);

      // WHERE THE HOOD WOULD PUT EVERY VERTEX THIS SUBSTEP. That is the whole of the holding
      // now: the skinned constraints declared above take it from here and are resolved with
      // collision rather than against it. Four hand-rolled versions of this ran outside the
      // solver and every one of them chattered, from 19% of moving frames to 45%, against 8% for
      // free cloth.
      skinTo(at, isOpening);
      isOpening = false;

      // The rows held outright are placed rather than constrained, for the reason given where
      // their inverse mass is set. Position only: Jolt integrates position from velocity for
      // zero-mass vertices too, so writing both makes the two fight and they walk off.
      for (let index = 0; index < count; index++) {
        if (hold[index] < 1) continue;

        const vertex = properties.GetVertex(index);
        vertex.mVelocity = scratchVelocity;

        scratchPosition.Set(...goal[index]);
        vertex.mPosition = scratchPosition;
      }

      // Damping the held band is still worth it and cannot chatter, since it only ever removes
      // energy: flat across the band rather than scaled by the hold, because scaling leaves the
      // rows nearest the held block almost undamped and those are the ones under contact.
      if (HELD_DAMPING > 0) {
        for (let index = 0; index < count; index++) {
          if (hold[index] <= 0 || hold[index] >= 1) continue;

          const vertex = properties.GetVertex(index);
          const speed = vertex.mVelocity;
          const keep = 1 - HELD_DAMPING;

          scratchVelocity.Set(speed.GetX() * keep, speed.GetY() * keep, speed.GetZ() * keep);
          vertex.mVelocity = scratchVelocity;
          scratchVelocity.Set(0, 0, 0);
        }
      }

      joltInterface.Step(substep, 1);
    }

    if (offset < 0) continue;

    const palette = skeleton.pose(animation, frame);
    mat4.invert(inverseHead, palette.subarray(headJoint * 16, headJoint * 16 + 16));

    const goal = goalAt(frame);

    for (let index = 0; index < count; index++) {
      const point = properties.GetVertex(index).mPosition;
      const world = [point.GetX(), point.GetY(), point.GetZ()];

      const offGoal = Math.hypot(
        world[0] - goal[index][0],
        world[1] - goal[index][1],
        world[2] - goal[index][2],
      );

      // A FULLY held vertex must read back where it was driven, or the body is not in
      // world space and the whole cache is nonsense. A partly held one is MEANT to leave its
      // goal, since the whole point is that contact can refuse the pull, so its distance is
      // reported rather than checked: it is the number that says whether a velocity attract
      // still keeps the bow on the hood or lets it slide away over 18,000 frames.
      if (hold[index] >= 1) worstDrift = Math.max(worstDrift, offGoal);
      else if (hold[index] > 0) worstHeldGap = Math.max(worstHeldGap, offGoal);

      // into the head's bind space, which is the layout make-basis.js reads
      const local = transformPoint(inverseHead, world);
      cache.push(local[0], local[1], local[2]);
    }
  }

  const seconds = (Date.now() - started) / 1000;
  console.log(
    `simulated ${frames} frames at ${SUBSTEPS} substeps in ${seconds.toFixed(1)}s, ` +
      `held vertices drifted at most ${(worstDrift * 1000).toFixed(3)}mm, ` +
      `partly held sit up to ${(worstHeldGap * 1000).toFixed(0)}mm off their goal`,
  );

  if (worstDrift > 0.001) throw new Error("held vertices drifted, so the cache is not world space");

  if (!fs.existsSync(outputDirectory)) fs.mkdirSync(outputDirectory, { recursive: true });

  const name = `sim-cache-${only}.bin`;
  fs.writeFileSync(path.join(outputDirectory, name), Buffer.from(new Float32Array(cache).buffer));

  // Merged with whatever is already there, since each ribbon is a separate run and shaped so
  // make-basis.js reads any bake's output with no special case.
  const sidecarPath = path.join(outputDirectory, "sim-cache.json");
  const existing = fs.existsSync(sidecarPath)
    ? JSON.parse(fs.readFileSync(sidecarPath, "utf8"))
    : null;

  const caches = (
    existing?.from === from && existing?.frames === frames ? existing.caches : []
  ).filter((entry) => entry.joint !== only);
  caches.push({ joint: only, file: name, vertices: count });

  fs.writeFileSync(
    sidecarPath,
    `${JSON.stringify(
      {
        version: 1,
        space: "glb bind (mesh) space, metres, through the inverse head palette",
        from,
        frames,
        frameRate: animation.frameRate,
        layout: "frame-major, 3 floats per vertex",
        solver: "jolt soft body, tools/softbody.js",
        settings: {
          bend: BEND,
          retention: RETENTION,
          skinReach: SKIN_REACH,
          heldDamping: HELD_DAMPING,
          iterations: ITERATIONS,
          vertexRadius: VERTEX_RADIUS,
          gravity: GRAVITY,
          subFrames: SUBSTEPS,
          preroll: PREROLL,
        },
        caches,
      },
      null,
      1,
    )}\n`,
  );

  console.log(`wrote ${name} (${cache.length / 3} positions) and sim-cache.json`);

  // The cage itself, for drawing which vertices are HELD and which hang free (see
  // ColliderDebug.js). Rest positions only, which is all the runtime needs: a held
  // vertex is driven to exactly the head's palette times its rest position, so those
  // are exact on every frame and the free ones mark where the strip starts from.
  //
  // Its own file rather than springs_colliders.json, which the rod bake owns. Both live
  // under .ignored, since only the viewer overlay and the probes ever read them.
  const cagePath = path.join(ROOT, ".ignored/debug/springs_cage.json");
  fs.mkdirSync(path.dirname(cagePath), { recursive: true });
  const previous = fs.existsSync(cagePath) ? JSON.parse(fs.readFileSync(cagePath, "utf8")) : null;
  const ribbons = (previous?.ribbons ?? []).filter((entry) => entry.joint !== only);

  // IN THE HEAD'S OWN FRAME, not raw bind space, which is the same convention
  // buildHulls uses: the viewer then places these with the bone's world matrix and
  // gets the palette for free. Writing bind-space points instead makes the reader
  // apply the bind transform twice and the cage floats off into the air.
  const headInverseBind = gltf.skin.inverseBindMatrices.slice(headJoint * 16, headJoint * 16 + 16);
  const inHeadFrame = [];

  for (let vertex = 0; vertex < count; vertex++) {
    inHeadFrame.push(
      ...transformPoint(headInverseBind, proxy.vertices.slice(vertex * 3, vertex * 3 + 3)),
    );
  }

  ribbons.push({
    joint: only,
    stations: proxy.stations,
    across: proxy.across,
    held: [...hold].map((fraction) => fraction >= 1),
    hold: [...hold],
    vertices: inHeadFrame,
  });

  fs.writeFileSync(
    cagePath,
    `${JSON.stringify(
      {
        version: 1,
        space: "j_kao_wj bind frame, metres; place with that bone's world matrix",
        ribbons,
      },
      null,
      1,
    )}
`,
  );

  console.log(`wrote ${path.relative(ROOT, cagePath)}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
