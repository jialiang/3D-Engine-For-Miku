// Vertex Array Object
class VAO {
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
    },
    morph: {
      location: 4,
      size: 3,
    },
    material: {
      location: 5,
      size: 1,
      type: "int",
    },
    boneWeight: {
      location: 6,
      size: 1,
    },
    distanceFromBone_1: {
      location: 7,
      size: 3,
    },
    distanceFromBone_2: {
      location: 8,
      size: 3,
    },
    boneIndex_1: {
      location: 9,
      size: 1,
      type: "int",
    },
    boneIndex_2: {
      location: 10,
      size: 1,
      type: "int",
    },
  };

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

      const { location, size, type = "float" } = attributeInfo;

      const array = type === "int" ? new Int16Array(source[key]) : new Float32Array(source[key]);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);

      if (type === "int") gl.vertexAttribIPointer(location, size, gl.SHORT, 0, 0);
      else gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);

      this.buffers[key] = buffer;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.gl = gl;
    this.vao = vao;
    this.verticesToDrawCount = verticesToDrawCount;

    if (source.index) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(source.index), gl.STATIC_DRAW);
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
