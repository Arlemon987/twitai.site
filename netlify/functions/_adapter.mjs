function toHeaderObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

async function parseBody(request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const raw = await request.text();
  if (!raw) return undefined;

  const contentType = request.headers.get("content-type") || "";
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

function makeResponse(body, status, headers) {
  const responseBody =
    body === undefined || body === null
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);

  // The Fetch Response API forbids a body for these status codes.
  const finalBody = [204, 205, 304].includes(status)
    ? null
    : responseBody;

  return new Response(finalBody, {
    status,
    headers
  });
}

export function adaptVercelHandler(handler) {
  return async function netlifyHandler(request, context) {
    const headersIn = toHeaderObject(request.headers);
    const origin = headersIn.origin || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    const req = {
      method: request.method,
      headers: headersIn,
      body: undefined,
      query: Object.fromEntries(url.searchParams.entries())
    };

    let statusCode = 200;
    let responseBody;
    let responseHeaders = {
      "Content-Type": "application/json; charset=utf-8"
    };

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
      req.body = await parseBody(request);
      await handler(req, res);

      return makeResponse(
        responseBody === undefined
          ? { error: "Empty API response." }
          : responseBody,
        statusCode,
        { ...corsHeaders, ...responseHeaders }
      );
    } catch (error) {
      console.error("Netlify API adapter error:", error);

      return makeResponse(
        {
          error: error.message || "Internal server error.",
          code: error.code || "INTERNAL_ERROR"
        },
        error.statusCode || 500,
        {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      );
    }
  };
}
