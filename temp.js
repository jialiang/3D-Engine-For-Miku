// static addNumToVec = (v, n) => [
//   v.x + n, //
//   v.y + n, //
//   v.z + n, //
// ];

// the quaternion to rotate v1 to v2
// static quatFromVecs = (v1, v2) => {
//   const { cross, dot, norm } = Utilities;

//   const rotation = dot(v1, v2) + 1;

//   if (rotation >= 0) return norm([...cross(v1, v2), rotation]);

//   if (Math.abs(v1.x) > Math.abs(v1.z)) return norm([-v1.y, v1.x, 0, 0]);

//   return norm([0, -v1.z, v1.y, 0]);
// };
