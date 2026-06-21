// ── MEV PROXY CLIENT ──
const MEV_PROXY = "/.netlify/functions/mev-proxy";

async function mevRequest(action, params = {}) {
  const res = await fetch(MEV_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) throw new Error(`Error de red: ${res.status}`);
  return res.json();
}

// Login a MEV - devuelve { success, cookies }
async function mevLogin(username, password, depto = "0") {
  return mevRequest("login", { username, password, depto });
}

// Obtener organismos de un departamento
async function mevGetOrganismos(depto, sessionCookie) {
  return mevRequest("get_organismos", { depto, sessionCookie });
}

// Buscar expedientes por carátula
async function mevBuscar(caratula, organismo, depto, sessionCookie) {
  return mevRequest("buscar", { caratula, organismo, depto, sessionCookie });
}

// Obtener el último proveído de un expediente
async function mevGetProveido(expedienteUrl, sessionCookie, depto, organismo) {
  return mevRequest("get_proveido", { expedienteUrl, sessionCookie, depto, organismo });
}

// Departamentos MEV (valores reales del sistema)
const MEV_DEPTOS = [
  { value: "80", label: "Avellaneda - Lanús" },
  { value: "10", label: "Azul" },
  { value: "11", label: "Bahía Blanca" },
  { value: "12", label: "Dolores" },
  { value: "13", label: "Junín" },
  { value: "14", label: "La Matanza" },
  { value: "6",  label: "La Plata" },
  { value: "16", label: "Lomas de Zamora" },
  { value: "17", label: "Mar del Plata" },
  { value: "18", label: "Mercedes" },
  { value: "52", label: "Moreno - Gral. Rodriguez" },
  { value: "19", label: "Morón" },
  { value: "20", label: "Necochea" },
  { value: "21", label: "Olavarría" },
  { value: "22", label: "Pergamino" },
  { value: "23", label: "Quilmes" },
  { value: "24", label: "San Isidro" },
  { value: "25", label: "San Martín" },
  { value: "26", label: "San Nicolás" },
  { value: "27", label: "Tandil" },
  { value: "28", label: "Trenque Lauquen" },
  { value: "49", label: "Tres Arroyos" },
  { value: "29", label: "Zárate/Campana" },
];