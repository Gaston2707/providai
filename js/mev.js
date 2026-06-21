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

// Departamentos MEV (lista completa del sistema)
const MEV_DEPTOS = [
  { value: "0",  label: "TODOS los Deptos" },
  { value: "1",  label: "Avellaneda - Lanús" },
  { value: "2",  label: "Azul" },
  { value: "3",  label: "Bahía Blanca" },
  { value: "4",  label: "Dolores" },
  { value: "5",  label: "Junín" },
  { value: "6",  label: "La Matanza" },
  { value: "7",  label: "La Plata" },
  { value: "8",  label: "Lomas de Zamora" },
  { value: "9",  label: "Mar del Plata" },
  { value: "10", label: "Mercedes" },
  { value: "11", label: "Moreno - Gral. Rodriguez" },
  { value: "12", label: "Morón" },
  { value: "13", label: "Necochea" },
  { value: "14", label: "Olavarría" },
  { value: "15", label: "Pergamino" },
  { value: "16", label: "Quilmes" },
  { value: "17", label: "San Isidro" },
  { value: "18", label: "San Martín" },
  { value: "19", label: "San Nicolás" },
  { value: "20", label: "Tandil" },
  { value: "21", label: "Trenque Lauquen" },
  { value: "22", label: "Tres Arroyos" },
  { value: "23", label: "Zárate - Campana" },
];