class FileParser {
  static DataTypeInfo = {
    char: {
      method: "getInt8", // DataView getter method
      size: 1, // 1 * 8 bytes
    },
    float: {
      method: "getFloat32",
      size: 4, // 4 * 8 bytes
    },
    long: {
      method: "getInt32",
      size: 4,
    },
    short: {
      method: "getInt16",
      size: 2, // 2 * 8 bytes
    },
    integer: {
      method: "getInt8",
      size: 1,
    },
  };

  rawData = null;
  parsedData = {};
  parseOffset = 0;

  url = "";
  shiftJisDecoder = new TextDecoder("shift_jis");

  constructor(url, arrayBuffer, structure) {
    this.url = url;
    this.rawData = new DataView(arrayBuffer);
    this.parsedData = this.parseStructure(structure);

    // Don't need this anymore
    delete this.rawData;
  }

  // Interprets PMD.Structure recursively to find out
  // the type and length of information to extract from "rawData"
  parseStructure = (subStructure, mainData) => {
    const data = {};

    if (!mainData) mainData = data;

    for (const key in subStructure) {
      const metadata = subStructure[key];

      const hasFixedLength = typeof metadata.length === "number";
      const hasDynamicLength = typeof metadata.length === "string";
      const singleValue = typeof metadata.length === "undefined";

      const valueIsObject = typeof metadata.type === "undefined";
      const valueIsPrimitive = !valueIsObject;

      if (hasFixedLength || hasDynamicLength) {
        let computedLength;

        if (hasFixedLength) computedLength = metadata.length;
        if (hasDynamicLength) {
          let keyPart = metadata.length;
          let subtractPart = 0;

          if (metadata.length.indexOf("-") > -1) [keyPart, subtractPart] = metadata.length.split("-");

          let keys = keyPart.split(".");

          if (keys.length > 1) computedLength = mainData[keys[0]][keys[1]];
          else computedLength = data[keys[0]];

          computedLength -= parseInt(subtractPart, 10);
        }

        if (valueIsObject) {
          data[key] = [];
          for (let i = 0; i < computedLength; i++) data[key].push(this.parseStructure(metadata.structure, mainData));
        }

        if (valueIsPrimitive) data[key] = this.extractFromRawData(metadata.type, computedLength);
      }

      if (singleValue) {
        if (valueIsObject) data[key] = this.parseStructure(metadata, mainData);
        if (valueIsPrimitive) data[key] = this.extractFromRawData(metadata.type);
      }

      if (metadata.stopParseIf != null && data[key] === metadata.stopParseIf) return data;
    }

    return data;
  };

  // Given type and length, able to extract an array of numbers/chars from "rawData"
  extractFromRawData = (type, length) => {
    const { DataTypeInfo } = FileParser;
    const { parseOffset, rawData } = this;

    const dataTypeMetadata = DataTypeInfo[type];
    const method = dataTypeMetadata.method;
    const size = dataTypeMetadata.size;

    let output = [];

    for (let i = 0; i < (length || 1); i++) {
      const index = parseOffset + i * size;
      const value = rawData[method](index, true); // PMD uses little endian for floats, thus true on 2nd parameter

      if (type === "char" && value === 0) break; // value of 0 means end of output for char

      output.push(value);
    }

    this.parseOffset += (length || 1) * size;

    if (type === "char") return this.shiftJisDecoder.decode(new Int8Array(output));
    return output.length === 1 && !length ? output[0] : output;
  };
}
