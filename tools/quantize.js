// Narrow the glb's vertex attributes to the smallest type that still carries
// them, then rewrite the file. Blender's exporter writes every attribute as
// 32-bit float, which is far more than some of them need:
//
//   WEIGHTS_0  float -> unsigned byte, normalized (16 bytes/vertex -> 4)
//
// Skin weights live in 0..1 and only ever get blended four at a time, so a
// byte's 1/255 steps are finer than the shading can show. glTF allows this
// natively (WEIGHTS_0 may be float, unsigned byte or unsigned short, the
// integer forms normalized), so the output stays a conformant glb and no
// extension is needed. The GPU scales the bytes back to 0..1 on the way in,
// which is why the shader is untouched: see VAO's canQuantize.
//
// Running this twice is a no-op past the first pass: an accessor already
// stored as bytes is left alone and the repack reproduces the same bytes.
//
// Quantizing renormalizes: each vertex's four weights are scaled to sum to
// exactly 255 and the rounding residual goes to the largest of them, so a
// vertex never gets quietly heavier or lighter than the float original.
//
// The rewrite repacks EVERY accessor into its own tightly-packed buffer view.
// That is simpler than patching offsets in place and costs nothing here (the
// exporter already writes them unstrided and unshared).
//
// usage: node tools/quantize.js <input.glb> [output.glb]
//        with no output path it rewrites the input

const fs = require("fs");

const COMPONENT_ARRAY = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const UNSIGNED_BYTE = 5121;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const [inputPath, outputPath = process.argv[2]] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node tools/quantize.js <input.glb> [output.glb]");

const file = fs.readFileSync(inputPath);
if (file.toString("ascii", 0, 4) !== "glTF") throw new Error(`${inputPath} is not a glb`);

const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.toString("utf8", 20, 20 + jsonLength));
const binary = file.subarray(
  20 + jsonLength + 8,
  20 + jsonLength + 8 + file.readUInt32LE(20 + jsonLength),
);

if (gltf.buffers.length !== 1) throw new Error(`expected one buffer, found ${gltf.buffers.length}`);
if ((gltf.images ?? []).length)
  throw new Error("this rewrite drops embedded images; export without them");

// Read an accessor out as its own typed array, walking the stride when the
// view is interleaved.
const readAccessor = (accessorIndex) => {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const ArrayType = COMPONENT_ARRAY[accessor.componentType];
  const components = COMPONENT_COUNT[accessor.type];
  const elementBytes = components * ArrayType.BYTES_PER_ELEMENT;

  const start = binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? elementBytes;
  const values = new ArrayType(accessor.count * components);

  for (let element = 0; element < accessor.count; element++) {
    const source = new ArrayType(binary.buffer, start + element * stride, components);
    values.set(source, element * components);
  }

  return values;
};

// Scale a vertex's four weights so they sum to exactly 255, giving the
// rounding residual to the heaviest one. A vertex with no weight at all is
// left at zero rather than invented, so the pose stays what it was.
const quantizeWeights = (values, count) => {
  const out = new Uint8Array(count * 4);
  let unweighted = 0;
  let worstError = 0;

  for (let vertex = 0; vertex < count; vertex++) {
    const weights = [0, 1, 2, 3].map((component) => values[vertex * 4 + component]);
    const sum = weights.reduce((total, weight) => total + weight, 0);

    if (sum <= 0) {
      unweighted++;
      continue;
    }

    const rounded = weights.map((weight) => Math.round((weight / sum) * 255));
    const residual = 255 - rounded.reduce((total, weight) => total + weight, 0);

    let heaviest = 0;
    for (let component = 1; component < 4; component++) {
      if (rounded[component] > rounded[heaviest]) heaviest = component;
    }
    rounded[heaviest] = Math.min(255, Math.max(0, rounded[heaviest] + residual));

    for (let component = 0; component < 4; component++) {
      out[vertex * 4 + component] = rounded[component];
      worstError = Math.max(
        worstError,
        Math.abs(rounded[component] / 255 - weights[component] / sum),
      );
    }
  }

  return { out, unweighted, worstError };
};

// which accessors feed the index buffer, so their view keeps the right target
const indexAccessors = new Set();
const attributeAccessors = new Set();
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    if (primitive.indices !== undefined) indexAccessors.add(primitive.indices);
    for (const accessorIndex of Object.values(primitive.attributes)) {
      attributeAccessors.add(accessorIndex);
    }
  }
}

const weightAccessors = new Set();
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    const accessorIndex = primitive.attributes.WEIGHTS_0;
    if (accessorIndex !== undefined) weightAccessors.add(accessorIndex);
  }
}

let unweightedTotal = 0;
let worstErrorTotal = 0;
let quantized = 0;

const chunks = [];
const views = [];
let offset = 0;

gltf.accessors.forEach((accessor, accessorIndex) => {
  let values = readAccessor(accessorIndex);

  if (weightAccessors.has(accessorIndex) && accessor.componentType === FLOAT) {
    const result = quantizeWeights(values, accessor.count);
    values = result.out;
    unweightedTotal += result.unweighted;
    worstErrorTotal = Math.max(worstErrorTotal, result.worstError);
    quantized++;

    accessor.componentType = UNSIGNED_BYTE;
    accessor.normalized = true;

    // min/max describe the stored values, so they move with the type
    const components = COMPONENT_COUNT[accessor.type];
    if (accessor.min && accessor.max) {
      accessor.min = new Array(components).fill(0);
      accessor.max = new Array(components).fill(255);
      for (let component = 0; component < components; component++) {
        let low = 255;
        let high = 0;
        for (let element = 0; element < accessor.count; element++) {
          const value = values[element * components + component];
          if (value < low) low = value;
          if (value > high) high = value;
        }
        accessor.min[component] = low;
        accessor.max[component] = high;
      }
    }
  }

  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  // every view starts 4-byte aligned so any component type can be read from it
  const padding = (4 - (offset % 4)) % 4;
  if (padding) {
    chunks.push(Buffer.alloc(padding));
    offset += padding;
  }

  const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
  if (indexAccessors.has(accessorIndex)) view.target = ELEMENT_ARRAY_BUFFER;
  else if (attributeAccessors.has(accessorIndex)) view.target = ARRAY_BUFFER;

  views.push(view);
  chunks.push(bytes);
  offset += bytes.length;

  accessor.bufferView = accessorIndex;
  accessor.byteOffset = 0;
});

gltf.bufferViews = views;

const binaryOut = Buffer.concat(chunks);
const binaryPadded = Buffer.concat([binaryOut, Buffer.alloc((4 - (binaryOut.length % 4)) % 4)]);
gltf.buffers = [{ byteLength: binaryPadded.length }];

const jsonOut = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPadded = Buffer.concat([jsonOut, Buffer.alloc((4 - (jsonOut.length % 4)) % 4, 0x20)]);

const header = Buffer.alloc(12);
header.write("glTF", 0, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binaryPadded.length, 8);

const chunkHeader = (length, tag) => {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(length, 0);
  buffer.write(tag, 4, "ascii");
  return buffer;
};

fs.writeFileSync(
  outputPath,
  Buffer.concat([
    header,
    chunkHeader(jsonPadded.length, "JSON"),
    jsonPadded,
    chunkHeader(binaryPadded.length, "BIN\0"),
    binaryPadded,
  ]),
);

console.log(`${inputPath} -> ${outputPath}`);
console.log(`  quantized ${quantized} WEIGHTS_0 accessor(s) to normalized bytes`);
console.log(
  `  worst weight error ${worstErrorTotal.toFixed(5)} (one byte step is ${(1 / 255).toFixed(5)})`,
);
if (unweightedTotal)
  console.log(`  ${unweightedTotal} vertices had no weight and were left at zero`);
console.log(`  ${file.length} -> ${fs.statSync(outputPath).size} bytes`);
