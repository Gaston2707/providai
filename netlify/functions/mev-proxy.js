const https = require("https");
const querystring = require("querystring");

const MEV_BASE = "https://mev.scba.gov.ar";

function makeRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
        ...(options.headers || {}),
      },
    };
    if (postData) {
      reqOptions.headers["Content-Type"] = "application/x-www-form-urlencoded";
      reqOptions.headers["Content-Length"] = Buffer.byteLength(postData);
    }
    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error("Timeout")); });
    if (postData) req.write(postData);
    req.end();
  });
}

function extractCookies(headers) {
  const setCookie = headers["set-cookie"];
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

function mergeCookies(existing, newCookies) {
  if (!existing && !newCookies) return "";
  if (!existing) return newCookies || "";
  if (!newCookies) return existing || "";
  const map = {};
  [...existing.split("; "), ...newCookies.split("; ")].forEach(c => {
    const idx = c.indexOf("=");
    if (idx > 0) {
      const k = c.substring(0, idx).trim();
      const v = c.substring(idx + 1).trim();
      if (k) map[k] = v;
    }
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

function getText(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function doLogin(username, password, depto) {
  // PASO 1: GET login
  const step1 = await makeRequest(`${MEV_BASE}/loguin.asp`, { method: "GET" });
  let cookies = extractCookies(step1.headers);

  // PASO 2: POST credenciales
  const loginData = querystring.stringify({
    usuario: username,
    clave: password,
    DeptoRegistrado: "aa",
  });
  const step2 = await makeRequest(`${MEV_BASE}/loguin.asp`, {
    method: "POST",
    headers: { Cookie: cookies, Referer: `${MEV_BASE}/loguin.asp` },
  }, loginData);
  cookies = mergeCookies(cookies, extractCookies(step2.headers));

  if (step2.body.includes("clave incorrecta") || step2.body.includes("no es un usuario")) {
    return { success: false, cookies: "" };
  }

  // Seguir redirect
  if (step2.status === 302) {
    const loc = step2.headers["location"] || "";
    const url = loc.startsWith("http") ? loc : `${MEV_BASE}/${loc.replace(/^\//, "")}`;
    const r = await makeRequest(url, { headers: { Cookie: cookies } });
    cookies = mergeCookies(cookies, extractCookies(r.headers));
  }

  // PASO 3: POST departamento → POSLoguin.asp
  const deptoData = querystring.stringify({
    TipoDto: "CC",
    DtoJudElegido: depto || "80",
    Aceptar: "Aceptar",
  });
  const step3 = await makeRequest(`${MEV_BASE}/POSLoguin.asp`, {
    method: "POST",
    headers: { Cookie: cookies, Referer: `${MEV_BASE}/loguin.asp` },
  }, deptoData);
  cookies = mergeCookies(cookies, extractCookies(step3.headers));

  // Seguir redirect a MuestraCausas
  const loc3 = step3.headers["location"] || "";
  const muestraUrl = loc3
    ? (loc3.startsWith("http") ? loc3 : `${MEV_BASE}/${loc3.replace(/^\//, "")}`)
    : `${MEV_BASE}/MuestraCausas.asp?radio=xCa&pOrden=xCa&pOrdenAD=Asc`;

  const step3b = await makeRequest(muestraUrl, {
    headers: { Cookie: cookies, Referer: `${MEV_BASE}/POSLoguin.asp` }
  });
  cookies = mergeCookies(cookies, extractCookies(step3b.headers));

  return { success: true, cookies, muestraHtml: step3b.body };
}

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  try {
    const body = JSON.parse(event.body || "{}");
    const { action, username, password, depto, caratula, expedienteUrl } = body;

    // ══════════════════════════════════════════
    // ACTION: LOGIN (verificar credenciales)
    // ══════════════════════════════════════════
    if (action === "login") {
      const result = await doLogin(username, password, depto || "80");
      return {
        statusCode: 200, headers: corsHeaders,
        body: JSON.stringify({ success: result.success, cookies: result.cookies }),
      };
    }

    // ══════════════════════════════════════════
    // ACTION: BUSCAR (login + buscar en uno)
    // ══════════════════════════════════════════
    if (action === "buscar") {
      // Login completo
      const loginResult = await doLogin(username, password, depto);
      if (!loginResult.success) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Login fallido" }) };
      }
      let cookies = loginResult.cookies;

      // POST búsqueda
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;

      const searchData = querystring.stringify({
        OpcionBusqueda: "0",
        busca: caratula,
        JuzgadoElegido: "",
        radio: "xCa",
        caratula: caratula,
        NCausa: "",
        NInterno: "",
        Set: "",
        Desde: "01/01/2020",
        Hasta: dateStr,
        SetNovedades: "",
        TipoCausa: "Am",
        Buscar: "Buscar",
      });

      const searchRes = await makeRequest(`${MEV_BASE}/Busqueda.asp`, {
        method: "POST",
        headers: { Cookie: cookies, Referer: `${MEV_BASE}/MuestraCausas.asp` },
      }, searchData);
      cookies = mergeCookies(cookies, extractCookies(searchRes.headers));

      // Seguir redirect a resultados
      let resultHtml = searchRes.body;
      if (searchRes.status === 302) {
        const loc = searchRes.headers["location"] || "";
        const resultUrl = loc.startsWith("http") ? loc : `${MEV_BASE}/${loc.replace(/^\//, "")}`;
        const resultRes = await makeRequest(resultUrl, {
          headers: { Cookie: cookies, Referer: `${MEV_BASE}/Busqueda.asp` }
        });
        cookies = mergeCookies(cookies, extractCookies(resultRes.headers));
        resultHtml = resultRes.body;
      }

      // Parsear expedientes de la tabla de resultados
      const expedientes = [];
      const rows = [...resultHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const row of rows) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        const link = row[0].match(/href="([^"]*procesales[^"]*)"/i) ||
                     row[0].match(/href="([^"]*nidCausa[^"]*)"/i) ||
                     row[0].match(/href="([^"]+\.asp[^"]*)"/i);
        if (cells.length >= 2 && link) {
          const caratulaText = getText(cells[0]?.[1] || "");
          if (caratulaText.length > 5 && (caratulaText.includes("/") || caratulaText.includes("c."))) {
            const href = link[1];
            const fullUrl = href.startsWith("http") ? href : `${MEV_BASE}/${href.replace(/^\//, "")}`;
            expedientes.push({
              caratula: caratulaText,
              organismo: getText(cells[1]?.[1] || ""),
              expediente: getText(cells[2]?.[1] || ""),
              fecha: getText(cells[3]?.[1] || ""),
              url: fullUrl,
            });
          }
        }
      }

      return {
        statusCode: 200, headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          expedientes,
          cookies,
          isLoginPage: resultHtml.includes("DeptoRegistrado"),
          raw: resultHtml.substring(0, 500),
        }),
      };
    }

    // ══════════════════════════════════════════
    // ACTION: GET PROVEIDO (login + ir al proveído)
    // ══════════════════════════════════════════
    if (action === "get_proveido") {
      // Login completo
      const loginResult = await doLogin(username, password, depto);
      if (!loginResult.success) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, error: "Login fallido" }) };
      }
      let cookies = loginResult.cookies;

      // GET página del expediente (procesales.asp)
      const expRes = await makeRequest(expedienteUrl, {
        headers: { Cookie: cookies, Referer: `${MEV_BASE}/MuestraCausas.asp` }
      });
      cookies = mergeCookies(cookies, extractCookies(expRes.headers));
      const expHtml = expRes.body;

      // Extraer datos del expediente
      const caratulaMatch = expHtml.match(/Car[áa]tula[^<]*<[^>]+>\s*([^<]+)/i);
      const caratulaFull = caratulaMatch ? caratulaMatch[1].trim() : "";
      const partes = caratulaFull.split(/\s+C\/\s+/i);
      const parteActora = partes[0]?.trim() || "";
      const demandadoRaw = partes.slice(1).join(" C/ ") || "";
      const demandado = demandadoRaw.replace(/\s+S\/.*$/i, "").trim();

      const expNumMatch = expHtml.match(/N[°º]\s*de\s*Expediente[^<]*<[^>]+>\s*([^<]+)/i) ||
                          expHtml.match(/Expediente[^<]*<[^>]+>\s*([^<]+)/i);
      const numExpediente = expNumMatch ? expNumMatch[1].trim() : "";

      // Buscar el link al último proveído (primer link con "proveido.asp")
      const provLinks = [...expHtml.matchAll(/href="([^"]*proveido\.asp[^"]*)"/gi)];
      
      let textoProveido = "";
      let ultimoMovimiento = "";
      let ultimaFecha = "";
      let juzgado = "";

      // Extraer juzgado del header
      const juzgadoMatch = expHtml.match(/CAMARA[^<]{0,100}/i) || expHtml.match(/JUZGADO[^<]{0,100}/i);
      if (juzgadoMatch) juzgado = juzgadoMatch[0].trim();

      // Extraer último movimiento de la tabla de pasos procesales
      const rows = [...expHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const row of rows) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        if (cells.length >= 2) {
          const fecha = getText(cells[0]?.[1] || "");
          if (fecha.match(/\d{2}\/\d{2}\/\d{4}/)) {
            ultimaFecha = fecha;
            ultimoMovimiento = getText(cells[cells.length - 1]?.[1] || "");
            break;
          }
        }
      }

      // Obtener texto del proveído del primer link encontrado
      if (provLinks.length > 0) {
        const provHref = provLinks[0][1];
        const provUrl = provHref.startsWith("http") ? provHref : `${MEV_BASE}/${provHref.replace(/^\//, "")}`;
        
        const provRes = await makeRequest(provUrl, {
          headers: { Cookie: cookies, Referer: expedienteUrl }
        });

        // Extraer texto entre las líneas rojas de MEV
        const provHtml = provRes.body;
        const textMatch = provHtml.match(/Para copiar y pegar[\s\S]*?desde aqu[íi][^-]*-+([\s\S]*?)-+[\s\S]*?Para copiar y pegar[\s\S]*?hasta aqu[íi]/i);
        if (textMatch) {
          textoProveido = getText(textMatch[1]);
        } else {
          // Fallback: buscar sección "Texto del Proveido"
          const secMatch = provHtml.match(/Texto del Prove[íi]do[\s\S]*?<\/table>/i);
          if (secMatch) textoProveido = getText(secMatch[0]);
          else textoProveido = getText(provHtml).substring(0, 2000);
        }
      }

      return {
        statusCode: 200, headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            parteActora,
            demandado,
            jurisdiccion: depto || "",
            juzgado,
            expediente: numExpediente,
            movimiento: ultimoMovimiento,
            textoProveido,
            fecha: ultimaFecha,
          },
        }),
      };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Acción no válida" }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message, stack: err.stack }) };
  }
};