import { app } from "@azure/functions";
import { engine } from "../lib/engine.js";
import { enrichWithLuminaireConfiguratorV2 } from "../lib/luminaire-configurator-v2.js";

app.http("alternative", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    if (request.method === "GET") {
      return {
        jsonBody: {
          status: "OK",
          version: "27.0.0",
          mode: "single-pipeline-current-family-configit",
        },
      };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        jsonBody: { status: "ERROR", message: "Invalid JSON request." },
      };
    }

    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query || query.length > 500) {
      return {
        status: 400,
        jsonBody: {
          status: "NEEDS_REVIEW",
          message: query ? "The reference is too long." : "Enter a Signify reference or 12NC.",
        },
      };
    }

    const baseResult = await engine(query);
    const result = await enrichWithLuminaireConfiguratorV2(baseResult);
    const { httpStatus = 200, ...jsonBody } = result;
    return { status: httpStatus, jsonBody };
  },
});
