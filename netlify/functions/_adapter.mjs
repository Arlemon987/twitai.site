function parseBody(event) {
  if (event.body == null || event.body === "") return undefined;

  let raw = event.body;
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }

  const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"] || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      const error = new Error("Invalid JSON request body.");
      error.statusCode = 400;
      error.code = "INVALID_JSON";
      throw error;
    }
  }

  return raw;
}

export function adaptVercelHandler(handler) {
  return async function netlifyHandler(event) {
    const headersIn = Object.fromEntries(
      Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );

    const origin = headersIn.origin || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (event.httpMethod === "OPTIONS" || event.method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: corsHeaders,
        body: ""
      };
    }

    const rawUrl = event.rawUrl || `https://netlify.local${event.path || "/"}`;
    const url = new URL(rawUrl);

    const req = {
      method: event.httpMethod || event.method || "GET",
      headers: headersIn,
      body: parseBody(event),
      query: Object.fromEntries(url.searchParams.entries())
    };

    let statusCode = 200;
    let responseBody = null;
    let responseHeaders = { "Content-Type": "application/json; charset=utf-8" };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      setHeader(name, value) {
        responseHeaders[name] = value;
        return this;
      },
      json(value) {
        responseBody = value;
        return this;
      },
      send(value) {
        responseBody = value;
        return this;
      },
      end(value) {
        if (value !== undefined) responseBody = value;
        return this;
      }
    };

    try {
      await handler(req, res);

      const body = typeof responseBody === "string"
        ? responseBody
        : JSON.stringify(responseBody ?? { error: "Empty API response." });

      return {
        statusCode,
        headers: { ...corsHeaders, ...responseHeaders },
        body
      };
    } catch (error) {
      console.error("Netlify API adapter error:", error);
      return {
        statusCode: error.statusCode || 500,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: error.message || "Internal server error.",
          code: error.code || "INTERNAL_ERROR"
        })
      };
    }
  };
}
