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

test("bootstraps DN610BI and returns the exact 930UE plus PSD-E configuration", async () => {
  const responses = [
    {
      configId: "generated-session",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "selected" },
        { variableName: "v.colour", valueName: "930", state: "selectable" },
        { variableName: "v.colour", valueName: "930UE", state: "selectable" },
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
        { variableName: "v.colour", valueName: "930", state: "selectable" },
        { variableName: "v.colour", valueName: "930UE", state: "userSelected" },
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
      commercialDescription: "DN610B 40S/930UE PSD-E C WH PGO",
      options: [
        { variableName: "v.light_package", valueName: "LED40S", state: "userSelected" },
        { variableName: "v.colour", valueName: "930UE", state: "userSelected" },
        { variableName: "v.distribution", valueName: "C", state: "userSelected" },
        { variableName: "v.finish", valueName: "WH", state: "userSelected" },
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
    configuratorId: "DN610BI",
    familyCode: "DN610B",
    sourceControlClass: "ON_OFF",
    targetControlClass: "DALI",
    requirements: parseReference("DN571B LED40S/930H PSU-E C WH PGO"),
  });
  assert.equal(result.validated, true);
  assert.equal(result.description, "DN610B 40S/930UE PSD-E C WH PGO");
  assert.deepEqual(result.appliedRequirements, ["package", "color", "feature-0", "feature-1", "feature-2"]);
  assert.equal(bodies[0].newAssignment.assignment.valueName, "SIG");
  assert.deepEqual(bodies[0].existingAssignments, []);
  assert.equal(bodies.flatMap((body) => body.existingAssignments).some((entry) => entry.valueName === "[Other values]"), false);
  assert.equal(bodies[1].newAssignment.assignment.valueName, "930UE");
  assert.equal(bodies.at(-1).newAssignment.assignment.valueName, "PSD-E");
});

test("retries DN610BI bootstrap with valid internal baselines and a fresh session id", async () => {
  const bodies = [];
  const client = new ConfiguratorApiClient({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (bodies.length === 1) return jsonResponse({ message: "first shape rejected" }, 500);
      return jsonResponse({
        configId: "official-session",
        options: [{ variableName: "Product_Variant.PLM_PFC", valueName: "DN610B", state: "selected" }],
      });
    },
  });
  const session = await client.bootstrap("DN610BI", "DN610B");
  assert.equal(session.configId, "official-session");
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0].configId, bodies[1].configId);
  assert.equal(bodies[1].newAssignment.assignment.variableName, "Internal.SPADACTIVE");
  assert.equal(bodies[1].newAssignment.assignment.valueName, "1");
  assert.equal(JSON.stringify(bodies).includes("[Other values]"), false);
});


test("continues the same live session to select a family exposed after generic bootstrap", async () => {
  const bodies = [];
  const client = new ConfiguratorApiClient({ fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (bodies.length === 1) return jsonResponse({ configId: "live-session", variables: [{ variableName: "Product_Variant.PLM_PFC", values: [{ valueName: "ZZ100B", state: "selectable" }, { valueName: "ZZ200B", state: "selectable" }] }] });
    return jsonResponse({ configId: "live-session", options: [{ variableName: "Product_Variant.PLM_PFC", valueName: "ZZ200B", state: "userSelected" }] });
  }});
  const session = await client.bootstrap("ZZ200BI", "ZZ200B");
  assert.equal(session.configId, "live-session"); assert.equal(bodies.length, 2);
  assert.equal(bodies[0].newAssignment.assignment.valueName, "SIG");
  assert.equal(bodies[1].configId, "live-session"); assert.equal(bodies[1].newAssignment.assignment.valueName, "ZZ200B");
});
