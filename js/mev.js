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

// Departamentos MEV (lista fija del sistema)
const MEV_DEPTOS = [
  { value: "0",  label: "TODOS los Deptos" },
  { value: "1",  label: "Azul" },
  { value: "2",  label: "Bahía Blanca" },
  { value: "3",  label: "Dolores" },
  { value: "4",  label: "Junín" },
  { value: "5",  label: "La Matanza" },
  { value: "6",  label: "La Plata" },
  { value: "7",  label: "Lomas de Zamora" },
  { value: "8",  label: "Mar del Plata" },
  { value: "9",  label: "Mercedes" },
  { value: "10", label: "Moreno - Gral. Rodriguez" },
  { value: "11", label: "Morón" },
  { value: "12", label: "Necochea" },
  { value: "13", label: "Olavarría" },
  { value: "14", label: "Pergamino" },
  { value: "15", label: "Quilmes" },
  { value: "16", label: "San Isidro" },
  { value: "17", label: "San Martín" },
  { value: "18", label: "San Nicolás" },
  { value: "19", label: "Tandil" },
  { value: "20", label: "Trenque Lauquen" },
  { value: "21", label: "Tres Arroyos" },
  { value: "22", label: "Zárate/Campana" },
];
