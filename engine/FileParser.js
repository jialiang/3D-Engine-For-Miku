class FileParser {
  // Each numeric type pairs its DataView getter with the typed array a
  // counted run of that type fills (char has no array: it decodes to text).
  static DataTypeInfo = {
    char: {
      method: "getInt8",
      size: 1,
    },
    float: {
      method: "getFloat32",
      size: 4,
      array: Float32Array,
    },
    long: {
      method: "getInt32",
      size: 4,
      array: Int32Array,
    },
    unsignedLong: {
      method: "getUint32",
      size: 4,
      array: Uint32Array,
    },
    short: {
      method: "getInt16",
      size: 2,
      array: Int16Array,
    },
    unsignedShort: {
      method: "getUint16",
      size: 2,
      array: Uint16Array,
    },
    integer: {
      method: "getInt8",
      size: 1,
      array: Int8Array,
    },
    unsignedInteger: {
      method: "getUint8",
      size: 1,
      array: Uint8Array,
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

          if (metadata.length.indexOf("-") > -1)
            [keyPart, subtractPart] = metadata.length.split("-");

          let keys = keyPart.split(".");

          if (keys.length > 1) computedLength = mainData[keys[0]][keys[1]];
          else computedLength = data[keys[0]];

          computedLength -= parseInt(subtractPart, 10);
        }

        if (valueIsObject) {
          data[key] = [];
          for (let i = 0; i < computedLength; i++)
            data[key].push(this.parseStructure(metadata.structure, mainData));
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

  // Reads one field: a decoded string for char, a single number when no
  // length is given, otherwise a typed array of `length` values. The typed
  // array is compact and indexes fast in the sampler's tight loop (it used
  // to build a boxed JS array). The getter reads little-endian, so values
  // stay correct whatever the host byte order.
  extractFromRawData = (type, length) => {
    const { method, size, array: ArrayType } = FileParser.DataTypeInfo[type];
    const { parseOffset, rawData } = this;

    if (type === "char") {
      // Explicitly null-checked: a falsy test reads a spurious byte for a genuine
      // zero-length field and leaves parseOffset short for the rest of the file.
      const count = length == null ? 1 : length;
      const characters = [];

      for (let i = 0; i < count; i++) {
        const value = rawData[method](parseOffset + i * size, true);

        if (value === 0) break; // a null byte ends the string

        characters.push(value);
      }

      this.parseOffset += count * size;
      return this.shiftJisDecoder.decode(new Int8Array(characters));
    }

    if (length == null) {
      const value = rawData[method](parseOffset, true);
      this.parseOffset += size;
      return value;
    }

    const output = new ArrayType(length);

    for (let i = 0; i < length; i++) output[i] = rawData[method](parseOffset + i * size, true);

    this.parseOffset += length * size;
    return output;
  };
}
