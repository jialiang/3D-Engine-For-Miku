// The parts every rig here repeats: the body's (Skeleton), the costume chains' (OsageRig)
// and the stage props' (PropRig).
//
// STATICS RATHER THAN A BASE CLASS, deliberately. The three agree on four small routines and
// on almost nothing else: Skeleton also carries IK, the game's procedural bones and the
// mesh-bone drivers, OsageRig hangs off another rig's world matrices and writes into its
// palette, PropRig owns its own. A base class would have to hold all three shapes at once.
class Rig {
  // Every pose loop here is a single forward pass, so a bone's parent must already be posed
  // by the time the loop reaches it.
  //
  // THE INDEX IS CHECKED FOR BEING ONE AT ALL, because `undefined >= index` is false: a bone
  // with no parent field passes an ordering test on its own and fails much later on an
  // undefined world matrix, nowhere near the malformed input that caused it.
  static assertParentsFirst(bones, label) {
    bones.forEach((bone, index) => {
      if (!Number.isInteger(bone.parent)) {
        throw new Error(`${label} ${bone.name} has no parent index.`);
      }

      if (bone.parent >= index) throw new Error(`${label} ${bone.name} precedes its parent.`);
    });
  }

  // The game's own compose order, applied to a flat [bone][xyz] buffer of Euler angles.
  // Skeleton.poseBone documents why it is Z then Y then X.
  static applyEuler(world, rotations, offset) {
    mat4.rotateZ(world, world, rotations[offset + 2]);
    mat4.rotateY(world, world, rotations[offset + 1]);
    mat4.rotateX(world, world, rotations[offset + 0]);
  }

  // One clip value per track into the channel slot that track was resolved to. A null slot
  // is a track this rig does not drive, which Skeleton has and the other two do not.
  static writeTrackValues(trackSlots, values) {
    for (let track = 0; track < trackSlots.length; track++) {
      const slot = trackSlots[track];
      if (slot) slot.buffer[slot.offset] = values[track];
    }
  }

  // What the shader actually reads: the bone's world matrix carried back through the bind
  // pose, written in place into the palette entry for that joint.
  static writePaletteEntry(palette, skin, joint, world) {
    const inverseBind = skin.inverseBindMatrices.subarray(joint * 16, joint * 16 + 16);

    mat4.multiply(palette.subarray(joint * 16, joint * 16 + 16), world, inverseBind);
  }
}
