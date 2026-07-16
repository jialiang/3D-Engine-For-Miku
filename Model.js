// The toon-shaded character model, built from a loaded glTF.
// Each part draws with three textures: base colour, a 1D toon curve and a specular map.
// Solid parts alpha-cut in the shader so they need no sorting. Eye decals blend on top.
class Model {
  // texture units, matching the sampler uniforms in the static shader
  static baseColorUnit = 0;
  static toonRampUnit = 1;
  static specUnit = 2;

  // Which toon curve and specular map each material uses, keyed by its glb material name.
  // The DIVA ramps cross part boundaries, so this is spelt out rather than derived.
  // Materials missing from the spec map get no highlight.
  static toonRampByMaterial = {
    body_CH_CHARA_SD001Z: "skin00",
    hand_CH_CHARA_SD001Z: "skin00",
    sleeve_CH_CHARA_SD001Z: "red01",
    shoes_CH_CHARA_SD001Z: "red01",
    m07skirt_CH_CHARA_SD001Z: "wribon",
    skirtlace_CH_CHARA_SD001Z: "black01",
    tights_CH_CHARA_SD001Z: "black01_mik001",
    hairfront607_CH_CHARA_SD002Z: "hairfront",
    hairtail607_CH_CHARA_SD002Z: "hairtail",
    m607hoodset_CH_CHARA_SD001Z: "hood",
    face_CH_CHARA_SD001Z1: "face",
    facenose_CH_CHARA_SD001Z: "facenose",
    eye_CH_CHARA_SD001Z: "eye01",
    eye_dropshadow_CH_CHARA_SD001Z: "eye01",
    eyeblow_CH_CHARA_SD001Z: "green",
  };

  static specByMaterial = {
    body_CH_CHARA_SD001Z: "body_s",
    sleeve_CH_CHARA_SD001Z: "sleeve_s",
    shoes_CH_CHARA_SD001Z: "shoes_s",
    m07skirt_CH_CHARA_SD001Z: "skirt_s",
    skirtlace_CH_CHARA_SD001Z: "lace_s",
    tights_CH_CHARA_SD001Z: "tights_s",
    hairfront607_CH_CHARA_SD002Z: "hair_s",
    hairtail607_CH_CHARA_SD002Z: "hairtail_s",
    m607hoodset_CH_CHARA_SD001Z: "hoodset_s",
    face_CH_CHARA_SD001Z1: "face_s",
  };

  // Fetch and build the model from its directory: the glb (geometry plus the base-colour images)
  // and the loose toon and spec PNGs beside it.
  static async load(gl, program, directory) {
    const arraybuffer = await Utilities.fetch(`${directory}/pierretta.glb`, {
      responseType: "arraybuffer",
    });
    const gltf = await GLTF.load(arraybuffer);

    const fetchImagesByName = async (byMaterial, subdirectory) => {
      const names = [...new Set(Object.values(byMaterial))];
      const images = {};

      await Promise.all(
        names.map(async (name) => {
          images[name] = await Utilities.loadImage(`${directory}/${subdirectory}/${name}.png`);
        }),
      );

      return images;
    };

    const [rampImages, specImages] = await Promise.all([
      fetchImagesByName(Model.toonRampByMaterial, "toon"),
      fetchImagesByName(Model.specByMaterial, "spec"),
    ]);

    return new Model(gl, program, gltf, rampImages, specImages);
  }

  constructor(gl, program, gltf, rampImages, specImages) {
    this.gl = gl;

    this.isOverlayLocation = GL.getUniformLocation(program, "u_isOverlay");
    this.hasSpecLocation = GL.getUniformLocation(program, "u_hasSpec");
    this.alphaToCoverageLocation = GL.getUniformLocation(program, "u_alphaToCoverage");

    // a 1x1 stand-in on the spec unit for materials with no map,
    // so the sampler stays valid even though the shader skips it
    const dummySpecTexture = new Texture(gl, null, { width: 1, height: 1 });
    dummySpecTexture.setTextureUnitIndex(Model.specUnit);

    const parts = gltf.primitives.map((primitive) => {
      const vao = new VAO(gl, primitive.attributeBuffer, primitive.indexCount);

      // the lace tiles its texture several times around its ring, so its
      // colour and specular maps must repeat rather than clamp (see Texture)
      const wrap = primitive.name.startsWith("skirtlace") ? gl.REPEAT : gl.CLAMP_TO_EDGE;

      const baseTexture = new Texture(gl, primitive.image, { flipY: false, wrap });
      baseTexture.setTextureUnitIndex(Model.baseColorUnit);

      const rampTexture = new Texture(gl, rampImages[Model.toonRampByMaterial[primitive.name]], {
        flipY: false,
        generateMipmaps: false,
      });
      rampTexture.setTextureUnitIndex(Model.toonRampUnit);

      const specName = Model.specByMaterial[primitive.name];
      let specTexture = dummySpecTexture;

      if (specName) {
        specTexture = new Texture(gl, specImages[specName], { flipY: false, wrap });
        specTexture.setTextureUnitIndex(Model.specUnit);
      }

      return {
        vao,
        baseTexture,
        rampTexture,
        specTexture,
        hasSpec: Boolean(specName),
        indexType: primitive.indexType,
        // Soft decals that blend over the face: the eye pieces and the nose (material "facenose",
        // faint strokes on mostly transparent alpha). Alpha-cutting the nose kept only the
        // strokes' dense cores: two hard bright nostril dots.
        isBlended: /^(eye|facenose)/.test(primitive.name),
        // The skirt lace is fine tulle:
        // drawn opaque with alpha-to-coverage so its net becomes an antialiased, depth-correct cutout.
        // Blending it instead double-layered the ring (grazing ghosting);
        // a hard alpha cut shredded it into broken threads.
        isAlphaToCoverage: primitive.name.startsWith("skirtlace"),
        // The face parts do NOT CAST: drawn into the shadow map they
        // self-shadow (the brow occludes the lower face from the overhead
        // light, greying the mouth and chin). The thin lace does not cast
        // either. Everything else casts and every part receives, so the
        // hair fringe still darkens the forehead.
        castsShadow: !/^(face|eye|skirtlace)/.test(primitive.name),
      };
    });

    // every part's textures share the same three units, so bind the sampler
    // uniforms once through the first part's set
    parts[0].baseTexture.bindTextureUnitToUniform(program, "u_baseColorTexture");
    parts[0].rampTexture.bindTextureUnitToUniform(program, "u_toonRamp");
    dummySpecTexture.bindTextureUnitToUniform(program, "u_specTexture");

    this.solidParts = parts.filter((part) => !part.isBlended);
    this.blendedParts = parts.filter((part) => part.isBlended);

    // the glb is authored in metres (about 1.6 units tall, feet at origin),
    // so scale it up to the roughly 20-unit height the scene is framed for
    this.transform = new Transform();
    this.transform.setTransformation({
      scale: [12.5, 12.5, 12.5],
      rotation: [0, 0, 0],
      isIncremental: false,
    });

    this.modelUbo = new ModelUbo(gl, [program], "Model");
    this.modelUbo.updateModelData(this);
    this.modelUbo.bindUniformBlock();

    // the skinning palette, at bind pose for now: animation will refresh it
    // per frame once the runtime rig lands
    this.boneUbo = new BoneArrayUbo(gl, [program], "Bone");
    this.boneUbo.updateBoneData(Model.buildBindPosePalette(gltf));
    this.boneUbo.bindUniformBlock();
  }

  // One palette entry per skinned joint: jointWorld * inverseBind, walked
  // from the glb node hierarchy. At bind pose the product is identity to
  // within float precision, but computing the real product exercises the
  // exact math the animated pose will use.
  static buildBindPosePalette(gltf) {
    const { nodes, skin } = gltf;

    if (!skin) throw new Error("The glb has no skin: the skinned render path needs one.");

    // the shader's Bone block holds 192 palette slots (see skinned_vertex)
    if (skin.jointNames.length > 192) {
      throw new Error(`Skin has ${skin.jointNames.length} joints, the palette holds 192.`);
    }

    const worldMatrices = new Array(nodes.length).fill(null);
    const localMatrix = mat4.create();

    const resolveWorld = (nodeIndex, parentWorld) => {
      const node = nodes[nodeIndex];
      mat4.fromRotationTranslationScale(localMatrix, node.rotation, node.translation, node.scale);

      const world = mat4.create();
      if (parentWorld) mat4.multiply(world, parentWorld, localMatrix);
      else world.set(localMatrix);

      worldMatrices[nodeIndex] = world;
      for (const child of node.children) resolveWorld(child, world);
    };

    const childNodeIndices = new Set(nodes.flatMap((node) => node.children));
    nodes.forEach((node, index) => {
      if (!childNodeIndices.has(index)) resolveWorld(index, null);
    });

    const palette = new Float32Array(skin.jointNames.length * 16);

    skin.jointNodeIndices.forEach((nodeIndex, joint) => {
      const inverseBind = skin.inverseBindMatrices.subarray(joint * 16, joint * 16 + 16);
      mat4.multiply(
        palette.subarray(joint * 16, joint * 16 + 16),
        worldMatrices[nodeIndex],
        inverseBind,
      );
    });

    return palette;
  }

  drawPart(part) {
    const { gl } = this;

    gl.uniform1f(this.isOverlayLocation, part.isBlended ? 1 : 0);
    gl.uniform1f(this.hasSpecLocation, part.hasSpec ? 1 : 0);
    gl.uniform1f(this.alphaToCoverageLocation, part.isAlphaToCoverage ? 1 : 0);

    part.baseTexture.addToTextureUnit();
    part.rampTexture.addToTextureUnit();
    part.specTexture.addToTextureUnit();

    gl.bindVertexArray(part.vao.vao);
    gl.drawElements(gl.TRIANGLES, part.vao.verticesToDrawCount, part.indexType, 0);
  }

  // Blend is left on at the end for the transparent shadow-catching floor.
  draw({ includeOverlays, isShadowPass = false }) {
    const { gl } = this;

    // Cull back faces in the lit pass.
    // The trim (sleeve cuffs, skirt frills) is modelled as doubled two-sided cards,
    // whose coincident opposite-winding faces z-fight when both draw.
    // Culling keeps one face of each pair, killing the fight.
    // The shadow pass does NOT cull, so every occluder
    // (including a card whose lit-facing side would be culled) still casts.
    if (isShadowPass) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);

    gl.disable(gl.BLEND);

    for (const part of this.solidParts) {
      if (isShadowPass && !part.castsShadow) continue;

      // the lace turns its net alpha into MSAA coverage, but only in the lit pass,
      // the shadow map has no multisampling to convert it
      const useCoverage = part.isAlphaToCoverage && !isShadowPass;

      if (useCoverage) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);

      this.drawPart(part);

      if (useCoverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }

    if (includeOverlays) {
      gl.enable(gl.BLEND);
      gl.depthMask(false);

      for (const part of this.blendedParts) this.drawPart(part);

      gl.depthMask(true);
    }

    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
  }
}
