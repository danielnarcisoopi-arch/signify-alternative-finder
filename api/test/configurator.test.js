import test from "node:test";
import assert from "node:assert/strict";
import { ConfiguratorApiClient } from "../src/lib/configurator-api.js";

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
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSU-E", state: "selected" },
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSD-E", state: "selectable" },
      ],
    },
    {
      configId: "session-1",
      commercialDescription: "DN500B 20S/840 PSD-E WR WH PCO",
      options: [
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSD-E", state: "userSelected" },
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
    seed: {
      configId: "session-1",
      existingAssignments: [
        { variableName: "Electrical_and_Control.DynamicDriver", valueName: "PSU-E" },
      ],
    },
  });
  assert.equal(result.validated, true);
  assert.equal(result.description, "DN500B 20S/840 PSD-E WR WH PCO");
  assert.equal(result.orderCode, "");
  assert.equal(bodies[1].newAssignment.assignment.valueName, "PSD-E");
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

test("bootstraps a configurator and applies technical options discovered at runtime", async () => {
  const responses = [
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "selectable" },
        { variableName: "v.colour", valueName: "930", state: "selectable" },
        { variableName: "v.optic", valueName: "PGO", state: "selectable" },
        { variableName: "v.driver", valueName: "PSU-E", state: "selected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "selectable" },
      ],
    },
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "userSelected" },
        { variableName: "v.colour", valueName: "930", state: "selectable" },
        { variableName: "v.optic", valueName: "PGO", state: "selectable" },
        { variableName: "v.driver", valueName: "PSU-E", state: "selected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "selectable" },
      ],
    },
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "userSelected" },
        { variableName: "v.colour", valueName: "930", state: "userSelected" },
        { variableName: "v.optic", valueName: "PGO", state: "selectable" },
        { variableName: "v.driver", valueName: "PSU-E", state: "selected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "selectable" },
      ],
    },
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "userSelected" },
        { variableName: "v.colour", valueName: "930", state: "userSelected" },
        { variableName: "v.optic", valueName: "PGO", state: "userSelected" },
        { variableName: "v.driver", valueName: "PSU-E", state: "selected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "selectable" },
      ],
    },
    {
      configId: "generated-session",
      commercialDescription: "DN610B 40S/930 PSD-E C WH PGO",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "userSelected" },
        { variableName: "v.colour", valueName: "930", state: "userSelected" },
        { variableName: "v.optic", valueName: "PGO", state: "userSelected" },
        { variableName: "v.driver", valueName: "PSD-E", state: "userSelected" },
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
    configuratorId: "CURRENT-CONFIGURATOR",
    sourceControlClass: "ON_OFF",
    targetControlClass: "DALI",
    requirements: {
      package: "LED40S",
      packageCanonical: "40S",
      colorCode: "930",
      features: ["PGO"],
    },
  });
  assert.equal(result.validated, true);
  assert.equal(result.description, "DN610B 40S/930 PSD-E C WH PGO");
  assert.deepEqual(result.appliedRequirements, ["package", "color", "feature-0"]);
  assert.equal(bodies.at(-1).newAssignment.assignment.valueName, "PSD-E");
});
