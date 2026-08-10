// Poses a stage prop from its converted scene-animation tracks (the dump
// repo turns the game's a3da placement files into the same MOT1 binary
// the body uses, plus a small node-list skeleton JSON).
//
// The game composes a prop node exactly like a body bone (world = parent *
// T(translation) * Rz * Ry * Rx, see Skeleton.js), but with no rest
// offsets: the channels carry the whole placement and unanimated slots
// stay zero. Scale and visibility never animate in this song's props (the
// converter enforces that), so neither exists here. The palette maps the
// glb's skin joints onto the nodes by name. The glb inverse binds are the
// game's own binds, like the body's.
class PropRig {
  bones = [];
  palette = null;

  constructor(skeletonJson, animation, skin) {
    const { bones } = skeletonJson;
    this.bones = bones;

    Rig.assertParentsFirst(bones, "Node");

    this.rotations = new Float32Array(bones.length * 3);
    this.positions = new Float32Array(bones.length * 3);

    this.trackSlots = animation.tracks.map((track) => {
      const offset = track.boneIndex * 3 + track.axis;

      if (track.channel === Animation.Channels.rotation) return { buffer: this.rotations, offset };
      if (track.channel === Animation.Channels.position) return { buffer: this.positions, offset };

      throw new Error(`A prop track drives unsupported channel ${track.channel}.`);
    });

    this.worldMatrices = bones.map(() => mat4.create());

    const boneIndexByName = new Map(bones.map((bone, index) => [bone.name, index]));

    this.skin = skin;
    this.palette = new Float32Array(skin.jointNames.length * 16);

    this.jointBones = skin.jointNames.map((name) => {
      const bone = boneIndexByName.get(name);
      if (bone === undefined) throw new Error(`Skin joint ${name} matches no prop node.`);

      return bone;
    });
  }

  pose(animation, frame) {
    const { trackSlots, bones, rotations, positions, worldMatrices } = this;

    Rig.writeTrackValues(trackSlots, animation.sample(frame));

    for (let bone = 0; bone < bones.length; bone++) {
      const world = worldMatrices[bone];
      const parent = bones[bone].parent;
      const offset = bone * 3;

      if (parent < 0) mat4.identity(world);
      else world.set(worldMatrices[parent]);

      mat4.translate(world, world, positions.subarray(offset, offset + 3));
      Rig.applyEuler(world, rotations, offset);
    }

    const { skin, palette, jointBones } = this;

    for (let joint = 0; joint < jointBones.length; joint++) {
      Rig.writePaletteEntry(palette, skin, joint, worldMatrices[jointBones[joint]]);
    }

    return palette;
  }
}
