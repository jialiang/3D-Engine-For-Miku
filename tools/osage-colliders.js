// The body shapes the hood ribbons collide against: SEGA's own collider list,
// posed from the skeleton, plus the geometry queries the bake's verification
// sweep needs. Task 2B of .ignored/plan.md.
//
// WHY THE RADII ARE NOT SEGA'S. The costume ships three colliders per ribbon
// chain and they are tuned, but they were tuned for the game's own solver, whose
// ribbon trajectory already includes being pushed out. Ours settled onto the
// costume with no collision at all and already sits 3 to 4 mm off it, so
// applying the shipped radii on top pushes a ribbon that is already in the right
// place. Measured over the take at the shipped radii the drawn strip is inside a
// proxy on 76 to 88% of frames, which is a lift, not a fix.
//
// The radii come from `springs.js --calibrate` instead, which reports how close
// the strip's axis gets to each collider over the whole take and turns a
// percentile of that into the radius whose SURFACE sits where the costume's
// surface is. The bones and the bone-local offsets are used exactly as shipped;
// only the radii move.
//
// A capsule collider spans two bones and a ball sits on one. Both are kinematic
// and re-posed every substep so they carry a velocity and can push rather than
// merely block.

// A capsule spans two bones and its half-height cannot be changed once built and
// the distance between two bones of one skeleton is NOT fixed: the shoulder bones
// the costume names are deform helpers the animation pulls from 153 to 207 mm
// apart. So each capsule is built ONCE, at the longest span the take ever reaches
// (measured by measureSpans below) and is therefore up to 27 mm too long at each
// end the rest of the time. Erring long is the safe direction: it reaches further
// over the shoulder it stands for rather than leaving a gap short of it.
//
// SWAPPING THE SHAPE INSTEAD DOES NOT WORK and fails silently, which is worth a
// warning. An earlier version cached one capsule per 5 mm of span and called
// BodyInterface.SetShape when the bucket changed. Measured, that body then
// collides with NOTHING for the rest of the bake: a 300 mm capsule across the
// shoulders left the ribbon's recorded angles bit-identical, while the same
// capsule with the swap disabled moved them from 15.5 to 51.0 degrees. Nothing
// errors and no contact is ever reported. Do not reintroduce SetShape here
// without a test that a body still collides afterwards.

// RUNG 3, the per-bone hulls, added 2026-08-07 and what the bake now actually
// collides against. The capsules and the ball above stand for the shoulders, one
// upper arm and the chest. Measured, the ribbon's nearest surface is the tights
// 53% of the time and a sleeve 24 to 31%, so most of the contact happened where
// the costume declares no collider at all. Hulls fix the coverage rather than the
// radii: one convex hull per bone, built from the costume's own vertices in that
// bone's bind frame and moved rigidly with it.
//
// THE PARTS ARE THE MAYA ROUTE'S and they were measured there rather than
// guessed: closest approach over the take is body 0 mm, sleeve 1 mm, tights 1 mm,
// skirt 30 mm and hand 38 mm, against skirtlace at 195 mm and shoes at 719 mm.
// The hood is deliberately absent, because the ribbon is SEWN to it: a collider
// there would fight the attachment forever.
const HULL_PARTS = ["tights_CH", "sleeve_CH", "body_CH", "m07skirt_CH", "hand_CH"];

// A hull needs four points to have a volume and a bone owning only a handful of
// vertices describes a sliver rather than a body part.
const HULL_MINIMUM_POINTS = 12;

// A vertex joins the hull of EVERY bone holding at least this much of it, not just
// the bone holding most of it.
//
// WHY OVERLAP RATHER THAN DOMINANCE. Grouping by the dominant bone gives each hull
// exactly the vertices no other bone owns more of, so two neighbouring hulls meet
// at a plane in bind space and nothing crosses it. That is fine at bind pose and
// wrong the moment a joint bends: the two hulls turn about different centres and
// hinge apart, opening a gap on the outside of the elbow or knee exactly where a
// ribbon lies across it. Sharing the boundary vertices makes each hull reach into
// its neighbours instead, so bending closes them into each other rather than
// pulling them apart. Overlapping colliders are harmless. Gaps are not.
const HULL_OVERLAP_WEIGHT = 0.15;

// The rotation part of a column-major matrix as an (x, y, z, w) quaternion.
// Shepperd's method: take the branch whose divisor is largest so the square
// root never lands near zero.
const matrixToQuaternion = (m) => {
  const [xx, yy, zz] = [m[0], m[5], m[10]];
  const trace = xx + yy + zz;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return [(m[6] - m[9]) / scale, (m[8] - m[2]) / scale, (m[1] - m[4]) / scale, scale / 4];
  }

  if (xx > yy && xx > zz) {
    const scale = Math.sqrt(1 + xx - yy - zz) * 2;
    return [scale / 4, (m[4] + m[1]) / scale, (m[8] + m[2]) / scale, (m[6] - m[9]) / scale];
  }

  if (yy > zz) {
    const scale = Math.sqrt(1 + yy - xx - zz) * 2;
    return [(m[4] + m[1]) / scale, scale / 4, (m[9] + m[6]) / scale, (m[8] - m[2]) / scale];
  }

  const scale = Math.sqrt(1 + zz - xx - yy) * 2;
  return [(m[8] + m[2]) / scale, (m[9] + m[6]) / scale, scale / 4, (m[1] - m[4]) / scale];
};

const transformPoint = (matrix, point) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

// One hull per bone, described in that bone's own bind frame so it never needs
// rebuilding: the bone's world matrix carries it wherever the pose puts it.
//
// GROUPED BY SHARED WEIGHT, not by dominant bone: a vertex joins every hull whose bone
// holds at least HULL_OVERLAP_WEIGHT of it, so neighbouring hulls reach into each other
// and a bending joint closes them together rather than hinging a gap open. Dominant-bone
// grouping is the standard construction and it was tried first: see HULL_OVERLAP_WEIGHT
// above for what it measured.
const buildHulls = (mat4, gltf, skeletonJson, ribbonJointNames) => {
  const boneIndexByName = new Map(skeletonJson.bones.map((bone, index) => [bone.name, index]));
  const ribbonJoints = ribbonJointNames.map((name) => gltf.skin.jointNames.indexOf(name));

  // bind-local points per skin joint
  const pointsByJoint = new Map();

  for (const primitive of gltf.primitives) {
    if (!HULL_PARTS.some((part) => primitive.name.startsWith(part))) continue;

    const { position, boneIndices, boneWeights } = primitive.attributeBuffer;

    for (let vertex = 0; vertex < position.length / 3; vertex++) {
      const raw = [0, 1, 2, 3].map((slot) => boneWeights[vertex * 4 + slot]);
      const total = raw.reduce((sum, value) => sum + value, 0);
      if (total <= 0) continue;

      const point = [position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]];

      for (let slot = 0; slot < 4; slot++) {
        const joint = boneIndices[vertex * 4 + slot];
        if (raw[slot] / total < HULL_OVERLAP_WEIGHT) continue;
        if (ribbonJoints.includes(joint)) continue;

        if (!pointsByJoint.has(joint)) pointsByJoint.set(joint, []);
        pointsByJoint.get(joint).push(point);
      }
    }
  }

  const hulls = [];
  const skipped = [];

  for (const [joint, points] of pointsByJoint) {
    const name = gltf.skin.jointNames[joint];
    const bone = boneIndexByName.get(name);

    if (bone === undefined) {
      skipped.push(`${name} (no motion bone)`);
      continue;
    }

    if (points.length < HULL_MINIMUM_POINTS) {
      skipped.push(`${name} (${points.length} points)`);
      continue;
    }

    // Into the bone's own frame. The inverse bind matrix IS that transform, which
    // is why no hull ever has to be rebuilt as she moves.
    const inverseBind = gltf.skin.inverseBindMatrices.slice(joint * 16, joint * 16 + 16);
    hulls.push({
      name,
      bone,
      points: points.map((point) => transformPoint(inverseBind, point)),
    });
  }

  return { hulls, skipped };
};

// The Jolt side of the hulls: one kinematic body each, posed from its bone.
const createHullBodies = (Jolt, bodies, hulls, layer, worldMatrices) => {
  const scratchPosition = new Jolt.RVec3(0, 0, 0);
  const scratchRotation = new Jolt.Quat(0, 0, 0, 1);

  const created = hulls.map((hull) => {
    const points = new Jolt.ArrayVec3();
    for (const point of hull.points) points.push_back(new Jolt.Vec3(...point));

    const settings = new Jolt.ConvexHullShapeSettings();
    settings.mPoints = points;

    const result = settings.Create();
    if (result.HasError()) throw new Error(`hull for ${hull.name}: ${result.GetError().c_str()}`);

    const shape = result.Get();
    const matrix = worldMatrices[hull.bone];

    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(matrix[12], matrix[13], matrix[14]),
      new Jolt.Quat(...matrixToQuaternion(matrix)),
      Jolt.EMotionType_Kinematic,
      layer,
    );
    bodySettings.mAllowSleeping = false;

    const body = bodies.CreateBody(bodySettings);
    bodies.AddBody(body.GetID(), Jolt.EActivation_Activate);

    return { hull, body, shape };
  });

  const pose = (matrices, substep) => {
    for (const entry of created) {
      const matrix = matrices[entry.hull.bone];

      scratchPosition.Set(matrix[12], matrix[13], matrix[14]);
      scratchRotation.Set(...matrixToQuaternion(matrix));
      entry.body.MoveKinematic(scratchPosition, scratchRotation, substep);
    }
  };

  // The hulls as triangles, for drawing them in the engine. Taken from Jolt's own
  // shapes rather than recomputed, so what is on screen is what collided.
  const triangles = () => {
    // Destroyed by hand, and one scale shared: these are handles into the WASM heap rather
    // than JS objects, so nothing collects them and a leak per hull per call exhausts the
    // heap mid-solve, aborting nowhere near the line at fault.
    const scale = new Jolt.Vec3(1, 1, 1);

    const meshes = created.map((entry) => {
      const context = new Jolt.ShapeGetTriangles(
        entry.shape,
        Jolt.AABox.prototype.sBiggest(),
        entry.shape.GetCenterOfMass(),
        Jolt.Quat.prototype.sIdentity(),
        scale,
      );

      const floats = new Float32Array(
        Jolt.HEAPF32.buffer,
        context.GetVerticesData(),
        context.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT,
      );

      // copied out before the context goes: the view is a window onto the WASM heap
      const vertices = [...floats];

      Jolt.destroy(context);

      return { name: entry.hull.name, bone: entry.hull.bone, vertices };
    });

    Jolt.destroy(scale);

    return meshes;
  };

  return { pose, triangles, count: created.length };
};

module.exports = { buildHulls, createHullBodies };
