import test from "node:test";
import assert from "node:assert/strict";
import { ConfiguratorApiClient } from "../src/lib/configurator-api.js";
import { parseReference } from "../src/lib/normalization.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("discovers and applies a selectable DALI option without fixed variable names", async () => {
  const responses = [
    {
      configId: "session-1",
      options: [
        { variableName: "v.package", valueName: "20S", state: "selected" },
        { variableName: "v.colour", valueName: "840", state: "selected" },
        { variableName: "v.reflector", valueName: "WR", state: "selected" },
        { variableName: "v.finish", valueName: "WH", state: "selected" },
        { variableName: "v.option", valueName: "PCO", state: "selected" },
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSU-E", state: "selected" },
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSD-E", state: "selectable" },
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "DIA-E", state: "selectable" },
      ],
    },
    {
      configId: "session-1",
      commercialDescription: "DN500B 20S/840 DIA-E WR WH PCO",
      options: [
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "DIA-E", state: "userSelected" },
      ],
    },
  ];
  const bodies = [];
  const client = new ConfiguratorApiClient({
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return jsonResponse(responses.shift());
    },
  });
  const result = await client.validateControlChange({
    configuratorId: "DN500BI",
    sourceControlClass: "ON_OFF",
    targetControlClass: "DALI",
    requirements: parseReference("DN500B 20S/840 PSU-E WR WH PCO"),
    seed: {
      configId: "session-1",
      existingAssignments: [
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSU-E" },
      ],
    },
  });
  assert.equal(result.validated, true);
  assert.equal(result.description, "DN500B 20S/840 DIA-E WR WH PCO");
  assert.equal(result.orderCode, "");
  assert.equal(bodies[1].newAssignment.assignment.valueName, "DIA-E");
});

test("does not validate when an official configurator session cannot be bootstrapped", async () => {
  let calls = 0;
  const client = new ConfiguratorApiClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ message: "no options" }, 400);
    },
  });
  const result = await client.validateControlChange({ configuratorId: "DN500BI", seed: null, sourceControlClass: "ON_OFF", targetControlClass: "DALI" });
  assert.equal(result.validated, false);
  assert.equal(result.reason, "CONFIGURATOR_SESSION_NOT_AVAILABLE");
  assert.equal(calls, 2);
});

test("reads a real-style hierarchical variable with values in child objects", async () => {
  const responses = [
    {
      configId: "nested-session",
      variables: [{
        variableName: "Electrical_and_Control.PLM_TRAFO",
        values: [
          { valueName: "PSU-E", state: "selected" },
          { valueName: "DIA-E", state: "selectable" },
        ],
      }],
    },
    {
      configId: "nested-session",
      commercialDescription: "DN500B 20S/840 DIA-E WR WH PCO",
      variables: [{
        variableName: "Electrical_and_Control.PLM_TRAFO",
        values: [{ valueName: "DIA-E", state: "userSelected" }],
      }],
    },
  ];
  const client = new ConfiguratorApiClient({
    fetchImpl: async () => jsonResponse(responses.shift()),
  });
  const result = await client.validateControlChange({
    configuratorId: "DN500BI",
    familyCode: "DN500B",
    sourceControlClass: "ON_OFF",
    targetControlClass: "DALI",
  });
  assert.equal(result.validated, true);
  assert.equal(result.description, "DN500B 20S/840 DIA-E WR WH PCO");
  assert.equal(result.selectedControl, "DIA-E");
});

test("bootstraps DN610BI and selects the closest tunable-white range plus DIA-E", async () => {
  const responses = [
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "selected" },
        { variableName: "v.colour", valueName: "TW927-965", state: "selectable" },
        { variableName: "v.distribution", valueName: "C", state: "selected" },
        { variableName: "v.finish", valueName: "WH", state: "selected" },
        { variableName: "v.optic", valueName: "PGO", state: "selected" },
        { variableName: "v.driver", valueName: "PSU-E", state: "selected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "selectable" },
        { variableName: "v.driver", valueName: "DIA-E", state: "selectable" },
      ],
    },
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "selected" },
        { variableName: "v.colour", valueName: "TW927-965", state: "userSelected" },
        { variableName: "v.distribution", valueName: "C", state: "selected" },
        { variableName: "v.finish", valueName: "WH", state: "selected" },
        { variableName: "v.optic", valueName: "PGO", state: "selected" },
        { variableName: "v.driver", valueName: "PSU-E", state: "selected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "selectable" },
        { variableName: "v.driver", valueName: "DIA-E", state: "selectable" },
      ],
    },
    {
      configId: "generated-session",
      commercialDescription: "DN610B 40S/TW927-965 DIA-E C WH PGO",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "userSelected" },
        { variableName: "v.colour", valueName: "TW927-965", state: "userSelected" },
        { variableName: "v.distribution", valueName: "C", state: "userSelected" },
        { variableName: "v.finish", valueName: "WH", state: "userSelected" },
        { variableName: "v.optic", valueName: "PGO", state: "userSelected" },
        { variableName: "v.driver", valueName: "DIA-E", state: "userSelected" },
      ],
    },
  ];
  const bodies = [];
  const client = new ConfiguratorApiClient({
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return jsonResponse(responses.shift());
    },
  });
  const result = await client.validateControlChange({
    configuratorId: "DN610BI",
    familyCode: "DN610B",
    sourceControlClass: "ON_OFF",
    targetControlClass: "DALI",
    requirements: parseReference("DN571B LED40S/930H PSU-E C WH PGO"),
  });
  assert.equal(result.validated, true);
  assert.equal(result.description, "DN610B 40S/TW927-965 DIA-E C WH PGO");
  assert.deepEqual(result.appliedRequirements, ["package", "color", "feature-0", "feature-1", "feature-2"]);
  assert.equal(bodies[1].newAssignment.assignment.valueName, "TW927-965");
  assert.equal(bodies.at(-1).newAssignment.assignment.valueName, "DIA-E");
});
