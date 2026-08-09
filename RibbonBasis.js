// The hood ribbons' baked cloth, as a set of vertex modes and a weight per mode per frame.
//
// The ribbons are two 26 cm streamers the game drives with its runtime osage solver, which
// this engine does not implement. Rather than solve them live, the swing was simulated
// offline as Jolt cloth over the whole take and compressed to 24 modes. This replays it.
//
// THE FORMULA, which is why the pieces are shaped the way they are:
//
//   position = jointMatrix(j_kao_wj) * (rest + mean + sum over i of weight[frame][i] * basis[vertex][i])
//
// The mean is not optional. A principal component basis describes deviation FROM the mean,
// so leaving it out replays the drape's variation about an average pose the vertex never
// returns to.
//
// The ribbon's vertices are bound to the head alone at weight 1 (tools/rebind-ribbon.js),
// so `jointMatrix` above is just their ordinary skinning: the displacement is added in bind
// space before skinning and the existing palette carries it to world.
//
// ONE TEXTURE, 28 COLUMNS WIDE, so the shader needs one sampler and one fetch pattern rather
// than several of each. The four fixed columns come first and the modes follow, which keeps
// every fixed column at a constant index while only the mode loop depends on the count:
//
//   0        the bind position, which a vertex only needs for its NEIGHBOURS
//   1 and 2  the normal stencil, six vertex ids
//   3        the mean
//   4 on     the modes
//
// Rows are vertex ids of the WHOLE hood primitive, most of them zero: the ribbon could not be
// split into its own primitive because 62 of the hood's triangles straddle the boundary, so
// the basis is padded rather than the mesh cut. See .ignored/plan.md.
//
// NORMALS ARE DERIVED FROM THE POSITIONS, not shipped. Columns 1 and 2 name three triangles
// each ribbon vertex is a corner of. The shader crosses their edges before and after the
// cloth moves and carries the rotation between the two onto the authored normal. Deforming
// them at all matters more than it looks: a bind normal rotates with the head while the
// cloth swings away from it, which measured 24.04 degrees of error at the median against
// 5.28 for this. A basis of their own cannot ship at any price, needing k=47 for 6 degrees
// against a shader cap of 24.
//
// Both figures are quoted here only and want updating after a re-bake.
//
// TANGENTS ARE DERIVED HERE, NOT SHIPPED. Animation.sampleTrack is a cubic Hermite and
// wants a tangent per key, but with a key on every frame they are just a central difference
// of the values, so shipping them would double the largest file to store what is already
// present.
class RibbonBasis {
  static basisUnit = 3;

  // Must match the loop bound in shaders/skinned_vertex.glsl, which cannot be dynamic.
  //
  // 16 WAS NOT ENOUGH and the reason is geometric rather than a matter of taste. A linear
  // basis represents a swinging strip as displacements about a mean and the mean of an arc
  // is a shrunken arc, so the modes have to put the length back. Measured on the drawn mesh
  // (.ignored/probe-drawn-shape.js), the tip of the strip came out at 67% of its authored
  // width at 16 modes while the simulated sheet held a perfect 100%: the strip read visibly
  // thin. 24 restores it to 93%, 32 to 95% and 48 to 98%, so this sits at the knee.
  static maxModes = 24;

  // The fixed columns ahead of the modes and the triangles the normal stencil names. Both
  // are spelled out again in shaders/skinned_vertex.glsl and have to agree with it.
  static firstMode = 4;
  static fans = 3;

  gl;
  texture;
  modes;
  tracks;
  weights;

  // FNV-1a over the bytes of the bind positions, matching what the bake writes into the
  // manifest. It is the only check that the basis belongs to this mesh at all: every other
  // invariant here is a length and lengths survive a reorder that invalidates every row.
  static hashOf(positions) {
    const bytes = new Uint8Array(Float32Array.from(positions).buffer);
    let hash = 0x811c9dc5;

    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, "0");
  }

  static async load(gl, program, directory, bindPositions) {
    const manifest = await Utilities.fetch(`${directory}/ribbon-basis.json`, {
      responseType: "json",
    });

    const keys = ["positionBasis", "positionMean", "positionWeights", "positionRest", "normalFans"];

    const buffers = await Promise.all(
      keys.map((key) =>
        Utilities.fetch(`${directory}/${manifest.files[key].file}`, {
          responseType: "arraybuffer",
        }),
      ),
    );

    // EVERY BLOB SHIPS AS INT16 with its own scale (see the manifest's quantisation note),
    // which halves the set for 0.045mm of position at worst. Decoded here rather than
    // deeper in: past this point nothing needs to know how the bytes arrived.
    const [basis, mean, weights, rest, fans] = keys.map((key, index) => {
      const { scale } = manifest.files[key];
      const stored = new Int16Array(buffers[index]);
      const values = new Float32Array(stored.length);

      for (let index = 0; index < stored.length; index++) values[index] = stored[index] * scale;

      return values;
    });

    return new RibbonBasis(gl, program, manifest, bindPositions, {
      basis,
      mean,
      weights,
      rest,
      fans,
    });
  }

  constructor(gl, program, manifest, bindPositions, data) {
    const { modes, frames, primitiveVertices } = manifest;

    if (!bindPositions) throw new Error("no bind positions to check the ribbon basis against.");

    if (bindPositions.length !== primitiveVertices * 3) {
      throw new Error(
        `the basis was baked for ${primitiveVertices} vertices, ` +
          `the mesh has ${bindPositions.length / 3}.`,
      );
    }

    const hash = RibbonBasis.hashOf(bindPositions);

    if (hash !== manifest.bindPositionHash) {
      throw new Error(
        `the basis was baked against a different mesh (${manifest.bindPositionHash} against ` +
          `${hash}): re-run the bake, or its rows no longer line up with gl_VertexID.`,
      );
    }

    if (modes > RibbonBasis.maxModes) {
      throw new Error(
        `the basis has ${modes} modes but the shader unrolls ${RibbonBasis.maxModes}.`,
      );
    }

    if (manifest.normalFanCount !== RibbonBasis.fans) {
      throw new Error(
        `the stencil holds ${manifest.normalFanCount} faces but the shader crosses ` +
          `${RibbonBasis.fans}.`,
      );
    }

    const expected = {
      basis: primitiveVertices * modes * 3,
      mean: primitiveVertices * 3,
      weights: frames * modes,
      rest: primitiveVertices * 3,
      fans: primitiveVertices * RibbonBasis.fans * 2,
    };

    for (const [name, length] of Object.entries(expected)) {
      if (data[name].length === length) continue;
      throw new Error(`ribbon ${name} holds ${data[name].length} floats, expected ${length}.`);
    }

    const columns = RibbonBasis.firstMode + modes;
    const packed = new Float32Array(primitiveVertices * columns * 3);

    for (let vertex = 0; vertex < primitiveVertices; vertex++) {
      const row = vertex * columns * 3;

      for (let axis = 0; axis < 3; axis++) {
        packed[row + axis] = data.rest[vertex * 3 + axis];
        packed[row + 9 + axis] = data.mean[vertex * 3 + axis];

        for (let mode = 0; mode < modes; mode++) {
          packed[row + (RibbonBasis.firstMode + mode) * 3 + axis] =
            data.basis[(vertex * modes + mode) * 3 + axis];
        }
      }

      // Columns 1 and 2 are six consecutive floats, so the stencil copies straight across.
      for (let slot = 0; slot < RibbonBasis.fans * 2; slot++) {
        packed[row + 3 + slot] = data.fans[vertex * RibbonBasis.fans * 2 + slot];
      }
    }

    this.gl = gl;
    this.modes = modes;
    this.weights = new Float32Array(modes);

    this.texture = new Texture(gl, null, {
      floatData: packed,
      width: columns,
      height: primitiveVertices,
      generateMipmaps: false,
    });

    this.texture.setTextureUnitIndex(RibbonBasis.basisUnit);
    this.texture.bindTextureUnitToUniform(program, "u_ribbonBasis");

    this.modesLocation = GL.getUniformLocation(program, "u_ribbonModes");
    this.weightsLocation = GL.getUniformLocation(program, "u_ribbonWeights");

    // One scalar curve per mode, in the shape Animation.sampleTrack destructures, with the
    // tangents it needs derived from the values either side.
    const frameNumbers = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) frameNumbers[frame] = frame;

    this.tracks = Array.from({ length: modes }, (unused, mode) => {
      const values = new Float32Array(frames);
      const tangents = new Float32Array(frames);

      for (let frame = 0; frame < frames; frame++)
        values[frame] = data.weights[frame * modes + mode];

      for (let frame = 0; frame < frames; frame++) {
        const before = Math.max(frame - 1, 0);
        const after = Math.min(frame + 1, frames - 1);
        const span = after - before;

        tangents[frame] = span > 0 ? (values[after] - values[before]) / span : 0;
      }

      return { frames: frameNumbers, values, tangents, cursor: 0 };
    });
  }

  // Sample every mode's weight for this frame. CPU only, deliberately: a uniform belongs to
  // the program that is currently bound and this is called from the posing step where none
  // is. Uploading here raised GL_INVALID_OPERATION every frame. The upload happens in
  // setActive instead, which runs inside the draw.
  update(frame) {
    const { tracks, weights } = this;

    tracks.forEach((track, mode) => {
      weights[mode] = Animation.sampleTrack(track, frame);
    });
  }

  // The basis applies to one primitive and must be switched off for every other, or their
  // vertex ids would index rows belonging to the hood. Called per part, with the model's
  // program bound, which is also the only safe moment to hand over the weights.
  setActive(isActive) {
    const { gl } = this;

    gl.uniform1f(this.modesLocation, isActive ? this.modes : 0);
    if (!isActive) return;

    gl.uniform1fv(this.weightsLocation, this.weights);
    this.texture.addToTextureUnit();
  }
}
