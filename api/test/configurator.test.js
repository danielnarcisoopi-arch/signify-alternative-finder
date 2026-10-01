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

test("does not call the configurator without official session assignments", async () => {
  let called = false;
  const client = new ConfiguratorApiClient({ fetchImpl: async () => { called = true; } });
  const result = await client.validateControlChange({ configuratorId: "DN500BI", seed: null, sourceControlClass: "ON_OFF", targetControlClass: "DALI" });
  assert.equal(result.validated, false);
  assert.equal(result.reason, "CONFIGURATOR_SESSION_NOT_AVAILABLE");
  assert.equal(called, false);
});

