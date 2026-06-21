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
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
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
  if (!existing) return newCookies;
  if (!newCookies) return existing;
  const map = {};
  [...existing.split("; "), ...newCookies.split("; ")].forEach(c => {
    const [k, v] = c.split("=");
    if (k && v) map[k.trim()] = v.trim();
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  try {
    const body = JSON.parse(event.body || "{}");
    const { action, username, password, sessionCookie, depto, organismo, caratula, expedienteUrl } = body;

    // ── ACTION: LOGIN ──
    if (action === "login") {
      // Step 1: GET login page to get initial cookies
      const loginPage = await makeRequest(`${MEV_BASE}/loguin.asp?familiadepto`, { method: "GET" });
      let cookies = extractCookies(loginPage.headers);

      // Step 2: POST credentials con parametros reales de MEV
      const postData = querystring.stringify({
        usuario: username,
        clave: password,
        DeptoRegistrado: "aa",
      });

      const loginRes = await makeRequest(`${MEV_BASE}/loguin.asp?familiadepto`, {
        method: "POST",
        headers: { 
          Cookie: cookies,
          Referer: `${MEV_BASE}/loguin.asp?familiadepto`,
        },
      }, postData);

      const newCookies = extractCookies(loginRes.headers);
      cookies = mergeCookies(cookies, newCookies);
      const location = loginRes.headers["location"] || "";
      
      // Step 3: Follow redirect if needed
      if (loginRes.status === 302 && location) {
        const redirectUrl = location.startsWith("http") ? location : `${MEV_BASE}/${location.replace(/^\//, "")}`;
        const redirectRes = await makeRequest(redirectUrl, { headers: { Cookie: cookies } });
        const moreCookies = extractCookies(redirectRes.headers);
        cookies = mergeCookies(cookies, moreCookies);
        
        const success = !redirectRes.body.includes("no es un usuario") && 
                        !redirectRes.body.includes("Usuario o clave no válido") &&
                        redirectRes.status === 200;
        return { statusCode: 200, headers, body: JSON.stringify({ success, cookies }) };
      }

      const success = !loginRes.body.includes("no es un usuario") && 
                      !loginRes.body.includes("Usuario o clave no válido") &&
                      (loginRes.status === 302 || cookies.length > 10);

      return { statusCode: 200, headers, body: JSON.stringify({ success, cookies }) };
    }

    // ── ACTION: BUSCAR (usando la URL real de MEV) ──
    if (action === "buscar") {
      // Primero necesitamos obtener el Set y JuzgadoElegido del organismo
      // Hacemos GET a la página principal para obtener los sets disponibles
      const mainPage = await makeRequest(`${MEV_BASE}/MuestraCausas.asp`, {
        headers: { 
          Cookie: sessionCookie,
          Referer: `${MEV_BASE}/`,
        },
      });

      // Extraer los sets disponibles del HTML
      const setMatches = [...mainPage.body.matchAll(/value="(\d+)"[^>]*>([^<]+Set[^<]*|[^<]*)<\/option>/gi)];
      
      // Usar el primer set disponible o buscar uno específico
      let setId = "";
      let juzgadoId = "";
      
      const setMatch = mainPage.body.match(/name="Set"[^>]*value="(\d+)"/i) ||
                       mainPage.body.match(/<option[^>]*value="(\d+)"[^>]*selected/i);
      if (setMatch) setId = setMatch[1];

      const juzgadoMatch = mainPage.body.match(/name="JuzgadoElegido"[^>]*value="([^"]+)"/i) ||
                           mainPage.body.match(/JuzgadoElegido[^>]*value="([^"]+)"/i);
      if (juzgadoMatch) juzgadoId = juzgadoMatch[1];

      // POST búsqueda con los parámetros reales de MEV
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
      
      const postData = querystring.stringify({
        OpcionBusqueda: "0",
        busca: caratula,
        JuzgadoElegido: juzgadoId || "",
        radio: "xCa",
        caratula: caratula,
        NCausa: "",
        NInterno: "",
        Set: setId || "",
        Desde: "01/01/2020",
        Hasta: dateStr,
        SetNovedades: "",
        TipoCausa: "",
        Buscar: "Buscar",
      });

      const searchRes = await makeRequest(`${MEV_BASE}/Busqueda.asp`, {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Referer: `${MEV_BASE}/MuestraCausas.asp`,
        },
      }, postData);

      // Follow redirect to MuestraCausas.asp
      let resultHtml = searchRes.body;
      let resultCookies = mergeCookies(sessionCookie, extractCookies(searchRes.headers));
      
      if (searchRes.status === 302) {
        const loc = searchRes.headers["location"] || "";
        const resultUrl = loc.startsWith("http") ? loc : `${MEV_BASE}/${loc.replace(/^\//, "")}`;
        const resultRes = await makeRequest(resultUrl, {
          headers: { 
            Cookie: resultCookies,
            Referer: `${MEV_BASE}/Busqueda.asp`,
          },
        });
        resultHtml = resultRes.body;
        resultCookies = mergeCookies(resultCookies, extractCookies(resultRes.headers));
      }

      // Parse expedientes from result HTML
      const expedientes = [];
      const rows = [...resultHtml.matchAll(/<tr[^>]*class="[^"]*(?:FilaC|FilaS|fila)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)];
      
      for (const row of rows) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        const link = row[0].match(/href="([^"]*(?:MuestraExpediente|expediente)[^"]*)"/i) ||
                     row[0].match(/href="([^"]+\.asp[^"]*)"/i);
        
        if (cells.length >= 2) {
          const getText = (html) => (html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          const caratulaText = getText(cells[0]?.[1] || "");
          if (caratulaText && caratulaText.length > 3) {
            expedientes.push({
              caratula: caratulaText,
              organismo: getText(cells[1]?.[1] || ""),
              expediente: getText(cells[2]?.[1] || ""),
              url: link ? (link[1].startsWith("http") ? link[1] : `${MEV_BASE}/${link[1].replace(/^\//, "")}`) : "",
            });
          }
        }
      }

      // Si no encontró con clases, buscar tabla general
      if (!expedientes.length) {
        const tableMatch = resultHtml.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
        for (const table of tableMatch) {
          const tRows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
          for (const row of tRows.slice(1)) {
            const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
            const link = row[0].match(/href="([^"]+)"/i);
            if (cells.length >= 2) {
              const getText = (html) => (html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
              const caratulaText = getText(cells[0]?.[1] || "");
              if (caratulaText && caratulaText.length > 5 && link) {
                expedientes.push({
                  caratula: caratulaText,
                  organismo: getText(cells[1]?.[1] || ""),
                  expediente: getText(cells[2]?.[1] || ""),
                  url: link[1].startsWith("http") ? link[1] : `${MEV_BASE}/${link[1].replace(/^\//, "")}`,
                });
              }
            }
          }
        }
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ 
          success: true, 
          expedientes,
          cookies: resultCookies,
          raw: resultHtml.substring(0, 3000),
        }),
      };
    }

    // ── ACTION: GET PROVEIDO ──
    if (action === "get_proveido") {
      const res = await makeRequest(expedienteUrl, {
        headers: { 
          Cookie: sessionCookie,
          Referer: `${MEV_BASE}/MuestraCausas.asp`,
        },
      });

      const html = res.body;
      const getText = (h) => (h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      // Extraer carátula
      const caratulaMatch = html.match(/car[áa]tula[^:]*:?\s*<[^>]*>([^<]+)/i) ||
                            html.match(/<b>([^<]{10,}c\.[^<]+)<\/b>/i) ||
                            html.match(/class="[^"]*titulo[^"]*"[^>]*>([^<]+)/i);
      const caratulaFull = caratulaMatch ? getText(caratulaMatch[1]) : "";
      const partes = caratulaFull.split(/\s+c\.?\s+/i);
      const parteActora = partes[0]?.trim() || "";
      const demandado = partes[1]?.trim() || "";

      // Extraer número expediente
      const expMatch = html.match(/expediente[^:]*:?\s*<[^>]*>([^<]+)/i) ||
                       html.match(/N[°º]\s*([\d\-\/]+)/i);
      const numExpediente = expMatch ? getText(expMatch[1]) : "";

      // Extraer juzgado/organismo
      const juzgadoMatch = html.match(/(?:juzgado|organismo|tribunal)[^:]*:?\s*<[^>]*>([^<]+)/i);
      const juzgado = juzgadoMatch ? getText(juzgadoMatch[1]) : organismo || "";

      // Extraer ÚLTIMO movimiento/proveído
      // MEV muestra movimientos en una tabla - el último es el más nuevo
      let ultimoMovimiento = "";
      let ultimoTexto = "";
      let ultimaFecha = "";

      // Buscar tabla de movimientos
      const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
      
      for (const table of tables.reverse()) {
        const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        if (rows.length >= 2) {
          // El último row con contenido
          for (let i = rows.length - 1; i >= 0; i--) {
            const cells = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
            if (cells.length >= 2) {
              const c0 = getText(cells[0]?.[1] || "");
              const c1 = getText(cells[1]?.[1] || "");
              const c2 = getText(cells[2]?.[1] || "");
              const last = getText(cells[cells.length-1]?.[1] || "");
              
              // Buscar fecha (formato dd/mm/yyyy)
              if (c0.match(/\d{2}\/\d{2}\/\d{4}/) && last.length > 5) {
                ultimaFecha = c0;
                ultimoMovimiento = c1 || c2;
                ultimoTexto = last;
                break;
              }
            }
          }
          if (ultimoTexto) break;
        }
      }

      // Si no encontró con fecha, tomar última fila con contenido
      if (!ultimoTexto) {
        for (const table of tables) {
          const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
          const lastRows = rows.slice(-3);
          for (const row of lastRows.reverse()) {
            const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
            if (cells.length >= 2) {
              const texts = cells.map(c => getText(c[1])).filter(t => t.length > 3);
              if (texts.length >= 2) {
                ultimoMovimiento = texts[texts.length - 2] || "";
                ultimoTexto = texts[texts.length - 1] || "";
                break;
              }
            }
          }
          if (ultimoTexto) break;
        }
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          data: {
            parteActora: parteActora || caratulaFull,
            demandado,
            jurisdiccion: depto || "",
            juzgado,
            expediente: numExpediente,
            movimiento: ultimoMovimiento,
            textoProveido: ultimoTexto,
            fecha: ultimaFecha,
          },
          raw: html.substring(0, 4000),
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Acción no válida" }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, stack: err.stack }) };
  }
};