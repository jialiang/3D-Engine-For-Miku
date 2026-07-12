import js from "@eslint/js";
import globals from "globals";

// Classes and functions declared at the top level of one classic script
// and used in another. ESLint checks files in isolation, so without this
// list every cross-file reference would be reported as undefined.
const crossFileGlobals = {
  Ammo: "readonly",
  mat4: "readonly",

  initAmmo: "readonly",

  Camera: "readonly",
  CameraController: "readonly",
  CameraTransform: "readonly",
  FBO: "readonly",
  FileParser: "readonly",
  GL: "readonly",
  Grid: "readonly",
  Kinematics: "readonly",
  Light: "readonly",
  Physics: "readonly",
  PMD: "readonly",
  Texture: "readonly",
  Transform: "readonly",
  Utilities: "readonly",
  VAO: "readonly",
  VMD: "readonly",

  UBO: "readonly",
  BoneArrayUbo: "readonly",
  CameraUbo: "readonly",
  LightUbo: "readonly",
  MaterialArrayUbo: "readonly",
  ModelUbo: "readonly",
  ShadowUbo: "readonly",
};

export default [
  {
    ignores: [
      // vendored libraries
      "external/",
      "glMatrix-mat4.js",

      // binary MMD data renamed to .js so GitHub Pages serves it
      "models/",
      "motions/",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...crossFileGlobals,
      },
    },
    rules: {
      // each class file "redeclares" its own entry from crossFileGlobals
      "no-redeclare": ["error", { builtinGlobals: false }],

      // class declarations (and initAmmo) look unused in their own file
      // because their uses live in other scripts, so skip those names
      "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z]|^initAmmo$" }],
    },
  },
];
