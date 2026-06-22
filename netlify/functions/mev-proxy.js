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
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
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
  if (!existing) return newCookies;
  if (!newCookies) return existing;
  const map = {};
  [...existing.split("; "), ...newCookies.split("; ")].forEach(c => {
    const [k, ...rest] = c.split("=");
    if (k && rest.length) map[k.trim()] = rest.join("=").trim();
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

function getText(html) {
  return (html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
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
    const { action, username, password, sessionCookie, depto, caratula, expedienteUrl } = body;

    // ══════════════════════════════════════════
    // ACTION: LOGIN (3 pasos reales de MEV)
    // ══════════════════════════════════════════
    if (action === "login") {
      // PASO 1: GET página login → obtener cookie inicial
      const step1 = await makeRequest(`${MEV_BASE}/loguin.asp`, { method: "GET" });
      let cookies = extractCookies(step1.headers);

      // PASO 2: POST credenciales → loguin.asp
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

      // Verificar si el login fue exitoso
      const loginFailed = step2.body.includes("clave incorrecta") ||
                          step2.body.includes("no es un usuario") ||
                          step2.body.includes("Usuario o clave");

      if (loginFailed) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, cookies: "" }) };
      }

      // Seguir redirect si hay
      let mainHtml = step2.body;
      if (step2.status === 302) {
        const loc = step2.headers["location"] || "";
        const redirectUrl = loc.startsWith("http") ? loc : `${MEV_BASE}/${loc.replace(/^\//, "")}`;
        const step2b = await makeRequest(redirectUrl, { headers: { Cookie: cookies } });
        cookies = mergeCookies(cookies, extractCookies(step2b.headers));
        mainHtml = step2b.body;
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

      // Seguir redirect a MuestraCausas.asp
      let muestraHtml = step3.body;
      if (step3.status === 302) {
        const loc = step3.headers["location"] || "MuestraCausas.asp?radio=xCa&pOrden=xCa&pOrdenAD=Asc";
        const redirectUrl = loc.startsWith("http") ? loc : `${MEV_BASE}/${loc.replace(/^\//, "")}`;
        const step3b = await makeRequest(redirectUrl, { headers: { Cookie: cookies, Referer: `${MEV_BASE}/POSLoguin.asp` } });
        cookies = mergeCookies(cookies, extractCookies(step3b.headers));
        muestraHtml = step3b.body;
      } else {
        // Si no hubo redirect, ir directamente a MuestraCausas
        const step3b = await makeRequest(`${MEV_BASE}/MuestraCausas.asp?radio=xCa&pOrden=xCa&pOrdenAD=Asc`, {
          headers: { Cookie: cookies, Referer: `${MEV_BASE}/POSLoguin.asp` }
        });
        cookies = mergeCookies(cookies, extractCookies(step3b.headers));
        muestraHtml = step3b.body;
      }

      // Extraer JuzgadoElegido del HTML de MuestraCausas
      const juzgadoMatch = muestraHtml.match(/name="JuzgadoElegido"[^>]*value="([^"]+)"/i) ||
                           muestraHtml.match(/JuzgadoElegido[^>]*value="([^"]+)"/i) ||
                           muestraHtml.match(/value="([A-Z]{2,4}\d+)"/);
      const juzgadoElegido = juzgadoMatch ? juzgadoMatch[1] : "";

      // Extraer Set del HTML
      const setMatch = muestraHtml.match(/name="Set"[^>]*value="(\d+)"/i) ||
                       muestraHtml.match(/<option[^>]*value="(\d+)"[^>]*selected/i);
      const setId = setMatch ? setMatch[1] : "";

      const success = muestraHtml.includes("MuestraCausas") || 
                      muestraHtml.includes("UsuarioMEV") ||
                      muestraHtml.includes("Buscar") ||
                      cookies.length > 10;

      return {
        statusCode: 200, headers: corsHeaders,
        body: JSON.stringify({ success, cookies, juzgadoElegido, setId }),
      };
    }

    // ══════════════════════════════════════════
    // ACTION: BUSCAR
    // ══════════════════════════════════════════
    if (action === "buscar") {
      const { juzgadoElegido, setId } = body;

      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;

      // Primero GET MuestraCausas para obtener JuzgadoElegido y Set reales
      const muestraRes = await makeRequest(`${MEV_BASE}/MuestraCausas.asp?radio=xCa&pOrden=xCa&pOrdenAD=Asc`, {
        headers: { Cookie: sessionCookie, Referer: `${MEV_BASE}/POSLoguin.asp` },
      });
      const muestraHtml = muestraRes.body;
      
      // Extraer JuzgadoElegido del select
      const juzMatch = muestraHtml.match(/name="JuzgadoElegido"[^>]*value="([^"]+)"/i) ||
                       muestraHtml.match(/id="JuzgadoElegido"[^>]*value="([^"]+)"/i) ||
                       muestraHtml.match(/<option[^>]*selected[^>]*value="([A-Z]{2,4}\d+)"/i) ||
                       muestraHtml.match(/value="([A-Z]{2,4}\d{3,})"/);
      const realJuzgado = juzMatch ? juzMatch[1] : (juzgadoElegido || "");
      
      // Extraer Set
      const setMatch = muestraHtml.match(/name="Set"[^>]*value="(\d+)"/i) ||
                       muestraHtml.match(/id="Set"[^>]*value="(\d+)"/i) ||
                       muestraHtml.match(/<option[^>]*value="(\d{5,})"/i);
      const realSet = setMatch ? setMatch[1] : (setId || "");

      const searchData = querystring.stringify({
        OpcionBusqueda: "0",
        busca: caratula,
        JuzgadoElegido: realJuzgado,
        radio: "xCa",
        caratula: caratula,
        NCausa: "",
        NInterno: "",
        Set: realSet,
        Desde: "01/01/2020",
        Hasta: dateStr,
        SetNovedades: "",
        TipoCausa: "Am",
        Buscar: "Buscar",
      });

      const searchRes = await makeRequest(`${MEV_BASE}/Busqueda.asp`, {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Referer: `${MEV_BASE}/MuestraCausas.asp`,
        },
      }, searchData);

      let resultHtml = searchRes.body;
      let resultCookies = mergeCookies(sessionCookie, extractCookies(searchRes.headers));

      if (searchRes.status === 302) {
        const loc = searchRes.headers["location"] || "";
        const resultUrl = loc.startsWith("http") ? loc : `${MEV_BASE}/${loc.replace(/^\//, "")}`;
        const resultRes = await makeRequest(resultUrl, {
          headers: { Cookie: resultCookies, Referer: `${MEV_BASE}/Busqueda.asp` },
        });
        resultHtml = resultRes.body;
        resultCookies = mergeCookies(resultCookies, extractCookies(resultRes.headers));
      }

      // Parsear expedientes
      const expedientes = [];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;

      while ((rowMatch = rowRegex.exec(resultHtml)) !== null) {
        const row = rowMatch[1];
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        const link = row.match(/href="([^"]+)"/i);

        if (cells.length >= 3 && link) {
          const caratulaText = getText(cells[0]?.[1] || "");
          if (caratulaText.length > 5 && caratulaText.includes("/")) {
            const href = link[1];
            const fullUrl = href.startsWith("http") ? href : `${MEV_BASE}/${href.replace(/^\//, "")}`;
            expedientes.push({
              caratula: caratulaText,
              organismo: getText(cells[1]?.[1] || ""),
              expediente: getText(cells[2]?.[1] || ""),
              fecha: getText(cells[3]?.[1] || ""),
              ultimo: getText(cells[4]?.[1] || ""),
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
          cookies: resultCookies,
          muestraStatus: muestraRes.status,
          muestraIsLogin: muestraHtml.includes("DeptoRegistrado"),
          realJuzgado,
          realSet,
          raw: resultHtml.substring(0, 2000),
        }),
      };
    }

    // ══════════════════════════════════════════
    // ACTION: GET PROVEIDO
    // ══════════════════════════════════════════
    if (action === "get_proveido") {
      const res = await makeRequest(expedienteUrl, {
        headers: { Cookie: sessionCookie, Referer: `${MEV_BASE}/MuestraCausas.asp` },
      });

      const html = res.body;

      // Extraer carátula
      const caratulaMatch = html.match(/Car[áa]tula:\s*<\/[^>]+>\s*([^<]+)/i) ||
                            html.match(/Car[áa]tula[^<]*<[^>]+>\s*([^<]+)/i);
      const caratulaFull = caratulaMatch ? caratulaMatch[1].trim() : "";
      const partes = caratulaFull.split(/\s+C\/\s+/i);
      const parteActora = partes[0]?.trim() || "";
      const demandado = partes.slice(1).join(" C/ ").replace(/\s+S\/.*$/i, "").trim() || "";

      // Extraer expediente
      const expMatch = html.match(/N[°º]\s*de\s*Expediente[^<]*<[^>]+>\s*([^<]+)/i) ||
                       html.match(/Expediente:\s*<[^>]+>\s*([^<]+)/i);
      const numExpediente = expMatch ? expMatch[1].trim() : "";

      // Extraer juzgado
      const juzgadoMatch = html.match(/CAMARA[^<]*/i) || html.match(/JUZGADO[^<]*/i);
      const juzgado = juzgadoMatch ? juzgadoMatch[0].trim() : "";

      // Buscar tabla de Pasos Procesales - el PRIMERO es el más nuevo
      let ultimoMovimiento = "";
      let ultimoTexto = "";
      let ultimaFecha = "";

      // Buscar el ícono de lapicito (firmado) = tiene proveído
      // El primer row con clase o con fecha es el último movimiento
      const pasosMatch = html.match(/Pasos Procesales[\s\S]*?<\/table>/i);
      if (pasosMatch) {
        const rows = [...pasosMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        for (const row of rows) {
          const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
          if (cells.length >= 2) {
            const fecha = getText(cells[0]?.[1] || "");
            const desc = getText(cells[3]?.[1] || cells[2]?.[1] || cells[1]?.[1] || "");
            if (fecha.match(/\d{2}\/\d{2}\/\d{4}/)) {
              ultimaFecha = fecha;
              ultimoMovimiento = desc;
              // Buscar link al proveído en esta fila
              const linkMatch = row[0].match(/href="([^"]*proveido[^"]*)"/i);
              if (linkMatch) {
                const provUrl = linkMatch[1].startsWith("http") ? linkMatch[1] : `${MEV_BASE}/${linkMatch[1].replace(/^\//, "")}`;
                const provRes = await makeRequest(provUrl, {
                  headers: { Cookie: sessionCookie, Referer: expedienteUrl }
                });
                // Extraer texto del proveído
                const textMatch = provRes.body.match(/Para copiar[\s\S]*?desde aqu[íi][^-]*-+([\s\S]*?)-+[\s\S]*?Para copiar[\s\S]*?hasta aqu[íi]/i);
                if (textMatch) ultimoTexto = getText(textMatch[1]);
                else ultimoTexto = getText(provRes.body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, ""));
              }
              break;
            }
          }
        }
      }

      return {
        statusCode: 200, headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            parteActora,
            demandado,
            jurisdiccion: body.depto || "",
            juzgado,
            expediente: numExpediente,
            movimiento: ultimoMovimiento,
            textoProveido: ultimoTexto,
            fecha: ultimaFecha,
          },
          raw: html.substring(0, 3000),
        }),
      };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Acción no válida" }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};