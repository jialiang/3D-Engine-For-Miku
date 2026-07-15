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

class Utilities {
  static fetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.responseType = options.responseType || "text";

      // onload also fires for HTTP errors (404, 500, ...), so check the
      // status instead of handing an error page to the caller as data
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error(`Failed to fetch ${url}: HTTP status ${xhr.status}`));
      };

      // reading responseText here would throw on the arraybuffer path
      xhr.onerror = () => reject(new Error(`Network error while fetching ${url}`));

      xhr.open("GET", url, true);
      xhr.send(null);
    });
  };

  static loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load image ${src}`));

      image.src = src;
    });
  };

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
      [0, 0, 0],
    );
  };

  static multiplyVecByMat4 = (v, m) => [
    m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12] * v.w,
    m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13] * v.w,
    m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14] * v.w,
    m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15] * v.w,
  ];
}
