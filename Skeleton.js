// The runtime control rig: the game skeleton (motions/mik_skeleton.json)
// posed each frame by an Animation, producing the skinning palette for the
// glb's joints.
//
// Evaluation follows ReDIVA's rob code (the game's own logic):
// - a bone's world matrix = parentWorld * T(position) * R(rotation), where
//   the Euler channels compose as Rz * Ry * Rx in column-vector terms
//   (the game rotates a point about X first, then Y, then Z)
// - rest orientations are IDENTITY: the motion channels carry the whole
//   orientation and the skeleton's rest data only supplies translations
// - gblctr (position) and kg_ya_ex (rotation) form a global pre-root
//   transform applied to every root bone
//
// The IK chains (head/chest single-segment, arm/leg two-segment) run the
// game's solve: aim the chain root's +X at the target, then a law-of-
// cosines bend written as paired Z rotations, segments translated along
// +X (bones point down their own X axis). Chain topology comes from the
// hierarchy: node0 = the IK control bone, then its j_/e_ descendants;
// e_*_cp bones are end-effector markers whose children carry rest offsets
// measured from the marker's parent (so they get rest minus parent rest).
//
// NOT evaluated yet (the constraint phase): the up-vector (pole) roll of
// the arm chains, the twist/aim helpers and the expression bones, and the
// model-space position semantics of type-1 bones (this skeleton has none).
//
// Palette rule: a glb joint that IS a motion bone takes world * inverseBind.
// A joint that is not (the physics set: hair, skirt, ribbons, breast) is
// rigidly attached to its nearest animated ancestor and a rigid
// attachment's palette entry collapses to a copy of that ancestor's entry
// (world * relativeBind * inverseBind = ancestorWorld * ancestorInverseBind).
class Skeleton {
  bones = [];
  palette = null;

  constructor(skeletonJson, animation, skin, nodes) {
    const { bones } = skeletonJson;
    this.bones = bones;

    const boneIndexByName = new Map(bones.map((bone, index) => [bone.name, index]));

    // the evaluation loop assumes parents come first (game table order)
    bones.forEach((bone, index) => {
      if (bone.parent >= index) throw new Error(`Bone ${bone.name} comes before its parent.`);
    });

    this.globalPositionBone = boneIndexByName.get("gblctr");
    this.globalRotationBone = boneIndexByName.get("kg_ya_ex");

    // channel slots the animation tracks write into. Positions start at the
    // rest offsets and animated slots overwrite theirs every frame
    this.rotations = new Float32Array(bones.length * 3);
    this.positions = new Float32Array(bones.length * 3);

    bones.forEach((bone, index) => {
      if (bone.position) this.positions.set(bone.position, index * 3);
    });

    this.ikTargets = new Float32Array(bones.length * 3);

    this.trackSlots = animation.tracks.map((track) => {
      const offset = track.boneIndex * 3 + track.axis;

      if (track.channel === Animation.Channels.rotation) return { buffer: this.rotations, offset };
      if (track.channel === Animation.Channels.position) return { buffer: this.positions, offset };
      return { buffer: this.ikTargets, offset };
    });

    // IK chains: node0 = the control bone, then the j_/e_ descendants.
    // The chain root translates by node1's rest (the control bone has no
    // rest of its own), node1 sits at the root, the later nodes at segment
    // lengths along +X. isWrittenByIk marks nodes the solver owns.
    this.isWrittenByIk = new Uint8Array(bones.length);

    const firstChainChild = (index) => {
      const child = bones.findIndex((bone) => bone.parent === index && /^[je]_/.test(bone.name));
      return child < 0 ? null : child;
    };

    this.ikChains = bones.flatMap((bone, index) => {
      if (!bone.control || !bone.control.type.includes("Ik")) return [];

      const nodes = [index];
      for (let cursor = index; nodes.length < 4;) {
        const child = firstChainChild(cursor);
        if (child === null) break;
        nodes.push(child);
        cursor = child;
      }

      for (const node of nodes.slice(1)) this.isWrittenByIk[node] = 1;

      const segmentLength = (node) => Math.hypot(...bones[node].position);
      return [
        {
          nodes,
          isReverse: bone.control.type === "legIkRotation",
          rootOffset: bones[nodes[1]].position,
          lengths: nodes.slice(2).map(segmentLength),
        },
      ];
    });

    // children of an e_*_cp effector carry rest offsets measured from the
    // effector's parent. Make them effector-relative so plain FK works
    this.fkTranslations = bones.map((bone, index) => {
      const rest = this.positions.subarray(index * 3, index * 3 + 3);
      const parent = bone.parent >= 0 ? bones[bone.parent] : null;

      if (!parent || !/^e_.*_cp$/.test(parent.name) || !bone.position || !parent.position) {
        return rest;
      }

      return Float32Array.from(
        [0, 1, 2].map((axis) => bone.position[axis] - parent.position[axis]),
      );
    });

    // the chain root carries node1's rest offset (see the header comment)
    for (const chain of this.ikChains) this.fkTranslations[chain.nodes[0]] = chain.rootOffset;

    this.worldMatrices = bones.map(() => mat4.create());
    this.globalMatrix = mat4.create();
    this.scratchMatrix = mat4.create();
    this.scratchVector = new Float32Array(3);

    // glb joints: their inverse binds and either their own motion bone or
    // the joint whose palette entry they copy (rigid attachment)
    this.skin = skin;
    this.palette = new Float32Array(skin.jointNames.length * 16);

    const parentByNode = new Map();
    nodes.forEach((node, index) =>
      node.children.forEach((child) => parentByNode.set(child, index)),
    );
    const jointByNode = new Map(skin.jointNodeIndices.map((node, joint) => [node, joint]));

    this.jointMotionBones = skin.jointNames.map((name) => boneIndexByName.get(name) ?? -1);

    this.jointPaletteSources = skin.jointNames.map((name, joint) => {
      if (this.jointMotionBones[joint] >= 0) return -1;

      let node = skin.jointNodeIndices[joint];

      while (parentByNode.has(node)) {
        node = parentByNode.get(node);
        const ancestorJoint = jointByNode.get(node);
        if (ancestorJoint !== undefined && this.jointMotionBones[ancestorJoint] >= 0) {
          return ancestorJoint;
        }
      }

      throw new Error(`Joint ${name} has no animated ancestor to attach to.`);
    });
  }

  // append rotations given as sine/cosine pairs onto a column-major matrix
  // (the solver works in sine/cosine directly, as the game does)
  static rotateZSinCos(matrix, sin, cos) {
    for (let i = 0; i < 4; i++) {
      const a = matrix[i];
      const b = matrix[4 + i];
      matrix[i] = a * cos + b * sin;
      matrix[4 + i] = b * cos - a * sin;
    }
  }

  static rotateYSinCos(matrix, sin, cos) {
    for (let i = 0; i < 4; i++) {
      const a = matrix[i];
      const b = matrix[8 + i];
      matrix[i] = a * cos - b * sin;
      matrix[8 + i] = a * sin + b * cos;
    }
  }

  static translateX(matrix, x) {
    matrix[12] += matrix[0] * x;
    matrix[13] += matrix[1] * x;
    matrix[14] += matrix[2] * x;
  }

  // rigid inverse: rotate the offset from the matrix's translation back
  // through the transposed rotation
  static inverseTransformPoint(matrix, point, out) {
    const x = point[0] - matrix[12];
    const y = point[1] - matrix[13];
    const z = point[2] - matrix[14];
    out[0] = matrix[0] * x + matrix[1] * y + matrix[2] * z;
    out[1] = matrix[4] * x + matrix[5] * y + matrix[6] * z;
    out[2] = matrix[8] * x + matrix[9] * y + matrix[10] * z;
  }

  // The game's solve (ReDIVA RobBlock::solve_ik): aim the chain root's +X
  // axis at the target, then bend with the law of cosines as paired Z
  // rotations, translating each segment along +X. The root's stored world
  // stays unaimed (its non-chain children hang off the unaimed frame).
  solveIkChain(chain) {
    const { worldMatrices, ikTargets, globalMatrix, scratchMatrix, scratchVector } = this;
    const [root, node1, node2, node3] = chain.nodes;

    // the target channel is model-space, carried through the global transform
    const offset = root * 3;
    const x = ikTargets[offset];
    const y = ikTargets[offset + 1];
    const z = ikTargets[offset + 2];
    const targetX =
      globalMatrix[0] * x + globalMatrix[4] * y + globalMatrix[8] * z + globalMatrix[12];
    const targetY =
      globalMatrix[1] * x + globalMatrix[5] * y + globalMatrix[9] * z + globalMatrix[13];
    const targetZ =
      globalMatrix[2] * x + globalMatrix[6] * y + globalMatrix[10] * z + globalMatrix[14];

    scratchMatrix.set(worldMatrices[root]);
    Skeleton.inverseTransformPoint(scratchMatrix, [targetX, targetY, targetZ], scratchVector);

    const lengthXY = Math.hypot(scratchVector[0], scratchVector[1]);
    const length = Math.hypot(scratchVector[0], scratchVector[1], scratchVector[2]);

    if (lengthXY > 1e-6 && length > 1e-6) {
      Skeleton.rotateZSinCos(
        scratchMatrix,
        scratchVector[1] / lengthXY,
        scratchVector[0] / lengthXY,
      );
      Skeleton.rotateYSinCos(scratchMatrix, -scratchVector[2] / length, lengthXY / length);
    }

    const world1 = worldMatrices[node1];
    world1.set(scratchMatrix);

    if (chain.nodes.length === 3) {
      const world2 = worldMatrices[node2];
      world2.set(world1);
      Skeleton.translateX(world2, chain.lengths[0]);
      return;
    }

    const [length0, length1] = chain.lengths;
    let sin0 = 0;
    let cos0 = 1;
    let sin1 = 0;
    let cos1 = -1;

    if (length > 1e-6) {
      const projected = (length * length - length1 * length1) / length0;
      cos0 = Utilities.clamp((projected + length0) / (2 * length), -1, 1);
      cos1 = Utilities.clamp((projected - length0) / (2 * length1), -1, 1);
      sin0 = Math.sqrt(1 - cos0 * cos0);
      sin1 = Math.sqrt(1 - cos1 * cos1);

      // the reverse flag flips the bend: knees fold the other way to elbows
      if (chain.isReverse) sin0 = -sin0;
      else sin1 = -sin1;
    }

    Skeleton.rotateZSinCos(world1, sin0, cos0);

    const world2 = worldMatrices[node2];
    world2.set(world1);
    Skeleton.translateX(world2, length0);
    Skeleton.rotateZSinCos(world2, sin1, cos1);

    const world3 = worldMatrices[node3];
    world3.set(world2);
    Skeleton.translateX(world3, length1);
  }

  pose(animation, frame) {
    const values = animation.sample(frame);
    const { trackSlots, bones, rotations, positions, worldMatrices, globalMatrix } = this;

    for (let track = 0; track < trackSlots.length; track++) {
      const slot = trackSlots[track];
      if (slot) slot.buffer[slot.offset] = values[track];
    }

    // global pre-root transform: translate by gblctr, rotate by kg_ya_ex
    const globalPosition = this.globalPositionBone * 3;
    const globalRotation = this.globalRotationBone * 3;

    mat4.identity(globalMatrix);
    mat4.translate(
      globalMatrix,
      globalMatrix,
      positions.subarray(globalPosition, globalPosition + 3),
    );
    mat4.rotateZ(globalMatrix, globalMatrix, rotations[globalRotation + 2]);
    mat4.rotateY(globalMatrix, globalMatrix, rotations[globalRotation + 1]);
    mat4.rotateX(globalMatrix, globalMatrix, rotations[globalRotation + 0]);

    let nextChain = 0;

    for (let bone = 0; bone < bones.length; bone++) {
      if (bone === this.globalPositionBone || bone === this.globalRotationBone) continue;
      if (this.isWrittenByIk[bone]) continue;

      const world = worldMatrices[bone];
      const parent = bones[bone].parent;
      const offset = bone * 3;

      world.set(parent < 0 ? globalMatrix : worldMatrices[parent]);
      mat4.translate(world, world, this.fkTranslations[bone]);
      mat4.rotateZ(world, world, rotations[offset + 2]);
      mat4.rotateY(world, world, rotations[offset + 1]);
      mat4.rotateX(world, world, rotations[offset + 0]);

      if (nextChain < this.ikChains.length && this.ikChains[nextChain].nodes[0] === bone) {
        this.solveIkChain(this.ikChains[nextChain]);
        nextChain++;
      }
    }

    const { skin, palette, jointMotionBones, jointPaletteSources } = this;

    for (let joint = 0; joint < jointMotionBones.length; joint++) {
      if (jointMotionBones[joint] < 0) continue;

      const inverseBind = skin.inverseBindMatrices.subarray(joint * 16, joint * 16 + 16);
      const entry = palette.subarray(joint * 16, joint * 16 + 16);
      mat4.multiply(entry, worldMatrices[jointMotionBones[joint]], inverseBind);
    }

    for (let joint = 0; joint < jointPaletteSources.length; joint++) {
      const source = jointPaletteSources[joint];
      if (source < 0) continue;

      palette.copyWithin(joint * 16, source * 16, source * 16 + 16);
    }

    return palette;
  }
}
