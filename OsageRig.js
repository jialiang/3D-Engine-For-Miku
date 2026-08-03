// The costume's swinging parts (skirt panels, hair tails) as a small rig
// hanging off the body's, posed from a clip that records how they moved: the
// game's own precomputed bake for the parts it ships one for and our offline
// simulation for the rest.
//
// They are their own rig rather than bones of the body's because the body rig
// is a faithful conversion of the game's own skeleton table, which knows
// nothing about them. A chain root names the body bone it hangs off (`mount`)
// and carries its rest transform there. A deeper joint hangs off the joint
// before it with only an offset. The clip's rotation channels are the whole
// swing, composed on top of the rest orientation:
//
//   world = mount * T(position) * Rz Ry Rx (rest) * Rz Ry Rx (channels)
//
// That is the body rig's own compose order (see Skeleton.js) plus one term it
// has no need for: body bones rest at identity and let the motion carry the
// whole orientation, while a chain's rest orientation is where the part points
// before anything swings.
//
// One skin, one palette, two rigs: the joints these bones drive stop being
// rigid attachments on the body rig (Skeleton.addOsageRig hands them over) and
// this writes their entries into the body's own palette.
class OsageRig {
  bones = [];

  constructor(skeletonJson, animation, skeleton) {
    const { bones } = skeletonJson;
    this.bones = bones;
    this.animation = animation;
    this.skeleton = skeleton;

    // the pose loop is a single forward pass, so a joint's parent has to be
    // posed by the time we reach it
    bones.forEach((bone, index) => {
      if (bone.parent >= index) throw new Error(`Chain bone ${bone.name} precedes its parent.`);
    });

    this.rotations = new Float32Array(bones.length * 3);

    // rest offsets never animate, so the only channels are rotations and
    // each track writes one slot
    this.trackSlots = animation.tracks.map((track) => {
      if (track.channel !== Animation.Channels.rotation) {
        throw new Error(`A chain track drives unsupported channel ${track.channel}.`);
      }

      return track.boneIndex * 3 + track.axis;
    });

    this.worldMatrices = bones.map(() => mat4.create());

    const boneIndexByName = new Map(skeleton.bones.map((bone, index) => [bone.name, index]));

    this.mountBones = bones.map((bone) => {
      if (!bone.mount) return -1;

      const mount = boneIndexByName.get(bone.mount);
      if (mount === undefined) {
        throw new Error(`Chain bone ${bone.name} hangs off unknown body bone ${bone.mount}.`);
      }

      return mount;
    });

    this.joints = bones.map((bone) => {
      const joint = skeleton.skin.jointNames.indexOf(bone.name);
      if (joint < 0) throw new Error(`Chain bone ${bone.name} matches no skin joint.`);

      return joint;
    });
  }

  pose(frame) {
    const values = this.animation.sample(frame);
    const { bones, rotations, trackSlots, worldMatrices, mountBones, joints } = this;

    for (let track = 0; track < trackSlots.length; track++) {
      rotations[trackSlots[track]] = values[track];
    }

    const { worldMatrices: bodyMatrices, skin, palette } = this.skeleton;

    for (let index = 0; index < bones.length; index++) {
      const bone = bones[index];
      const world = worldMatrices[index];
      const mount = mountBones[index];
      const offset = index * 3;

      // A chain bone hangs off a body bone (its mount) or off the chain bone
      // before it. A root with neither is malformed rather than world-space:
      // a parent index of -1 reads as undefined and throws inside mat4
      // instead of naming what is wrong.
      if (mount >= 0) world.set(bodyMatrices[mount]);
      else if (bone.parent >= 0) world.set(worldMatrices[bone.parent]);
      else throw new Error(`Chain bone ${bone.name} has neither a mount nor a parent.`);

      mat4.translate(world, world, bone.position);

      if (bone.rotation) {
        mat4.rotateZ(world, world, bone.rotation[2]);
        mat4.rotateY(world, world, bone.rotation[1]);
        mat4.rotateX(world, world, bone.rotation[0]);
      }

      mat4.rotateZ(world, world, rotations[offset + 2]);
      mat4.rotateY(world, world, rotations[offset + 1]);
      mat4.rotateX(world, world, rotations[offset + 0]);

      const joint = joints[index];
      const inverseBind = skin.inverseBindMatrices.subarray(joint * 16, joint * 16 + 16);

      mat4.multiply(palette.subarray(joint * 16, joint * 16 + 16), world, inverseBind);
    }
  }
}
