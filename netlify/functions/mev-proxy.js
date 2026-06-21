const https = require("https");
const http = require("http");
const querystring = require("querystring");

const MEV_BASE = "https://mev.scba.gov.ar";

function makeRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        ...(options.headers || {}),
      },
    };

    if (postData) {
      reqOptions.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = lib.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function extractCookies(headers) {
  const setCookie = headers["set-cookie"];
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { action, username, password, sessionCookie, depto, organismo, caratula, expedienteUrl } = body;

    // ACTION: LOGIN
    if (action === "login") {
      const postData = querystring.stringify({
        LS_USUARIO: username,
        LS_PASSWORD: password,
        LS_DEPTO: depto || "0",
        LS_SUBMIT: "Ingresar",
      });

      const loginRes = await makeRequest(`${MEV_BASE}/loguin.asp`, {
        method: "POST",
      }, postData);

      const cookies = extractCookies(loginRes.headers);
      const location = loginRes.headers["location"] || "";
      const success = !loginRes.body.includes("Usuario o clave no válido") &&
        !loginRes.body.includes("no es un usuario válido") &&
        (location.includes("principal") || loginRes.status === 302 || cookies.length > 0);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success, cookies, location, status: loginRes.status }),
      };
    }

    // ACTION: GET DEPARTAMENTOS Y ORGANISMOS
    if (action === "get_organismos") {
      const res = await makeRequest(`${MEV_BASE}/organismos.asp?depto=${encodeURIComponent(depto)}`, {
        headers: { Cookie: sessionCookie },
      });

      // Extract organismos from HTML
      const matches = [...res.body.matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/gi)];
      const organismos = matches.map((m) => ({ value: m[1], label: m[2].trim() }))
        .filter((o) => o.value && o.value !== "0");

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, organismos }),
      };
    }

    // ACTION: BUSCAR POR CARATULA
    if (action === "buscar") {
      const postData = querystring.stringify({
        LS_CARATULA: caratula,
        LS_ORGANISMO: organismo,
        LS_DEPTO: depto,
        LS_SUBMIT: "Buscar",
      });

      const res = await makeRequest(`${MEV_BASE}/causas.asp`, {
        method: "POST",
        headers: { Cookie: sessionCookie },
      }, postData);

      // Parse results table
      const rows = [...res.body.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)];
      const expedientes = [];

      for (const row of rows) {
        const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        const link = row[0].match(/href="([^"]*expediente[^"]*)"/i);
        if (cells.length >= 3 && link) {
          const getText = (html) => html.replace(/<[^>]+>/g, "").trim();
          expedientes.push({
            caratula: getText(cells[0]?.[1] || ""),
            organismo: getText(cells[1]?.[1] || ""),
            expediente: getText(cells[2]?.[1] || ""),
            url: link[1].startsWith("http") ? link[1] : `${MEV_BASE}/${link[1].replace(/^\//, "")}`,
          });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, expedientes, raw: res.body.substring(0, 2000) }),
      };
    }

    // ACTION: OBTENER ULTIMO PROVEIDO
    if (action === "get_proveido") {
      const res = await makeRequest(expedienteUrl, {
        headers: { Cookie: sessionCookie },
      });

      const html = res.body;

      // Extract parte actora, demandado
      const caratulaMatch = html.match(/[Cc]ar[áa]tula[^:]*:\s*<[^>]+>([^<]+)/i) ||
        html.match(/<b>([^<]+c\.[^<]+)<\/b>/i);
      const caratulaText = caratulaMatch ? caratulaMatch[1].trim() : "";

      // Split actora/demandado
      const partes = caratulaText.split(/\s+c\.?\s+/i);
      const parteActora = partes[0]?.trim() || caratulaText;
      const demandado = partes[1]?.trim() || "";

      // Extract expediente number
      const expMatch = html.match(/[Ee]xpediente[^:]*:\s*<[^>]+>([^<]+)/i) ||
        html.match(/N[°º]\s*(\d[\d\-\/]+)/i);
      const numExpediente = expMatch ? expMatch[1].trim() : "";

      // Extract jurisdiccion/juzgado
      const juzgadoMatch = html.match(/[Jj]uzgado[^:]*:\s*<[^>]+>([^<]+)/i) ||
        html.match(/[Oo]rganismo[^:]*:\s*<[^>]+>([^<]+)/i);
      const juzgado = juzgadoMatch ? juzgadoMatch[1].trim() : organismo || "";

      // Extract all proveidos/movimientos - get the LAST one
      const proveidos = [...html.matchAll(
        /<tr[^>]*>[\s\S]*?(?:proveído|proveido|resolución|decreto|auto)[^<]*[\s\S]*?<\/tr>/gi
      )];

      // Try to get rows from the main table
      const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi);
      let ultimoMovimiento = "";
      let ultimoTexto = "";

      if (tableMatch) {
        for (const table of tableMatch.reverse()) {
          const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
          if (rows.length > 1) {
            const lastRow = rows[rows.length - 1];
            const cells = [...lastRow[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
            if (cells.length >= 2) {
              const getText = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
              ultimoMovimiento = getText(cells[0]?.[1] || "");
              ultimoTexto = getText(cells[cells.length - 1]?.[1] || "");
              if (ultimoTexto.length > 10) break;
            }
          }
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            parteActora,
            demandado,
            jurisdiccion: depto || "",
            juzgado,
            expediente: numExpediente,
            movimiento: ultimoMovimiento,
            textoProveido: ultimoTexto,
          },
          raw: html.substring(0, 3000),
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Acción no válida" }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
