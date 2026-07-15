// Minimal loader for a binary glTF (.glb): per-primitive positions, normals,
// texture coordinates, triangle indices and each material's base-colour
// image. Skips skinning, animation and metallic-roughness.
class GLTF {
  primitives = [];

  // How many bytes one component of an accessor takes, keyed by the glTF
  // componentType enum (5120 signed byte ... 5126 float).
  static ComponentByteSize = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };

  static ComponentArray = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  };

  static ComponentCount = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  };

  // A .glb is a 12-byte header then a run of chunks,
  // each a 4-byte length, a 4-byte type tag and its payload.
  // The first chunk is the JSON scene, the second is the binary blob every accessor and image points into.
  static parseContainer(arraybuffer) {
    const view = new DataView(arraybuffer);

    const jsonLength = view.getUint32(12, true);
    const jsonText = new TextDecoder().decode(new Uint8Array(arraybuffer, 20, jsonLength));

    // the binary chunk follows the JSON one, past its own 8-byte header
    const binaryHeaderStart = 20 + jsonLength;
    const binaryStart = binaryHeaderStart + 8;
    const binaryLength = view.getUint32(binaryHeaderStart, true);

    return {
      json: JSON.parse(jsonText),
      binary: new Uint8Array(arraybuffer, binaryStart, binaryLength),
    };
  }

  // Takes the fast contiguous path when the data is tightly packed,
  // else walks element by element for an interleaved buffer view (stride wider than one element).
  static readAccessor(json, binary, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const bufferView = json.bufferViews[accessor.bufferView];

    const componentCount = GLTF.ComponentCount[accessor.type];
    const ArrayType = GLTF.ComponentArray[accessor.componentType];
    const elementByteSize = componentCount * GLTF.ComponentByteSize[accessor.componentType];

    const start = binary.byteOffset + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const stride = bufferView.byteStride || elementByteSize;

    const values = new ArrayType(accessor.count * componentCount);

    if (stride === elementByteSize) {
      const source = new ArrayType(binary.buffer, start, accessor.count * componentCount);
      values.set(source);

      return values;
    }

    for (let element = 0; element < accessor.count; element++) {
      const source = new ArrayType(binary.buffer, start + element * stride, componentCount);
      values.set(source, element * componentCount);
    }

    return values;
  }

  static async loadImage(json, binary, imageIndex) {
    const image = json.images[imageIndex];
    const bufferView = json.bufferViews[image.bufferView];

    const start = binary.byteOffset + (bufferView.byteOffset || 0);
    const bytes = new Uint8Array(binary.buffer, start, bufferView.byteLength);

    const blob = new Blob([bytes], { type: image.mimeType });
    const url = URL.createObjectURL(blob);

    try {
      return await Utilities.loadImage(url);
    } catch {
      throw new Error(`Could not decode glTF image ${imageIndex}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  static baseColorImageIndex(json, materialIndex) {
    const material = json.materials[materialIndex];
    const baseColor = material?.pbrMetallicRoughness?.baseColorTexture;

    if (!baseColor) return null;

    return json.textures[baseColor.index].source;
  }

  static async load(arraybuffer) {
    const { json, binary } = GLTF.parseContainer(arraybuffer);
    const model = new GLTF();
    const pendingImages = [];

    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        const attributes = primitive.attributes;
        const material = json.materials[primitive.material];
        const indexAccessor = json.accessors[primitive.indices];

        const entry = {
          name: material?.name ?? mesh.name,
          image: null,

          attributeBuffer: {
            position: GLTF.readAccessor(json, binary, attributes.POSITION),
            normal: GLTF.readAccessor(json, binary, attributes.NORMAL),
            uv: GLTF.readAccessor(json, binary, attributes.TEXCOORD_0),
            index: GLTF.readAccessor(json, binary, primitive.indices),
          },

          indexCount: indexAccessor.count,
          // the glTF componentType enum doubles as the GL element type
          // (5123 UNSIGNED_SHORT, 5125 UNSIGNED_INT), so drawElements can take it as-is
          indexType: indexAccessor.componentType,
        };

        const imageIndex = GLTF.baseColorImageIndex(json, primitive.material);

        if (imageIndex != null) {
          pendingImages.push(
            GLTF.loadImage(json, binary, imageIndex).then((image) => (entry.image = image)),
          );
        }

        model.primitives.push(entry);
      }
    }

    await Promise.all(pendingImages);

    return model;
  }
}
