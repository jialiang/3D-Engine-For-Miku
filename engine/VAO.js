// Vertex Array Object
class VAO {
  // boneIndices/boneWeights are the 4-bone matrix-palette skinning inputs
  // (glTF JOINTS_0/WEIGHTS_0). They replaced the old 2-bone quaternion slots.
  //
  // canQuantize marks an attribute the asset may store as normalized integers
  // rather than floats, which the GPU scales back on the way to the shader. It
  // suits anything whose range is fixed: skin weights sit in 0..1 and unit
  // normals in -1..1. Positions and UVs cannot join them, since dequantizing
  // those needs a per-mesh scale the shader does not carry.
  static AttributeInfo = {
    position: {
      location: 0,
      size: 3,
    },
    uv: {
      location: 2,
      size: 2,
    },
    normal: {
      location: 3,
      size: 3,
      canQuantize: true,
    },
    boneIndices: {
      location: 4,
      size: 4,
      type: "int",
    },
    boneWeights: {
      location: 5,
      size: 4,
      canQuantize: true,
    },
  };

  // The GL type behind each integer array a quantized attribute can arrive as.
  static QuantizedGlTypeName = new Map([
    [Int8Array, "BYTE"],
    [Uint8Array, "UNSIGNED_BYTE"],
    [Int16Array, "SHORT"],
    [Uint16Array, "UNSIGNED_SHORT"],
  ]);

  gl;
  vao;

  buffers = {};
  verticesToDrawCount = 0;

  constructor(gl, source, verticesToDrawCount) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    for (const key in source) {
      if (key === "index") continue;

      const attributeInfo = VAO.AttributeInfo[key];

      if (!attributeInfo) throw new Error(`Invalid attribute ${key} supplied.`);

      const { location, size, type = "float", canQuantize = false } = attributeInfo;

      // a quantized attribute is uploaded as the integers it already is. Every
      // other one is widened to float, which also covers the hand-built floor
      // geometry arriving as a plain array
      const quantizedTypeName = canQuantize
        ? VAO.QuantizedGlTypeName.get(source[key]?.constructor)
        : undefined;

      const array =
        type === "int"
          ? new Int16Array(source[key])
          : quantizedTypeName
            ? source[key]
            : new Float32Array(source[key]);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);

      if (type === "int") gl.vertexAttribIPointer(location, size, gl.SHORT, 0, 0);
      else if (quantizedTypeName) {
        gl.vertexAttribPointer(location, size, gl[quantizedTypeName], true, 0, 0);
      } else gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);

      this.buffers[key] = buffer;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.gl = gl;
    this.vao = vao;
    this.verticesToDrawCount = verticesToDrawCount;

    if (source.index) {
      const array = ArrayBuffer.isView(source.index) ? source.index : new Uint16Array(source.index);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, array, gl.STATIC_DRAW);
      this.buffers.index = buffer;
    }

    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl, vao, buffers } = this;

    for (const key in buffers) gl.deleteBuffer(buffers[key]);

    gl.deleteVertexArray(vao);

    this.buffers = {};
    this.vao = null;
  }
}
