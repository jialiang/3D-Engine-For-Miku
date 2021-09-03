class PMD extends FileParser {
  // Structure of the PMD file
  static Structure = {
    header: {
      magic: { type: "char", length: 3 }, // property "magic" consists of a string with 3 or less characters
      version: { type: "float" },
      modelName: { type: "char", length: 20 },
      comment: { type: "char", length: 256 },
    },
    vertices: {
      count: { type: "long" },
      // this block of code means:
      // property "array" consists of
      // an array of objects whose structure is defined by the property "structure"
      // whose length is based on the property "count"
      array: {
        length: "count",
        structure: {
          position: { type: "float", length: 3 }, // property "position" consists of an array of 3 floats
          normal: { type: "float", length: 3 },
          uv: { type: "float", length: 2 },
          boneIndices: { type: "short", length: 2 }, // property "boneIndices" consists of an array of 2 shorts
          boneWeight: { type: "integer" },
          edgeFlag: { type: "integer" },
        },
      },
    },
    indices: {
      count: { type: "long" },
      array: { type: "short", length: "count" },
    },
    materials: {
      count: { type: "long" },
      array: {
        length: "count",
        structure: {
          color: { type: "float", length: 4 },
          specularity: { type: "float" },
          specularColor: { type: "float", length: 3 },
          ambientColor: { type: "float", length: 3 },
          toonIndex: { type: "integer" },
          edgeFlag: { type: "integer" },
          vertexCount: { type: "long" },
          filename: { type: "char", length: 20 },
        },
      },
    },
    bones: {
      count: { type: "short" },
      array: {
        length: "count",
        structure: {
          name: { type: "char", length: 20 },
          parentIndex: { type: "short" },
          tailIndex: { type: "short" },
          type: { type: "integer" },
          ikIndex: { type: "short" },
          position: { type: "float", length: 3 },
        },
      },
    },
    iks: {
      count: { type: "short" },
      array: {
        length: "count",
        structure: {
          targetIndex: { type: "short" },
          effectorIndex: { type: "short" },
          chainLength: { type: "integer" },
          iterations: { type: "short" },
          angleLimit: { type: "float" },
          linkIndices: { type: "short", length: "chainLength" },
        },
      },
    },
    morphs: {
      count: { type: "short" },
      array: {
        length: "count",
        structure: {
          name: { type: "char", length: 20 },
          vertexCount: { type: "long" },
          type: { type: "integer" },
          vertices: {
            length: "vertexCount",
            structure: {
              index: { type: "long" },
              position: { type: "float", length: 3 },
            },
          },
        },
      },
    },
    faceDisplayNames: {
      count: { type: "integer" },
      array: { type: "short", length: "count" },
    },
    boneGroupNames: {
      count: { type: "integer" },
      array: {
        length: "count",
        structure: {
          name: { type: "char", length: 50 },
        },
      },
    },
    boneDisplayNames: {
      count: { type: "long" },
      displays: {
        length: "count",
        structure: {
          index: { type: "short" },
          groupIndex: { type: "integer" },
        },
      },
    },
    english: {
      // Stop parsing the rest of the block "english" if
      // the value of "compatibility" = 0
      compatibility: { type: "integer", stopParseIf: 0 },
      modelName: { type: "char", length: 20 },
      comment: { type: "char", length: 256 },
      boneName: {
        array: {
          length: "bones.count",
          structure: {
            name: { type: "char", length: 20 },
          },
        },
      },
      morphName: {
        array: {
          length: "morphs.count-1",
          structure: {
            name: { type: "char", length: 20 },
          },
        },
      },
      boneGroupName: {
        array: {
          length: "boneGroupNames.count",
          structure: {
            name: { type: "char", length: 50 },
          },
        },
      },
    },
    toonTextures: {
      array: {
        length: 10,
        structure: {
          filename: { type: "char", length: 100 },
        },
      },
    },
    rigidBodies: {
      count: { type: "long" },
      array: {
        length: "count",
        structure: {
          name: { type: "char", length: 20 },
          boneIndex: { type: "short" },
          groupIndex: { type: "integer" },
          groupTarget: { type: "short" },
          shapeType: { type: "integer" },
          width: { type: "float" },
          height: { type: "float" },
          depth: { type: "float" },
          position: { type: "float", length: 3 },
          rotation: { type: "float", length: 3 },
          weight: { type: "float" },
          positionDamping: { type: "float" },
          rotationDamping: { type: "float" },
          recoil: { type: "float" },
          friction: { type: "float" },
          type: { type: "integer" },
        },
      },
    },
    joints: {
      count: { type: "long" },
      array: {
        length: "count",
        structure: {
          name: { type: "char", length: 20 },
          rigidBodyIndex_1: { type: "long" },
          rigidBodyIndex_2: { type: "long" },
          position: { type: "float", length: 3 },
          rotation: { type: "float", length: 3 },
          translationLimit_1: { type: "float", length: 3 },
          translationLimit_2: { type: "float", length: 3 },
          rotationLimit_1: { type: "float", length: 3 },
          rotationLimit_2: { type: "float", length: 3 },
          springPosition: { type: "float", length: 3 },
          springRotation: { type: "float", length: 3 },
        },
      },
    },
  };

  dataForAttributeBuffer = {};
  dataForBoneUbo = {};
  dataForMaterialUbo = {};

  numberOfVerticesToDraw = 0;

  materialTextureImages = {
    array: [],
    hash: {},
  };
  toonTextureImages = {
    combined: null,
    array: [],
    hash: {},
  };

  transform = new Transform();
  kinematics;
  physics;

  constructor(url, arrayBuffer) {
    super(url, arrayBuffer, PMD.Structure);

    return (async () => {
      await this.loadImages();

      const {
        parsedData: { bones, morphs, iks, rigidBodies, joints },
      } = this;

      bones.hash = Utilities.createHashtableFromArray(bones.array, "name");
      morphs.hash = Utilities.createHashtableFromArray(morphs.array, "name");

      this.createDataForAttributeBuffer();
      this.createBoneUniformBlockData();
      this.prepareBonesForAnimation();
      this.createMaterialUniformBlockData();

      this.kinematics = new Kinematics(bones.array, iks.array);
      this.physics = new Physics(bones.array, rigidBodies.array, joints.array);

      return this;
    })();
  }

  // load all images needed for textures
  loadImages = async () => {
    const { url, parsedData } = this;
    const textureFolder = url.split("/").slice(0, -1).join("/"); // textures are expected to be at the same folder as .pmd model
    const defaultToonMapFolder = "toons";

    const defaultToonMaps = {
      "toon00.bmp": 1,
      "toon01.bmp": 1,
      "toon02.bmp": 1,
      "toon03.bmp": 1,
      "toon04.bmp": 1,
      "toon05.bmp": 1,
      "toon06.bmp": 1,
      "toon07.bmp": 1,
      "toon08.bmp": 1,
      "toon09.bmp": 1,
      "toon10.bmp": 1,
    };

    const materialFilenames = [];
    const toonFilenames = [];

    // extract unique filenames for images used for diffuse and sphere textures
    parsedData.materials.array.forEach((material) => {
      // diffuse texture and sphere texture filenames are delimited by * for materials
      const filenames = material.filename.split("*");

      // sphere maps not supported for now
      if (filenames.length > 1) filenames.pop();

      filenames.forEach((filename) => {
        const filenameAlreadyIncluded = this.materialTextureImages.hash[filename] != null;

        // multiple material can share same texture and some materials doesn't use textures
        if (!filename || filenameAlreadyIncluded) return;

        materialFilenames.push(filename);
        this.materialTextureImages.hash[filename] = materialFilenames.length - 1;
      });
    });

    // extract unique filenames for images used for toon textures
    parsedData.toonTextures.array.forEach((toonTexture) => {
      const { filename } = toonTexture;
      const filenameAlreadyIncluded = this.toonTextureImages.hash[filename] != null;

      if (!filename || filenameAlreadyIncluded) return;

      toonFilenames.push(filename);
      this.toonTextureImages.hash[filename] = toonFilenames.length - 1;
    });

    const loadImage = (filename) => {
      return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => resolve(image);
        image.onerror = () => reject(`Failed to load image ${filename}`);

        if (defaultToonMaps[filename]) {
          image.src = `${defaultToonMapFolder}/${filename}`;
          return;
        }

        // tga is not supported by browsers and bmp is uncompressed, expected you'll convert them to png
        // sphere maps have .spa and .sph extensions but are actually png images
        image.src = `${textureFolder}/${filename.replace(/tga|bmp/gi, "png")}`;
      });
    };

    const [materialTextureImages, toonTextureImages] = await Promise.all([
      Promise.all(materialFilenames.map(loadImage)),
      Promise.all(toonFilenames.map(loadImage)),
    ]);

    this.materialTextureImages.array = materialTextureImages;
    this.toonTextureImages.array = toonTextureImages;

    // combine toon texture images into 1 image to conserve texture units.
    // all toon textures are the same size which makes them perfect for combining
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    const singleImageWidth = toonTextureImages[0].width;
    const singleImageHeight = toonTextureImages[0].height;

    canvas.width = singleImageWidth;
    canvas.height = singleImageHeight * toonTextureImages.length;

    toonTextureImages.forEach((image, index) => {
      context.drawImage(image, 0, singleImageHeight * index, singleImageWidth, singleImageHeight);
    });

    this.toonTextureImages.combinedImage = context.getImageData(0, 0, canvas.width, canvas.height);
  };

  // Process parsed data to make it suitable for use in creating attribute buffers
  // we also remap the indices to also take material into consideration
  // so that we can draw all materials with a single pass
  createDataForAttributeBuffer = () => {
    const {
      parsedData: { indices, vertices, materials },
    } = this;

    const data = {
      index: [],
      uv: [],
      normal: [],
      morph: [],
      material: [],

      boneWeight: [],
      distanceFromBone_1: [],
      distanceFromBone_2: [],
      boneIndex_1: [],
      boneIndex_2: [],
    };

    const oldIndexToNewIndex = {};

    const uniqueVerticesHashtable = {};
    let totalUniqueVertices = 0;

    let materialIndex = 0;
    let verticesWithCurrentMaterial = 0;

    indices.array.forEach((index) => {
      const vertex = vertices.array[index];
      const { position, normal, uv, boneIndices, boneWeight } = vertex;

      if (verticesWithCurrentMaterial >= materials.array[materialIndex].vertexCount) {
        verticesWithCurrentMaterial = 0;
        materialIndex += 1;
      }

      verticesWithCurrentMaterial += 1;

      const id = [position.join(","), uv.join(","), normal.join(","), materialIndex].join("-");
      const indexForId = uniqueVerticesHashtable[id];

      if (indexForId != null) {
        data.index.push(indexForId);

        if (oldIndexToNewIndex[index] == null) oldIndexToNewIndex[index] = {};
        oldIndexToNewIndex[index][indexForId] = true;

        return;
      }

      data.uv.push(...uv);
      data.normal.push(...normal);
      data.morph.push(0, 0, 0);
      data.material.push(materialIndex);

      data.boneWeight.push(boneWeight / 100);

      const bone_1 = this.parsedData.bones.array[boneIndices[0]];
      const bone_2 = this.parsedData.bones.array[boneIndices[1]];

      data.distanceFromBone_1.push(...Utilities.subtractVecs(position, bone_1.position));
      data.distanceFromBone_2.push(...Utilities.subtractVecs(position, bone_2.position));

      data.boneIndex_1.push(boneIndices[0]);
      data.boneIndex_2.push(boneIndices[1]);

      uniqueVerticesHashtable[id] = totalUniqueVertices;
      data.index.push(totalUniqueVertices);

      if (oldIndexToNewIndex[index] == null) oldIndexToNewIndex[index] = {};
      oldIndexToNewIndex[index][totalUniqueVertices] = true;

      totalUniqueVertices += 1;
    });

    for (const oldIndex in oldIndexToNewIndex) {
      const newIndexArray = [];

      for (const newIndex in oldIndexToNewIndex[oldIndex]) newIndexArray.push(parseInt(newIndex, 10));

      oldIndexToNewIndex[oldIndex] = newIndexArray;
    }

    this.dataForAttributeBuffer = data;
    this.verticesToDrawCount = data.index.length;
    this.oldIndexToNewIndex = oldIndexToNewIndex;
  };

  // Process parsed data to make it suitable for use in creating UBO for Materials
  createMaterialUniformBlockData = () => {
    const { parsedData, materialTextureImages, toonTextureImages } = this;
    const data = {
      diffuseColor: [],
      diffuseTextureIndex: [],
      sphereTextureIndex: [],
      sphereTextureType: [],
      toonTextureIndex: [],
      ambientColor: [],
      specularity: [],
      specularColor: [],
    };

    for (let i = 0; i < 32; i++) {
      const material = parsedData.materials.array[i] || {};

      const {
        ambientColor = [0, 0, 0],
        color = [0, 0, 0, 0],
        filename = "",
        specularColor = [0, 0, 0],
        specularity = 0,
        toonIndex = 255,
      } = material;

      const [diffuseTextureName, sphereTextureName] = filename.split("*");
      const toonTexture = parsedData.toonTextures.array[toonIndex];
      const toonTextureName = toonTexture && toonTexture.filename;

      let diffuseTextureIndex = diffuseTextureName ? materialTextureImages.hash[diffuseTextureName] : null;
      let sphereTextureIndex = sphereTextureName ? materialTextureImages.hash[sphereTextureName] : null;
      let toonTextureIndex = toonTextureName ? toonTextureImages.hash[toonTextureName] : null;

      if (diffuseTextureIndex == null) diffuseTextureIndex = 255;
      if (sphereTextureIndex == null) sphereTextureIndex = 255;
      if (toonTextureIndex == null) toonTextureIndex = 255;

      let sphereTextureType = 255;

      if (sphereTextureName) {
        const sphereTextureFileExtension = sphereTextureName.split(".")[1];

        if (sphereTextureFileExtension === "spa") sphereTextureType = 0;
        if (sphereTextureFileExtension === "sph") sphereTextureType = 1;
      }

      // data in Material UBO is all vec4 to ensure its all tightly packed
      // thus pad with 0

      data.diffuseColor.push(...color);
      data.diffuseTextureIndex.push(diffuseTextureIndex, 0, 0, 0);
      data.sphereTextureIndex.push(sphereTextureIndex, 0, 0, 0);
      data.sphereTextureType.push(sphereTextureType, 0, 0, 0);
      data.toonTextureIndex.push(toonTextureIndex, 0, 0, 0);
      data.ambientColor.push(...ambientColor, 0);
      data.specularity.push(specularity, 0, 0, 0);
      data.specularColor.push(...specularColor, 0);
    }

    this.dataForMaterialUbo = data;
  };

  createBoneUniformBlockData = () => {
    const { parsedData } = this;
    const data = {
      boneTranslation: [],
      boneRotation: [],
    };

    parsedData.bones.array.forEach((bone) => {
      data.boneTranslation.push(...bone.position, 0);
      data.boneRotation.push(0, 0, 0, 1);
    });

    this.dataForBoneUbo = data;
  };

  // Basically populates the distance from parent
  prepareBonesForAnimation = () => {
    const { parsedData } = this;

    parsedData.bones.array.forEach((bone, index) => {
      const { parentIndex } = bone;
      const parentBone = parsedData.bones.array[parentIndex];

      if (!parentBone) return;

      bone.distanceFromParent = Utilities.subtractVecs(bone.position, parentBone.position);
    });
  };

  updateAnimation = (vmd, timeElapsed) => {
    const nextAnimation = vmd.getNextAnimation(timeElapsed);

    this.updateBoneUniformBlockData(nextAnimation.motions, timeElapsed);
    this.updateMorphAttributeBufferData(nextAnimation.weights);
  };

  updateBoneUniformBlockData = (vmdTransforms, timeElapsed) => {
    const { parsedData, kinematics, physics } = this;

    const kinematicTransforms = kinematics.update(vmdTransforms);
    const physicsTransforms = physics.simulateFrame(kinematicTransforms, timeElapsed);

    const boneTranslation = [];
    const boneRotation = [];

    parsedData.bones.array.forEach((bone, index) => {
      const { position = [0, 0, 0], rotation = [0, 0, 0, 1] } = physicsTransforms[index];

      boneTranslation.push(...position, 0);
      boneRotation.push(...rotation);
    });

    this.dataForBoneUbo = {
      boneTranslation,
      boneRotation,
    };
  };

  // PMD is structured in a confusing way for this part
  //
  // There's this base morph that is the first object in the morph array.
  // It has an array "vertices" that contains all vertices that can be morphed
  // "vertices" has the property:
  //     "index" that refers to the "vertex index" and
  //     "position" that refers to the maximum translation all morphs can exert on the vertex
  //
  // The rest of the objects in the morph array also has an array "vertices", but
  //    "index" refers to the index of the "vertices" array in the base morph
  //    "position" refers to the maximum translation that morph can exert on the vertex
  //
  // It is possible for multiple morphs to affect the same vertex

  updateMorphAttributeBufferData = (weights) => {
    const { parsedData, oldIndexToNewIndex, dataForAttributeBuffer } = this;

    const baseMorph = parsedData.morphs.array[0];

    const newMorphData = Array(dataForAttributeBuffer.morph.length).fill(0);

    for (const morphName in weights) {
      const weight = weights[morphName];

      if (weight === 0) continue;

      const { vertices } = parsedData.morphs.hash[morphName];

      vertices.forEach((vertex) => {
        const { index: baseIndex, position } = vertex;

        const weightedPosition = Utilities.multiplyVecByNum(position, weight);
        const oldVertexIndex = baseMorph.vertices[baseIndex].index;

        oldIndexToNewIndex[oldVertexIndex].forEach((newVertexIndex) => {
          const totalPosition = Utilities.sumVecs(newMorphData.getRange(newVertexIndex * 3, 3), weightedPosition);
          newMorphData.replaceRange(newVertexIndex * 3, totalPosition, 3);
        });
      });
    }

    this.dataForAttributeBuffer.morph = newMorphData;
  };
}
