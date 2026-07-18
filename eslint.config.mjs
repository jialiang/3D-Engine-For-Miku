import js from "@eslint/js";
import globals from "globals";

// Classes and functions declared at the top level of one classic script
// and used in another. ESLint checks files in isolation, so without this
// list every cross-file reference would be reported as undefined.
const crossFileGlobals = {
  mat4: "readonly",

  Animation: "readonly",
  AudioClock: "readonly",
  Camera: "readonly",
  CameraController: "readonly",
  CameraTransform: "readonly",
  FBO: "readonly",
  FileParser: "readonly",
  Floor: "readonly",
  GL: "readonly",
  GLTF: "readonly",
  Light: "readonly",
  Model: "readonly",
  PropRig: "readonly",
  Skeleton: "readonly",
  Texture: "readonly",
  Transform: "readonly",
  Utilities: "readonly",
  VAO: "readonly",

  UBO: "readonly",
  BoneArrayUbo: "readonly",
  CameraUbo: "readonly",
  LightUbo: "readonly",
  ModelUbo: "readonly",
  ShadowUbo: "readonly",
};

export default [
  {
    ignores: [
      // vendored libraries
      "external/",
      "glMatrix-mat4.js",

      // untracked local tooling (gitignored)
      ".ignored/",
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

      // class declarations look unused in their own file because their uses
      // live in other scripts, so skip those names
      "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z]" }],
    },
  },

  {
    // the offline grounding bake is a Node CommonJS script, not a browser
    // classic script like the rest of the repo
    files: ["tools/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
];
