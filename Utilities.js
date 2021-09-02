Object.defineProperty(Array.prototype, "x", {
  get: function () {
    return this[0];
  },
  set: function (v) {
    this[0] = v;
  },
});

Object.defineProperty(Array.prototype, "y", {
  get: function () {
    return this[1];
  },
  set: function (v) {
    this[1] = v;
  },
});

Object.defineProperty(Array.prototype, "z", {
  get: function () {
    return this[2];
  },
  set: function (v) {
    this[2] = v;
  },
});

Object.defineProperty(Array.prototype, "w", {
  get: function () {
    return this[3];
  },
  set: function (v) {
    this[3] = v;
  },
});

Array.prototype.getRange = function (start, count) {
  return this.slice(start, start + count);
};

Array.prototype.replaceRange = function (start, array, count) {
  for (let i = 0; i < (count || array.length); i++) this[start + i] = array[i];
};

class Utilities {
  static fetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.responseType = options.responseType || "text";
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = (error) => reject(error);
      xhr.open("GET", url, true);
      xhr.send(null);
    });
  };

  static createHashtableFromArray = (array, keyPropertyName) => {
    const hash = {};

    array.forEach((item) => {
      const key = item[keyPropertyName];
      hash[key] = item;
    });

    return hash;
  };

  static crossProduct = (v1, v2) => [
    v1.y * v2.z - v1.z * v2.y, //
    v1.z * v2.x - v1.x * v2.z, //
    v1.x * v2.y - v1.y * v2.x,
  ];

  static cross = (v1, v2) => Utilities.crossProduct(v1, v2);

  static dotProduct = (vq1, vq2) => vq1.reduce((total, vq, i) => total + vq * vq2[i], 0);

  static dot = (vq1, vq2) => Utilities.dotProduct(vq1, vq2);

  static normalize = (vq) => {
    const { dot, multiplyVecByNum } = Utilities;

    let force = dot(vq, vq);

    if (force > 0) force = 1 / Math.sqrt(force);

    const result = multiplyVecByNum(vq, force);

    if (vq.length === 4) result.push(vq.w * force);

    return result;
  };

  static norm = (vq) => Utilities.normalize(vq);

  static clamp = (value, min, max) => {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  };

  static sumVecs = (...vectors) => {
    return vectors.reduce(
      (total, v) => {
        total.x += v.x;
        total.y += v.y;
        total.z += v.z;

        return total;
      },
      [0, 0, 0]
    );
  };

  static subtractVecs = (v1, v2) => [
    v1.x - v2.x, //
    v1.y - v2.y, //
    v1.z - v2.z, //
  ];

  static multiplyVecByNum = (v, n) => [
    v.x * n, //
    v.y * n, //
    v.z * n, //
  ];

  // position of vector after being rotated by quaternion
  static multiplyVecByQuat = (v, q) => {
    const { cross, multiplyVecByNum, subtractVecs, sumVecs } = Utilities;

    const v1 = cross(v, q);
    const v2 = multiplyVecByNum(v, q.w);
    const v3 = subtractVecs(v1, v2);
    const v4 = cross(v3, q);
    const v5 = multiplyVecByNum(v4, 2);
    const v6 = sumVecs(v, v5);

    return v6;
  };

  static multiplyVecByMat4 = (v, m) => [
    m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12] * v.w,
    m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13] * v.w,
    m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14] * v.w,
    m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15] * v.w,
  ];

  // combines 2 quaternions
  static multiplyQuats = (q1, q2) => [
    q1.x * q2.w + q1.w * q2.x + q1.y * q2.z - q1.z * q2.y,
    q1.y * q2.w + q1.w * q2.y + q1.z * q2.x - q1.x * q2.z,
    q1.z * q2.w + q1.w * q2.z + q1.x * q2.y - q1.y * q2.x,
    q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
  ];

  static multiplyMat3ByVec = (m, v) => [
    v[0] * m[0] + v[1] * m[1] + v[2] * m[2], //
    v[0] * m[3] + v[1] * m[4] + v[2] * m[5], //
    v[0] * m[6] + v[1] * m[7] + v[2] * m[8],
  ];

  // linear interpolation
  static lerp = (n1, n2, w1) => n1 * w1 + n2 * (1 - w1);

  // linear interpolation of vector
  static vectorLerp = (v1, v2, w1) => {
    const { multiplyVecByNum, sumVecs } = Utilities;

    const a = multiplyVecByNum(v1, w1);
    const b = multiplyVecByNum(v2, 1 - w1);

    return sumVecs(a, b);
  };

  // spherical linear interpolation of quaternion
  static quatenionSlerp = (q2, q1, w1) => {
    const b = [...q2];

    let scale0 = 1.0 - w1;
    let scale1 = w1;

    let force = Utilities.dot(q1, q2);

    if (force < 0.0) {
      force = -force;
      b.x = -b.x;
      b.y = -b.y;
      b.z = -b.z;
      b.w = -b.w;
    }

    if (1.0 - force > 0.0001) {
      const omega = Math.acos(force);
      const sinom = Math.sin(omega);

      scale0 = Math.sin((1.0 - w1) * omega) / sinom;
      scale1 = Math.sin(w1 * omega) / sinom;
    }

    return [
      scale0 * q1.x + scale1 * b.x, //
      scale0 * q1.y + scale1 * b.y, //
      scale0 * q1.z + scale1 * b.z, //
      scale0 * q1.w + scale1 * b.w,
    ];
  };

  static invertQuat = (q) => [-q.x, -q.y, -q.z, q.w];
}
