// Ground the feet of the Cat Food body motion, in place.
//
// The corrected left/right leg IK-target heights are written straight into the clip's own
// windows (motions/pv_743), so the plain pose loop lands the feet and the runtime applies
// nothing on top. There used to be a separate override file for this; there is not one now.
//
// THE AUTHORED LEG TRACKS ARE KEPT BESIDE THE CLIP, in pv_743-legs-authored.bin, and every
// run solves from them. Without that the second run would ground the already-grounded clip.
// It is the same arrangement as the PNG masters beside the WebP and the lossless audio
// beside the mp3: keep the source, ship the derived thing, never serve the source.
//
// Why grounding is needed at all: the take was authored against the game's foot-bottom
// model (heel point + toe-tip probe, ReDIVA get_ashi_pos), whose height disagrees with the
// costume's real sole by bind-measured offsets, and the game only ever LIFTS feet out of
// the floor (AshiOidashiColle), never plants them. Held poses therefore hover up to ~4.5cm.
//
// The policy: a downward movement whose FINAL value is below 4.5cm rests on the floor
// instead. Concretely the bake plants sustained quasi-static HOLDS of the foot-bottom curve
// and leaves every moving frame exactly raw, easing in and out across short transitions.
// Holds are what hover visibly (the ending pose floats 3.5cm for nine seconds). Motion,
// upward or downward, keeps its authored trajectory (low footwork excursions reach ~4cm
// inside otherwise-low stretches and must survive). All the temporal logic and the solver
// iteration happen here, offline, where they cannot jitter.
//
// The solve runs per frame but its result goes back onto the keys the animator already
// wrote, with keys added only where those cannot follow it: about twice the authored count,
// against the 18,351 a key-per-frame curve would need.
//
// The bake runs our own classes headless (Skeleton, Animation, GLTF) against
// models/pierretta/pierretta.glb, so the corrected channel values reproduce exactly through
// the solver.
//
// usage: node tools/ground.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { serializeMot1, parseMot1, loadMergedMotion } = require("./mot1");

const ROOT = path.join(__dirname, "..");
const MOTIONS = path.join(ROOT, "motions");

// a hold is a sustained quasi-static stay of the authored foot-bottom
// model below the snap height: locally still (range under the tolerance
// across the sliding window) for at least the minimum duration
const SNAP_HEIGHT = 0.045;
const STATIC_WINDOW_FRAMES = 15;
const STATIC_RANGE = 0.008;
const MINIMUM_HOLD_FRAMES = 240;
const MERGE_GAP_FRAMES = 8;
const TRANSITION_FRAMES = 12;

const SOLVE_TOLERANCE = 0.0002;
const SOLVE_ITERATIONS = 8;

const loadClasses = () => {
  const sources = [
    "glMatrix-mat4.js",
    "Utilities.js",
    "FileParser.js",
    "GLTF.js",
    "Animation.js",
    "BoneMath.js",
    "Rig.js",
    "Skeleton.js",
  ]
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");

  // classic scripts: evaluate in one scope, take the classes from the
  // script's completion value
  return vm.runInThisContext(sources + "\n({ Utilities, GLTF, Animation, Skeleton })");
};

// The costume's real sole, extracted from the shoe mesh at bind: per side
// and per zone along the foot, the corner vertices of the near-bottom
// set (corners in both axes so rolled and pointed feet keep a probe on
// their lowest edge). Ported from a deleted runtime foot pass.
const buildSoleProbes = (gltf) => {
  const { skin } = gltf;
  const shoes = gltf.primitives.find((primitive) => primitive.name.startsWith("shoes"));
  if (!shoes || !skin) throw new Error("no shoes primitive to probe");

  const { position, boneIndices, boneWeights } = shoes.attributeBuffer;
  const isLeftJoint = skin.jointNames.map((name) => /_l_/.test(name));

  const sideVertices = { l: [], r: [] };

  for (let vertex = 0; vertex < position.length / 3; vertex++) {
    let leftWeight = 0;
    let dominantJoint = 0;
    let dominantWeight = 0;

    for (let influence = 0; influence < 4; influence++) {
      const weight = boneWeights[vertex * 4 + influence];
      const joint = boneIndices[vertex * 4 + influence];

      if (isLeftJoint[joint]) leftWeight += weight;

      if (weight > dominantWeight) {
        dominantWeight = weight;
        dominantJoint = joint;
      }
    }

    sideVertices[leftWeight > 0.5 ? "l" : "r"].push({
      point: [position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]],
      jointName: skin.jointNames[dominantJoint],
    });
  }

  const lowest = (values) => values.reduce((low, value) => Math.min(low, value), Infinity);
  const highest = (values) => values.reduce((high, value) => Math.max(high, value), -Infinity);

  const bottomCornersPerZone = (vertices) => {
    const depths = vertices.map((vertex) => vertex.point[2]);
    const nearest = lowest(depths);
    const span = highest(depths) - nearest;

    return [0, 1, 2].flatMap((zone) => {
      const from = nearest + (span * zone) / 3;
      const to = nearest + (span * (zone + 1)) / 3;
      const zoneVertices = vertices.filter(
        (vertex) => vertex.point[2] >= from && vertex.point[2] <= to,
      );

      if (zoneVertices.length === 0) return [];

      const lowestY = lowest(zoneVertices.map((vertex) => vertex.point[1]));
      const nearBottom = zoneVertices.filter((vertex) => vertex.point[1] < lowestY + 0.003);

      const corners = new Set();

      for (const axis of [0, 2]) {
        let low = nearBottom[0];
        let high = nearBottom[0];

        for (const vertex of nearBottom) {
          if (vertex.point[axis] < low.point[axis]) low = vertex;
          if (vertex.point[axis] > high.point[axis]) high = vertex;
        }

        corners.add(low);
        corners.add(high);
      }

      return [...corners];
    });
  };

  return { l: bottomCornersPerZone(sideVertices.l), r: bottomCornersPerZone(sideVertices.r) };
};

// Per-foot measurement setup: the sole probes moved into their driver
// bones' frames, plus the bind-measured excesses that make the game's
// heel and toe-tip terms read the REAL sole height (the heel point sits
// ~1cm below the sole at bind, the toe probe ~2.5cm above the tip).
const buildFeet = (Skeleton, skeleton, skeletonJson, skin, soleProbes) => {
  const boneIndexByName = new Map(skeletonJson.bones.map((bone, index) => [bone.name, index]));

  return ["l", "r"].map((side) => {
    const chain = skeleton.ikChains.find((candidate) => candidate.name === `cl_momo_${side}`);
    const toeBone = boneIndexByName.get(`kl_toe_${side}_wj`);

    const ankleJoint = skin.jointNames.indexOf(`n_asi_${side}_wj_ex`);
    const toeJoint = skin.jointNames.indexOf(`n_toe_${side}_wj_ex`);
    if (!chain || toeBone === undefined || ankleJoint < 0 || toeJoint < 0) {
      throw new Error(`foot rig incomplete for side ${side}`);
    }

    const ankle = skin.inverseBindMatrices.subarray(ankleJoint * 16, ankleJoint * 16 + 16);
    const ankleBindHeight = -(ankle[4] * ankle[12] + ankle[5] * ankle[13] + ankle[6] * ankle[14]);

    const toe = skin.inverseBindMatrices.subarray(toeJoint * 16, toeJoint * 16 + 16);
    const toeProbeBindHeight =
      toe[4] * (0.01 - toe[12]) + toe[5] * (-0.05 - toe[13]) + toe[6] * (0 - toe[14]);

    const probes = soleProbes[side].map(({ point, jointName }) => {
      const joint = skin.jointNames.indexOf(jointName);
      const driverName = Skeleton.MESH_BONE_DRIVERS[jointName] ?? jointName;
      const driver = boneIndexByName.get(driverName);
      if (joint < 0 || driver === undefined) throw new Error(`probe joint ${jointName} unmapped`);

      const m = skin.inverseBindMatrices.subarray(joint * 16, joint * 16 + 16);
      const local = [
        m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12],
        m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13],
        m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14],
      ];

      return { driver, local };
    });

    return {
      side,
      chain,
      toeBone,
      heelHeight: skeletonJson.heelHeight,
      heelExcess: ankleBindHeight - skeletonJson.heelHeight,
      toeExcess: toeProbeBindHeight,
      probes,
    };
  });
};

const measureFoot = (skeleton, foot) => {
  const { worldMatrices } = skeleton;
  const { chain, toeBone, heelHeight, heelExcess, toeExcess, probes } = foot;

  let sole = Infinity;
  for (const { driver, local } of probes) {
    const m = worldMatrices[driver];
    const y = m[1] * local[0] + m[5] * local[1] + m[9] * local[2] + m[13];
    if (y < sole) sole = y;
  }

  const ankle = worldMatrices[chain.nodes[3]];
  const toe = worldMatrices[toeBone];
  const toeTipY = toe[1] * 0.01 - toe[5] * 0.05 + toe[13];

  return { sole, authored: Math.min(ankle[13] - heelHeight - heelExcess, toeTipY - toeExcess) };
};

// The holds to plant: frames where the curve is low AND locally still
// (its range across the sliding window stays under the tolerance), in
// sustained runs with nearby runs merged. Moving frames never qualify,
// so footwork excursions and every upward movement stay raw.
const buildHolds = (authored) => {
  const frameCount = authored.length;
  const isStill = new Uint8Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const from = Math.max(0, frame - STATIC_WINDOW_FRAMES);
    const to = Math.min(frameCount - 1, frame + STATIC_WINDOW_FRAMES);
    let low = Infinity;
    let high = -Infinity;

    for (let neighbor = from; neighbor <= to; neighbor++) {
      if (authored[neighbor] < low) low = authored[neighbor];
      if (authored[neighbor] > high) high = authored[neighbor];
    }

    isStill[frame] = high - low < STATIC_RANGE ? 1 : 0;
  }

  const holds = [];
  let start = -1;

  for (let frame = 0; frame <= frameCount; frame++) {
    const isHolding = frame < frameCount && isStill[frame] && authored[frame] < SNAP_HEIGHT;

    if (isHolding && start < 0) start = frame;

    if (!isHolding && start >= 0) {
      const previous = holds[holds.length - 1];

      if (previous && start - previous.end <= MERGE_GAP_FRAMES) previous.end = frame - 1;
      else holds.push({ start, end: frame - 1 });

      start = -1;
    }
  }

  return holds.filter((hold) => hold.end - hold.start + 1 >= MINIMUM_HOLD_FRAMES);
};

// Per frame, how strongly the foot is pulled to the floor: 1 inside a
// hold, a smoothstep ramp across the transition margin, 0 elsewhere.
const buildHoldWeights = (holds, frameCount) => {
  const weights = new Float32Array(frameCount);

  const smoothstep = (t) => t * t * (3 - 2 * t);

  for (const { start, end } of holds) {
    for (let frame = Math.max(0, start - TRANSITION_FRAMES); frame <= end; frame++) {
      const t = frame >= start ? 1 : (frame - (start - TRANSITION_FRAMES)) / TRANSITION_FRAMES;
      weights[frame] = Math.max(weights[frame], smoothstep(t));
    }

    for (let frame = end; frame <= Math.min(frameCount - 1, end + TRANSITION_FRAMES); frame++) {
      const t = 1 - (frame - end) / TRANSITION_FRAMES;
      weights[frame] = Math.max(weights[frame], smoothstep(t));
    }
  }

  return weights;
};

// How far the fitted curve may sit from the solved heights, in metres. Effectively zero:
// the fit is refined until it reproduces the solve exactly at every frame, and the verify
// then reports the same figures the old separate per-frame file did, untouched frames
// included.
//
// WHAT THAT COSTS, since the number looks extravagant. Loosening to a hundredth of a
// millimetre would save 1.8kB gzipped on the critical path and 152kB across the whole clip,
// and every figure the verify prints would be identical bar one: untouched frames would read
// 0.01mm instead of 0.00mm. Loosening to half a millimetre saves another 6.6kB up front and
// doubles the hold error, which is where it stops being free.
//
// It cannot go tighter than this. The refinement only adds keys at frames that do not
// already carry one, so it stops at a key per frame plus the authored corner pairs.
const FIT_TOLERANCE = 1e-9;

// A runtime track in the shape serializeMot1 wants.
const toWritableTrack = (track) => ({
  boneIndex: track.boneIndex,
  channelAxis: track.channel * 3 + track.axis,
  kind: 3,
  keys: [...track.frames].map((frame, index) => ({
    frame,
    value: track.values[index],
    tangent: track.tangents[index],
  })),
});

// The solved heights expressed as keys rather than one per frame.
//
// The authored keys come first and keep their own tangents, which describe the shape of the
// motion and still fit after the curve is lifted. A frame the fit misses gets a key of its
// own, and the pass repeats until nothing misses: two rounds usually, four at most.
// Duplicated frames are the format's way of writing a corner, so they travel in pairs and
// each half keeps the tangent it was written with.
// A FRAME THE SOLVE NEVER MOVED KEEPS ITS AUTHORED KEY EXACTLY, value and tangent. Only the
// stretches the solve actually lifted are refitted, and keys are only ever added inside
// them. Refitting everywhere would leave the take drifting by the fit tolerance in places
// the grounding has no business touching, which is what the verify's untouched-frame figure
// exists to catch.
const fitKeyframes = (authored, solved, frameCount, Animation) => {
  const isTouched = new Uint8Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    if (Math.abs(solved[frame] - Animation.sampleTrack(authored, frame)) > 1e-9) {
      isTouched[frame] = 1;
    }
  }

  // a key on the shoulder of a lifted run belongs to it, or the cubic leading in still
  // aims at the authored height
  const isInPlay = (frame) =>
    isTouched[frame] ||
    (frame > 0 && isTouched[frame - 1]) ||
    (frame + 1 < frameCount && isTouched[frame + 1]);

  const authoredAt = new Map();

  authored.frames.forEach((frame, index) => {
    if (!authoredAt.has(frame)) authoredAt.set(frame, []);
    authoredAt
      .get(frame)
      .push({ value: authored.values[index], tangent: authored.tangents[index] });
  });

  // THE AUTHORED FRAMES ARE A LIST, NOT A SET. A frame written twice is this format's step
  // discontinuity, the pair carrying the tangent arriving and the tangent leaving, and this
  // track has 1,270 of them. Refining through a Set of frame numbers collapses every pair
  // and flattens every corner in the take.
  const authoredFrames = [...authored.frames];
  const isAuthoredFrame = new Set(authoredFrames);
  const addedFrames = new Set();

  const currentFrames = () =>
    [...authoredFrames, ...addedFrames].sort((first, second) => first - second);

  let frames = currentFrames();

  const buildTrack = () => {
    const taken = new Map();
    const values = [];
    const tangents = [];

    frames.forEach((frame) => {
      const written = authoredAt.get(frame);
      const used = taken.get(frame) ?? 0;
      if (written) taken.set(frame, used + 1);

      const authoredKey = written && used < written.length ? written[used] : null;

      if (authoredKey && !isInPlay(frame)) {
        values.push(authoredKey.value);
        tangents.push(authoredKey.tangent);
        return;
      }

      values.push(solved[frame]);
      tangents.push(authoredKey ? authoredKey.tangent : null);
    });

    tangents.forEach((tangent, index) => {
      if (tangent !== null) return;

      const before = Math.max(index - 1, 0);
      const after = Math.min(index + 1, frames.length - 1);
      const span = frames[after] - frames[before];

      tangents[index] = span === 0 ? 0 : (values[after] - values[before]) / span;
    });

    return {
      frames: Float32Array.from(frames),
      values: Float32Array.from(values),
      tangents: Float32Array.from(tangents),
      cursor: 0,
    };
  };

  const missedFrames = (track) => {
    const missing = [];

    // checked at EVERY frame, not only the lifted ones: an untouched frame with no key of
    // its own sits between a kept key and a moved one, and drifts unless the fit pins it
    for (let frame = 0; frame < frameCount; frame++) {
      if (Math.abs(Animation.sampleTrack(track, frame) - solved[frame]) > FIT_TOLERANCE) {
        missing.push(frame);
      }
    }

    return missing;
  };

  let track = buildTrack();

  for (let round = 0; round < 8; round++) {
    const missing = missedFrames(track);
    if (!missing.length) break;

    for (const frame of missing) {
      if (!isAuthoredFrame.has(frame)) addedFrames.add(frame);
    }

    frames = currentFrames();
    track = buildTrack();
  }

  let worst = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    worst = Math.max(worst, Math.abs(Animation.sampleTrack(track, frame) - solved[frame]));
  }

  return { track, worst };
};

// Put the corrected tracks back into the windowed clip, replacing the ones they match by
// bone and channel. Each window keeps one key past each edge so it can still be sampled to
// its own boundary on its own, which is how the runtime plays them.
const writeTracksIntoChunks = (clipDirectory, replacements) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(clipDirectory, "manifest.json"), "utf8"));

  const { frameRate, frameCount, windowSize, chunks } = manifest;
  let written = 0;

  chunks.forEach((name, windowIndex) => {
    const file = path.join(clipDirectory, name);
    const existing = parseMot1(fs.readFileSync(file));

    const windowStart = windowIndex * windowSize;
    const windowEnd = Math.min(windowStart + windowSize, frameCount);

    const rebuilt = existing.map((track) => {
      const replacement = replacements.find(
        (candidate) =>
          candidate.boneIndex === track.boneIndex && candidate.channelAxis === track.channelAxis,
      );

      const keys = replacement
        ? replacement.keys.filter((key) => key.frame >= windowStart - 1 && key.frame <= windowEnd)
        : track.frames.map((frame, index) => ({
            frame,
            value: track.values[index],
            tangent: track.tangents[index],
          }));

      if (replacement) written++;

      return { boneIndex: track.boneIndex, channelAxis: track.channelAxis, kind: track.kind, keys };
    });

    fs.writeFileSync(file, serializeMot1(rebuilt, frameRate, frameCount));
  });

  return written;
};

const main = async () => {
  const { Utilities, GLTF, Animation, Skeleton } = loadClasses();
  Utilities.loadImage = async () => null;

  const readBuffer = (file) => {
    const buffer = fs.readFileSync(file);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  };

  const gltf = await GLTF.load(readBuffer(path.join(ROOT, "models/pierretta/pierretta.glb")));
  const skeletonJson = JSON.parse(fs.readFileSync(path.join(MOTIONS, "mik_skeleton.json"), "utf8"));
  const baseBuffer = loadMergedMotion(path.join(MOTIONS, "pv_743"));

  const animation = new Animation("pv_743.bin", baseBuffer);
  const frameCount = animation.frameCount;

  // candidate injection: the bake adjusts the leg IK-target height
  // CHANNELS and reruns the real pose loop, so whatever transform sits
  // between channel space and world height is honored by construction
  const boneIndexByName = new Map(skeletonJson.bones.map((bone, index) => [bone.name, index]));
  const trackIndexFor = (side) =>
    animation.tracks.findIndex(
      (track) =>
        track.boneIndex === boneIndexByName.get(`cl_momo_${side}`) &&
        track.channel === Animation.Channels.ikTarget &&
        track.axis === 1,
    );

  const trackIndices = [trackIndexFor("l"), trackIndexFor("r")];
  if (trackIndices.some((index) => index < 0)) throw new Error("leg IK height tracks not found");

  // THE AUTHORED LEG TRACKS ARE THE MASTER, and this is why they exist as a file. The bake
  // writes its result into the clip itself, so by the second run the clip on disk is already
  // grounded and solving from it would ground the grounding. The two tracks it rewrites are
  // kept beside the clip untouched and every run starts from them, the same arrangement the
  // PNG masters have beside the WebP and the lossless audio beside the mp3. The page never
  // asks for this file.
  const masterPath = path.join(MOTIONS, "pv_743-legs-authored.bin");

  if (!fs.existsSync(masterPath)) {
    const authored = trackIndices.map((index) => toWritableTrack(animation.tracks[index]));
    fs.writeFileSync(masterPath, serializeMot1(authored, animation.frameRate, frameCount));
    console.log(`wrote ${path.basename(masterPath)}, the authored leg tracks, on first run`);
  }

  const master = new Animation(masterPath, readBuffer(masterPath));

  for (const index of trackIndices) {
    const restored = master.tracks.find(
      (track) =>
        track.boneIndex === animation.tracks[index].boneIndex &&
        track.channel === animation.tracks[index].channel &&
        track.axis === animation.tracks[index].axis,
    );

    if (!restored)
      throw new Error(`${path.basename(masterPath)} has no track for the ${index} slot`);

    animation.tracks[index] = { ...restored, cursor: 0 };
  }

  const candidates = [null, null];
  const wrapped = {
    tracks: animation.tracks,
    frameRate: animation.frameRate,
    frameCount,
    sample(frame) {
      const values = animation.sample(frame);
      if (candidates[0] !== null) values[trackIndices[0]] = candidates[0];
      if (candidates[1] !== null) values[trackIndices[1]] = candidates[1];
      return values;
    },
  };

  const skeleton = new Skeleton(skeletonJson, wrapped, gltf.skin, gltf.nodes);
  const feet = buildFeet(Skeleton, skeleton, skeletonJson, gltf.skin, buildSoleProbes(gltf));

  // pass 1: the raw authored curve, raw soles and raw channel values
  const rawAuthored = feet.map(() => new Float32Array(frameCount));
  const rawSole = feet.map(() => new Float32Array(frameCount));
  const rawChannel = feet.map(() => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame++) {
    skeleton.pose(wrapped, frame);

    feet.forEach((foot, i) => {
      const { sole, authored } = measureFoot(skeleton, foot);
      rawAuthored[i][frame] = authored;
      rawSole[i][frame] = sole;
      rawChannel[i][frame] = animation.trackValues[trackIndices[i]];
    });
  }

  const holds = feet.map((foot, i) => buildHolds(rawAuthored[i]));
  const weights = feet.map((foot, i) => buildHoldWeights(holds[i], frameCount));

  feet.forEach((foot, i) => {
    const coverage = weights[i].reduce((sum, w) => sum + (w > 0 ? 1 : 0), 0);
    console.log(
      `${foot.side}: ${holds[i].length} holds, ` +
        `${((coverage / frameCount) * 100).toFixed(0)}% of frames affected`,
    );
  });

  // pass 2: solve the corrected channel values. The desired sole blends
  // in sole space from the raw pose (weight 0) to the floor (weight 1);
  // the residual iteration absorbs the channel-to-world mapping.
  const baked = feet.map((foot, i) => Float32Array.from(rawChannel[i]));
  const unconverged = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const isActive = feet.map((foot, i) => weights[i][frame] > 0);
    if (!isActive[0] && !isActive[1]) continue;

    const desired = feet.map((foot, i) =>
      isActive[i] ? rawSole[i][frame] * (1 - weights[i][frame]) : null,
    );

    candidates[0] = isActive[0] ? rawChannel[0][frame] : null;
    candidates[1] = isActive[1] ? rawChannel[1][frame] : null;

    let residuals = [0, 0];

    for (let iteration = 0; iteration < SOLVE_ITERATIONS; iteration++) {
      skeleton.pose(wrapped, frame);

      residuals = feet.map((foot, i) =>
        isActive[i] ? desired[i] - measureFoot(skeleton, foot).sole : 0,
      );
      if (residuals.every((residual) => Math.abs(residual) < SOLVE_TOLERANCE)) break;

      feet.forEach((foot, i) => {
        if (isActive[i]) candidates[i] += residuals[i];
      });
    }

    feet.forEach((foot, i) => {
      if (!isActive[i]) return;
      if (Math.abs(residuals[i]) > 0.002) {
        unconverged.push({ frame, side: foot.side, residual: residuals[i] });
      }
      baked[i][frame] = candidates[i];
    });

    candidates[0] = null;
    candidates[1] = null;
  }

  if (unconverged.length > 0) {
    const worst = unconverged.reduce((a, b) =>
      Math.abs(a.residual) > Math.abs(b.residual) ? a : b,
    );
    console.log(
      `${unconverged.length} frames left over 2mm of residual (reachability), worst ` +
        `${(worst.residual * 1000).toFixed(1)}mm at frame ${worst.frame} (${worst.side})`,
    );
  }

  // The solve ran per frame, but it goes back onto the keys the animator already wrote,
  // with keys added only where those cannot follow it. The result belongs in the clip
  // rather than in a file of its own, so there is nothing to override at runtime.
  const tracks = feet.map((foot, i) => {
    const authored = master.tracks.find(
      (track) =>
        track.boneIndex === boneIndexByName.get(`cl_momo_${foot.side}`) &&
        track.channel === Animation.Channels.ikTarget &&
        track.axis === 1,
    );

    const { track, worst } = fitKeyframes(authored, baked[i], frameCount, Animation);

    console.log(
      `${foot.side}: ${authored.frames.length} authored keys -> ${track.frames.length} written, ` +
        `fit within ${(worst * 1000).toFixed(3)}mm`,
    );

    return {
      boneIndex: boneIndexByName.get(`cl_momo_${foot.side}`),
      channelAxis: Animation.Channels.ikTarget * 3 + 1,
      kind: 3,
      keys: [...track.frames].map((frame, index) => ({
        frame,
        value: track.values[index],
        tangent: track.tangents[index],
      })),
    };
  });

  const replaced = writeTracksIntoChunks(path.join(MOTIONS, "pv_743"), tracks);
  console.log(`wrote the corrected legs into ${replaced} tracks across the clip's windows`);

  // verification: reload the clip from what was just written and sweep the whole song, so
  // this measures the shipped bytes rather than anything still in memory
  const merged = new Animation("pv_743.bin", loadMergedMotion(path.join(MOTIONS, "pv_743")));
  const verifySkeleton = new Skeleton(skeletonJson, merged, gltf.skin, gltf.nodes);

  let minSole = Infinity;
  let below1mm = 0;
  const holdSoles = [];
  let maxUntouchedDelta = 0;
  let maxStep = 0;
  const lastSole = [NaN, NaN];

  for (let frame = 0; frame < frameCount; frame++) {
    verifySkeleton.pose(merged, frame);

    feet.forEach((foot, i) => {
      const { sole } = measureFoot(verifySkeleton, foot);

      if (sole < minSole) minSole = sole;
      if (sole < -0.001) below1mm++;

      if (weights[i][frame] >= 1) holdSoles.push(sole);
      if (weights[i][frame] === 0) {
        maxUntouchedDelta = Math.max(maxUntouchedDelta, Math.abs(sole - rawSole[i][frame]));
      }

      if (!Number.isNaN(lastSole[i]) && weights[i][frame] > 0) {
        maxStep = Math.max(maxStep, Math.abs(sole - lastSole[i]));
      }
      lastSole[i] = sole;
    });
  }

  holdSoles.sort((a, b) => a - b);
  const percentile = (p) => holdSoles[Math.floor((holdSoles.length - 1) * p)];

  const clipBytes = fs
    .readdirSync(path.join(MOTIONS, "pv_743"))
    .filter((name) => name.endsWith(".bin"))
    .reduce((total, name) => total + fs.statSync(path.join(MOTIONS, "pv_743", name)).size, 0);

  console.log(`pv_743: ${(clipBytes / 1024).toFixed(0)} kB across its windows, legs included`);
  console.log(
    `verify: hold soles p50 ${(percentile(0.5) * 1000).toFixed(2)}mm ` +
      `p95 ${(percentile(0.95) * 1000).toFixed(2)}mm max ${(percentile(1) * 1000).toFixed(2)}mm`,
  );
  console.log(
    `verify: min sole ${(minSole * 1000).toFixed(1)}mm, ${below1mm} frames below -1mm, ` +
      `untouched frames differ by at most ${(maxUntouchedDelta * 1000).toFixed(2)}mm`,
  );
  console.log(
    `verify: max per-frame sole step inside affected regions ${(maxStep * 1000).toFixed(1)}mm`,
  );
  console.log(`wrote ${path.relative(ROOT, path.join(MOTIONS, "pv_743"))}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
