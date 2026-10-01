import { app } from "@azure/functions";
import { engine } from "../lib/engine.js";

app.http("alternative", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    if (request.method === "GET") {
      return {
        jsonBody: {
          status: "OK",
          version: "11.0.0",
          mode: "discover-successor-and-validate",
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

    const result = await engine(query);
    const { httpStatus = 200, ...jsonBody } = result;
    return { status: httpStatus, jsonBody };
  },
});
