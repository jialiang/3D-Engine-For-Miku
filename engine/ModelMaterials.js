// Which texture each of the shipped model's materials takes, as three plain lookups.
//
// PURE DATA, which is why it is not in Model.js. These are the defaults for the character
// model and nothing else: Model.load takes all three as overrides and the stand mic passes
// its own (one flat ramp, no base map, no spec). Keeping them here leaves Model.js as the
// loading and drawing it actually does.
class ModelMaterials {
  // Which toon curve and specular map each material uses, keyed by its glb material name.
  // The DIVA ramps cross part boundaries, so this is spelt out rather than derived.
  // Materials missing from the spec map get no highlight.
  static toonRampByMaterial = {
    body_CH_CHARA_SD001Z: "skin00",
    hand_CH_CHARA_SD001Z: "skin00",
    sleeve_CH_CHARA_SD001Z: "red01",
    shoes_CH_CHARA_SD001Z: "red01",
    m07skirt_CH_CHARA_SD001Z: "wribon",
    skirtlace_CH_CHARA_SD001Z: "black01",
    tights_CH_CHARA_SD001Z: "black01_mik001",
    hairfront607_CH_CHARA_SD002Z: "hairfront",
    hairtail607_CH_CHARA_SD002Z: "hairtail",
    m607hoodset_CH_CHARA_SD001Z: "hood",
    face_CH_CHARA_SD001Z1: "face",
    facenose_CH_CHARA_SD001Z: "facenose",
    eye_CH_CHARA_SD001Z: "eye01",
    eye_dropshadow_CH_CHARA_SD001Z: "eye01",
    eyeblow_CH_CHARA_SD001Z: "green",
  };

  static specByMaterial = {
    body_CH_CHARA_SD001Z: "body_s",
    sleeve_CH_CHARA_SD001Z: "sleeve_s",
    shoes_CH_CHARA_SD001Z: "shoes_s",
    m07skirt_CH_CHARA_SD001Z: "skirt_s",
    skirtlace_CH_CHARA_SD001Z: "lace_s",
    tights_CH_CHARA_SD001Z: "tights_s",
    hairfront607_CH_CHARA_SD002Z: "hair_s",
    hairtail607_CH_CHARA_SD002Z: "hairtail_s",
    m607hoodset_CH_CHARA_SD001Z: "hoodset_s",
    face_CH_CHARA_SD001Z1: "face_s",
  };

  // Base colour per material. These are loose files too, so the glb stays a
  // mesh and rig container and every texture can be recompressed or reformatted
  // without re-exporting the model (merge_armatures.py --textures writes the
  // whole set). A model that gives no table here keeps its base colours inside
  // its glb instead, which is what the mic prop still does.
  static baseByMaterial = {
    body_CH_CHARA_SD001Z: "body",
    hand_CH_CHARA_SD001Z: "hand",
    sleeve_CH_CHARA_SD001Z: "sleeve",
    shoes_CH_CHARA_SD001Z: "shoes",
    m07skirt_CH_CHARA_SD001Z: "skirt",
    skirtlace_CH_CHARA_SD001Z: "lace",
    tights_CH_CHARA_SD001Z: "tights",
    hairfront607_CH_CHARA_SD002Z: "hair",
    hairtail607_CH_CHARA_SD002Z: "hairtail",
    m607hoodset_CH_CHARA_SD001Z: "hoodset",
    face_CH_CHARA_SD001Z1: "face",
    facenose_CH_CHARA_SD001Z: "facenose",
    eye_CH_CHARA_SD001Z: "eye",
    eye_dropshadow_CH_CHARA_SD001Z: "eyeshadow",
    eyeblow_CH_CHARA_SD001Z: "eyebrow",
  };
}
