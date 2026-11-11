import {generateGeometry} from "../../src/geometry.ts";

export const saggingFixtures = {
 tapered: {baseProfile:"tapered",modifier:"none",parameters:{},beadWidthMm:2},
 rounded: {baseProfile:"bulbous",modifier:"none",parameters:{},beadWidthMm:2},
 mixed: {baseProfile:"bulbous",modifier:"twisted",parameters:{bulge:.32,sculpturalIntensity:.45,twistAngle:3,twistAmplitude:.14,lobeCount:3},beadWidthMm:2},
 gentle: {baseProfile:"bulbous",modifier:"twisted",parameters:{sculpturalIntensity:.65},beadWidthMm:2},
 cylinder: {baseProfile:"cylinder",modifier:"none",parameters:{},beadWidthMm:2},
 twist: {baseProfile:"bulbous",modifier:"twisted",parameters:{bulge:.18,sculpturalIntensity:1,twistAngle:4,twistAmplitude:.18,lobeCount:4},beadWidthMm:2},
 fold: {baseProfile:"bulbous",modifier:"soft-organic-fold",parameters:{bulge:.4,foldAmplitude:1},beadWidthMm:1.4},
 overhang: {baseProfile:"bulbous",modifier:"twisted",parameters:{bulge:.4,sculpturalIntensity:1,twistAngle:6,twistAmplitude:.18,lobeCount:5},beadWidthMm:2},
};
export function saggingFixture(name) {
 const {beadWidthMm,...geometry}=saggingFixtures[name];
 return generateGeometry({
  geometry:{...geometry,heightMm:20,radiusMm:15,seed:123},
  sampling:{layerHeightMm:1},printing:{beadWidthMm,feedrateMmMin:600},
 });
}
