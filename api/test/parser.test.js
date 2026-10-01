import test from "node:test";
import assert from "node:assert/strict";
import { parseReference } from "../src/lib/normalization.js";

test("keeps a pure 12NC for official resolution", () => {
  const parsed = parseReference("911401838588");
  assert.equal(parsed.inputType, "ORDER_CODE");
  assert.equal(parsed.orderCode, "911401838588");
  assert.equal(parsed.reference, "");
});

test("normalizes UE840 without losing LED150", () => {
  const parsed = parseReference("BY120P G6 LED150/UE840 PSU WB");
  assert.equal(parsed.family, "BY120P");
  assert.equal(parsed.generation, "G6");
  assert.equal(parsed.package, "LED150");
  assert.equal(parsed.packageCanonical, "150");
  assert.equal(parsed.colorCode, "840");
  assert.equal(parsed.cct, 4000);
  assert.equal(parsed.cri, 80);
  assert.equal(parsed.efficiency, "UE");
  assert.deepEqual(parsed.features, ["WB"]);
});

test("parses critical fields independently", () => {
  const parsed = parseReference("WT490C 62S/840 PSU NE WB PI5 L1800");
  assert.equal(parsed.packageCanonical, "62S");
  assert.equal(parsed.efficiency, "NE");
  assert.equal(parsed.length, "L1800");
  assert.deepEqual(parsed.features, ["WB", "PI5"]);
  assert.equal(parsed.targetControlClass, "DALI");
});

test("parses a tunable-white range returned by the configurator", () => {
  const parsed = parseReference("DN610B 40S/TW927-965 DIA-E C WH PGO");
  assert.equal(parsed.colorCode, "TW927-965");
  assert.equal(parsed.cri, 90);
  assert.equal(parsed.cctMin, 2700);
  assert.equal(parsed.cctMax, 6500);
  assert.equal(parsed.tunableWhite, true);
  assert.equal(parsed.controlClass, "DALI");
});

test("preserves the SM350C technical signature", () => {
  const parsed = parseReference("SM350C 50S/840 PSU PCS L1500 WH");
  assert.equal(parsed.family, "SM350C");
  assert.equal(parsed.packageCanonical, "50S");
  assert.equal(parsed.colorCode, "840");
  assert.equal(parsed.length, "L1500");
  assert.deepEqual(parsed.features, ["PCS", "WH"]);
});
