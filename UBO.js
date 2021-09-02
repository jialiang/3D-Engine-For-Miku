class UBO {
  static INDEX = 1;

  gl;
  programs;
  uniformBuffer;
  blockName;
  blockSize;
  bindingPoint;
  blockVariableInfo;

  constructor(gl, programs, blockName, blockVariableNames) {
    this.gl = gl;
    this.programs = programs;

    const blockIndex = gl.getUniformBlockIndex(programs[0], blockName);
    const blockSize = gl.getActiveUniformBlockParameter(programs[0], blockIndex, gl.UNIFORM_BLOCK_DATA_SIZE);

    const uniformBuffer = gl.createBuffer();

    gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, blockSize, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    const bindingPoint = UBO.INDEX;
    UBO.INDEX += 1;

    gl.bindBufferBase(gl.UNIFORM_BUFFER, bindingPoint, uniformBuffer);

    if (!blockVariableNames || blockVariableNames.length === 0) {
      blockVariableNames = this.getDefaultBlockVariableNames();
    }

    const blockVariableIndices = gl.getUniformIndices(programs[0], blockVariableNames);
    const blockVariableOffsets = gl.getActiveUniforms(programs[0], blockVariableIndices, gl.UNIFORM_OFFSET);

    const blockVariableIndicesArray = Array.from(blockVariableIndices);
    const blockVariableOffsetsArray = Array.from(blockVariableOffsets);

    this.blockVariableInfo = {};

    blockVariableNames.forEach((name, index) => {
      this.blockVariableInfo[name] = {
        index: blockVariableIndicesArray[index],
        offset: blockVariableOffsetsArray[index],
      };
    });

    this.uniformBuffer = uniformBuffer;
    this.blockName = blockName;
    this.blockSize = blockSize;
    this.bindingPoint = bindingPoint;
  }

  getDefaultBlockVariableNames() {
    return [];
  }

  bindUniformBlock() {
    const { gl, programs, blockName, bindingPoint } = this;

    programs.forEach((program) => {
      const blockIndex = gl.getUniformBlockIndex(program, blockName);

      gl.uniformBlockBinding(program, blockIndex, bindingPoint);
    });

    return this;
  }

  updateData(uniformList) {
    const { gl, blockVariableInfo, uniformBuffer } = this;

    gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);

    uniformList.forEach((uniform) => {
      const { name, value } = uniform;
      const info = blockVariableInfo[name];
      const array = new Float32Array(value);

      gl.bufferSubData(gl.UNIFORM_BUFFER, info.offset, array);
    });

    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    return this;
  }
}

class CameraUbo extends UBO {
  getDefaultBlockVariableNames() {
    return ["u_projectionMatrix", "u_viewMatrix"];
  }

  updateCameraData(camera) {
    return this.updateData([
      {
        name: "u_projectionMatrix",
        value: camera.projectionMatrix,
      },
      {
        name: "u_viewMatrix",
        value: camera.transform.viewMatrix,
      },
    ]);
  }
}

class ModelUbo extends UBO {
  getDefaultBlockVariableNames() {
    return ["u_modelMatrix", "u_normalMatrix"];
  }

  updateModelData(model) {
    return this.updateData([
      {
        name: "u_modelMatrix",
        value: model.transform.modelMatrix,
      },
      {
        name: "u_normalMatrix",
        value: model.transform.normalMatrix,
      },
    ]);
  }
}

class BoneArrayUbo extends UBO {
  getDefaultBlockVariableNames() {
    return ["u_boneTranslation[0]", "u_boneRotation[0]"];
  }

  updateBoneData(bones) {
    return this.updateData([
      { name: "u_boneTranslation[0]", value: bones.boneTranslation },
      { name: "u_boneRotation[0]", value: bones.boneRotation },
    ]);
  }
}

class MaterialArrayUbo extends UBO {
  getDefaultBlockVariableNames() {
    return [
      "u_diffuseColor[0]",
      "u_diffuseTextureIndex[0]",
      "u_sphereTextureIndex[0]",
      "u_sphereTextureType[0]",
      "u_toonTextureIndex[0]",
      "u_ambientColor[0]",
      "u_specularity[0]",
      "u_specularColor[0]",
    ];
  }

  updateMaterialData(materials) {
    return this.updateData([
      { name: "u_diffuseColor[0]", value: materials.diffuseColor },
      { name: "u_diffuseTextureIndex[0]", value: materials.diffuseTextureIndex },
      { name: "u_sphereTextureIndex[0]", value: materials.sphereTextureIndex },
      { name: "u_sphereTextureType[0]", value: materials.sphereTextureType },
      { name: "u_toonTextureIndex[0]", value: materials.toonTextureIndex },
      { name: "u_ambientColor[0]", value: materials.ambientColor },
      { name: "u_specularity[0]", value: materials.specularity },
      { name: "u_specularColor[0]", value: materials.specularColor },
    ]);
  }
}

class LightUbo extends UBO {
  getDefaultBlockVariableNames() {
    return [
      "u_lightColor",
      "u_lightPosition",
      "u_lightProjectionMatrix",
      "u_lightViewMatrix",
      "u_lightTransformationMatrix",
    ];
  }

  updateLightData(light) {
    return this.updateData([
      { name: "u_lightColor", value: light.color },
      { name: "u_lightPosition", value: light.transform.position },
      { name: "u_lightProjectionMatrix", value: light.projectionMatrix },
      { name: "u_lightViewMatrix", value: light.transform.viewMatrix },
      { name: "u_lightTransformationMatrix", value: light.transformationMatrix },
    ]);
  }
}

class ShadowUbo extends UBO {
  getDefaultBlockVariableNames() {
    return ["u_shadowMappingMode", "u_shadowMapTexelSize"];
  }

  updateShadowData(shadow) {
    return this.updateData([
      { name: "u_shadowMappingMode", value: [shadow.shadowMappingMode] },
      { name: "u_shadowMapTexelSize", value: shadow.shadowMapTexelSize },
    ]);
  }
}
