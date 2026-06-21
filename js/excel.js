// ── EXCEL EXPORT con SheetJS ──
function exportToExcel(rows, filename = "ProvidAI_Expedientes") {
  // Columnas según especificación
  const headers = [
    "Parte Actora",
    "Demandado",
    "Jurisdiccion",
    "Juzgado",
    "Expediente",
    "Movimiento",
    "Texto del Proveido",
  ];

  // Mapear filas a objeto con los encabezados correctos
  const data = rows.map((r) => ({
    "Parte Actora":       r.parteActora     || "",
    "Demandado":          r.demandado        || "",
    "Jurisdiccion":       r.jurisdiccion     || "",
    "Juzgado":            r.juzgado          || "",
    "Expediente":         r.expediente       || "",
    "Movimiento":         r.movimiento       || "",
    "Texto del Proveido": r.textoProveido    || "",
  }));

  const ws = XLSX.utils.json_to_sheet(data, { header: headers });

  // Ancho de columnas
  ws["!cols"] = [
    { wch: 30 }, // Parte Actora
    { wch: 30 }, // Demandado
    { wch: 20 }, // Jurisdiccion
    { wch: 25 }, // Juzgado
    { wch: 18 }, // Expediente
    { wch: 20 }, // Movimiento
    { wch: 60 }, // Texto del Proveido
  ];

  // Estilo del encabezado (si la versión lo soporta)
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "0F1E38" } },
      alignment: { horizontal: "center" },
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Expedientes");

  const date = new Date().toISOString().split("T")[0];
  XLSX.writeFile(wb, `${filename}_${date}.xlsx`);
}
