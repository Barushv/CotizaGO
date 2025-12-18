/* Cotizador Tradicional (Opción 2)
   - Pago base (sin IVA) tipo PMT para cada componente
   - IVA 16% solo sobre intereses
   - Vida/Daños financiados se calculan como "componente" separado (como se ve en PDFs)
*/
const IVA = 0.16;

let PRECIOS = null;
let CREDITOS = null;

let lastResult = null;
let precioEditado = false;

const $ = (id) => document.getElementById(id);

function money(n){
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { style:"currency", currency:"MXN" });
}
function numFromInput(v){
  if (typeof v !== "string") return 0;
  const cleaned = v.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function setInputMoney(id, n){
  $(id).value = Number.isFinite(n) ? String(Math.round(n*100)/100) : "";
}
function pct(n){
  if (!Number.isFinite(n)) return "—";
  return (n*100).toFixed(2) + "%";
}

// PMT (pago sin IVA) para un principal P, tasa mensual r, n meses
function pmt(P, r, n){
  if (n <= 0) return 0;
  if (r === 0) return P / n;
  const pow = Math.pow(1 + r, n);
  return P * (r * pow) / (pow - 1);
}

// Selecciona la tasa por rango de enganche (min/max en %)
function pickRate(planId, engPct){
  const plan = CREDITOS?.planes?.find(p => p.id === planId);
  if (!plan) return null;
  const r = plan.tasas_por_enganche.find(x => engPct >= x.min && engPct <= x.max);
  if (!r) return null;
  return { tasaAnual: r.tasa_anual, rango: r };
}

// Plazos permitidos por rango
function allowedTerms(planId, engPct){
  const plan = CREDITOS?.planes?.find(p => p.id === planId);
  if (!plan) return [];
  const r = plan.tasas_por_enganche.find(x => engPct >= x.min && engPct <= x.max);
  if (!r) return [];
  return r.plazos_meses ?? plan.plazos_meses ?? [12,24,36,48,60,72];
}

// MSI: si aplica por vehículo y enganche >= 50%
function msiOptionsFor(modelo, engPct){
  const msi = CREDITOS?.msi;
  if (!msi) return [];
  if (engPct < (msi.enganche_min ?? 0.50)) return [];
  const list = (msi.vehiculos && (msi.vehiculos[modelo] || msi.vehiculos["*"])) || [];
  return Array.isArray(list) ? list : [];
}

// Convierte el JSON de precios a una estructura uniforme:
// { modelos: [ { nombre, versiones: [ { nombre, precio } ] } ] }
function normalizePrecios(raw){
  // Caso 1: ya viene en formato esperado
  if (raw?.modelos && Array.isArray(raw.modelos)) return raw;

  // Caso 2: mapa { "CITY": { "SPORT CVT": 408900, ... }, ... }
  if (raw && typeof raw === "object" && !Array.isArray(raw)){
    const modelos = Object.keys(raw).map(m => ({
      nombre: m,
      versiones: Object.keys(raw[m] || {}).map(v => ({ nombre: v, precio: parseMoneyString(raw[m][v]) }))
    }));
    return { vigencia: raw.vigencia || "", modelos };
  }

  // Caso 3: lista simple [{modelo, version, precio}]
  if (Array.isArray(raw)){
    const map = new Map();
    for (const it of raw){
      const m = it.modelo || it.model || it.submarca || "OTROS";
      const v = it.version || it.versión || it.trim || "BASE";
      const p = Number(it.precio || it.price || it.monto || 0);
      if (!map.has(m)) map.set(m, new Map());
      map.get(m).set(v, p);
    }
    const modelos = Array.from(map.entries()).map(([m, versions]) => ({
      nombre: m,
      versiones: Array.from(versions.entries()).map(([v, p]) => ({ nombre: v, precio: p }))
    }));
    return { modelos };
  }

  return { modelos: [] };
}

function parseMoneyString(v){
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  // Ej: "$408,900.00" -> 408900
  const cleaned = v.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

async function loadJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${path}`);
  return await res.json();
}

function fillSelect(select, options, getValue, getLabel){
  select.innerHTML = "";
  for (const opt of options){
    const o = document.createElement("option");
    o.value = getValue(opt);
    o.textContent = getLabel(opt);
    select.appendChild(o);
  }
}

function currentModeloObj(){
  const m = $("selModelo").value;
  return PRECIOS.modelos.find(x => x.nombre === m) || PRECIOS.modelos[0];
}
function currentVersionObj(){
  const mo = currentModeloObj();
  const v = $("selVersion").value;
  return mo?.versiones?.find(x => x.nombre === v) || mo?.versiones?.[0];
}

function syncPrecioFromSelection(force = false){
  const v = currentVersionObj();
  if (!v) return;

  // Si cambias modelo/versión, cargamos el precio del JSON siempre.
  // Si editaste el precio manualmente (descuento), no lo pisamos hasta que vuelvas a cambiar selección.
  if (force || !precioEditado){
    setInputMoney("inpPrecio", v.precio);
    precioEditado = false;
  }
}

function recomputeEnganchePercents(){
  const precio = numFromInput($("inpPrecio").value);
  const engMonto = numFromInput($("inpEngancheMonto").value);
  const engPct = numFromInput($("inpEnganchePct").value) / 100;

  // Si el usuario está editando monto, recalcula %
  if (document.activeElement === $("inpEngancheMonto")){
    const pctCalc = precio > 0 ? engMonto / precio : 0;
    $("inpEnganchePct").value = precio > 0 ? (pctCalc*100).toFixed(2) : "";
    return;
  }

  // Si el usuario está editando %, recalcula monto
  if (document.activeElement === $("inpEnganchePct")){
    const montoCalc = precio > 0 ? precio * engPct : 0;
    $("inpEngancheMonto").value = precio > 0 ? (montoCalc).toFixed(2) : "";
    return;
  }

  // Si no está editando nada, intenta mantener consistencia
  if (precio > 0 && engMonto > 0){
    $("inpEnganchePct").value = ((engMonto/precio)*100).toFixed(2);
  } else if (precio > 0 && engPct > 0){
    $("inpEngancheMonto").value = (precio*engPct).toFixed(2);
  }
}

function refreshRateAndTerms(){
  const precio = numFromInput($("inpPrecio").value);
  const engMonto = numFromInput($("inpEngancheMonto").value);
  const engPct = precio > 0 ? engMonto / precio : 0;

  const planId = $("selPlan").value;
  const rate = pickRate(planId, engPct);

  // MSI options
  const modelo = $("selModelo").value;
  const msiTerms = msiOptionsFor(modelo, engPct);
  const selMsi = $("selMsi");
  selMsi.innerHTML = "";
  if (msiTerms.length){
    selMsi.disabled = false;
    selMsi.appendChild(new Option("No", "off"));
    for (const t of msiTerms){
      selMsi.appendChild(new Option(`${t} MSI`, String(t)));
    }
  } else {
    selMsi.disabled = true;
    selMsi.appendChild(new Option("No", "off"));
  }

  // Terms
  const terms = allowedTerms(planId, engPct);
  const selPlazo = $("selPlazo");
  const current = Number(selPlazo.value || 0);
  fillSelect(selPlazo, terms, x=>String(x), x=>`${x} meses`);
  if (terms.includes(current)) selPlazo.value = String(current);

  // Rate pill
  if (rate){
    $("tasaPill").textContent = `Tasa: ${(rate.tasaAnual*100).toFixed(2)}% (según enganche)`;
    $("outTasa").textContent = (rate.tasaAnual*100).toFixed(2) + "% anual";
  } else {
    $("tasaPill").textContent = "Tasa: —";
    $("outTasa").textContent = "—";
  }
}

function computeQuote(){
  const precio = numFromInput($("inpPrecio").value);
  const engMonto = numFromInput($("inpEngancheMonto").value);
  const engPct = precio > 0 ? engMonto / precio : 0;

  const planId = $("selPlan").value;
  const plan = CREDITOS.planes.find(p => p.id === planId);
  const ratePick = pickRate(planId, engPct);
  if (!ratePick) throw new Error("No hay tasa para ese enganche.");
  const tasaAnual = ratePick.tasaAnual;
  const r = tasaAnual / 12;

  const plazo = Number($("selPlazo").value);
  const msiSel = $("selMsi").value;
  const useMsi = msiSel !== "off";
  const msiTerm = useMsi ? Number(msiSel) : null;

  const comPct = Number($("selComision").value);
  const vidaMonto = numFromInput($("inpVidaMonto").value);
  const vidaTipo = $("selVidaTipo").value;

  const daniosMonto = numFromInput($("inpDaniosMonto").value);
  const daniosTipo = $("selDaniosTipo").value;

  const anualidades = $("chkAnualidades").checked;
  const anualidadMonto = numFromInput($("inpAnualidadMonto").value);

  // Principales
  const principalAuto = Math.max(precio - engMonto, 0);

  // Componente Vida / Daños: si es financiado, se trata como "componente separado"
  const principalVida = (vidaTipo === "financiado") ? vidaMonto : 0;
  const principalDanios = (daniosTipo === "financiado") ? daniosMonto : 0;

  const pagoInicial = engMonto
    + (vidaTipo === "contado" ? vidaMonto : 0)
    + (daniosTipo === "contado" ? daniosMonto : 0)
    + ((principalAuto + principalVida + principalDanios) * comPct);

  // Monto a financiar = suma de principales financiados
  const montoFin = principalAuto + principalVida + principalDanios;

  // MSI: en MSI no hay intereses ni IVA intereses (solo difiere el 50% restante)
  // Aquí: interpretamos MSI como: se financia SOLO el 50% restante del precio (eng >= 50%) + add-ons financiados (vida/daños)
  // y se paga en msiTerm a capital fijo. Vida/Daños financiados se suman a capital (sin interés) en MSI.
  if (useMsi && msiTerm){
    const principalMsiAuto = Math.max(precio * 0.50, 0);
    const finMsi = principalMsiAuto + principalVida + principalDanios;
    const pagoBase = finMsi / msiTerm; // sin interés

    const rows = [];
    let saldo = finMsi;
    for (let i=1; i<=msiTerm; i++){
      const interes = 0;
      const ivaInt = 0;
      const capital = pagoBase;
      saldo = Math.max(saldo - capital, 0);
      const total = capital; // seguros ya van incluidos en capital en este modo (simple)
      rows.push({i, saldo, capital, interes, ivaInt, vida:0, danios:0, total});
    }

    return {
      modo: `MSI ${msiTerm}`,
      plan: plan.nombre,
      tasaAnual: 0,
      plazo: msiTerm,
      precio, engMonto, engPct,
      comPct,
      vidaMonto, vidaTipo,
      daniosMonto, daniosTipo,
      pagoInicial,
      montoFin: finMsi,
      pagoMensual: pagoBase,
      table: rows
    };
  }

  // TRADICIONAL: pagos por componente (Auto + Vida + Daños), cada uno con PMT sin IVA
  const pagoAuto = pmt(principalAuto, r, plazo);
  const pagoVida = principalVida > 0 ? pmt(principalVida, r, plazo) : 0;
  const pagoDanios = principalDanios > 0 ? pmt(principalDanios, r, plazo) : 0;

  // Construye tabla (preview completo en memoria)
  const rows = [];
  let saldoAuto = principalAuto;
  let saldoVida = principalVida;
  let saldoDanios = principalDanios;

  for (let i=1; i<=plazo; i++){
    const intAuto = saldoAuto * r;
    const capAuto = pagoAuto - intAuto;
    saldoAuto = Math.max(saldoAuto - capAuto, 0);

    const intVida = saldoVida * r;
    const capVida = pagoVida - intVida;
    saldoVida = Math.max(saldoVida - capVida, 0);

    const intDan = saldoDanios * r;
    const capDan = pagoDanios - intDan;
    saldoDanios = Math.max(saldoDanios - capDan, 0);

    const interes = intAuto + intVida + intDan;
    const ivaInt = interes * IVA;

    // Primas "con IVA": en los PDFs la prima vida/daños se muestra como un concepto propio.
    // Aquí lo modelamos como el "pago total del componente" (cap+int+ivaIntDelComponente).
    const vidaConIva = principalVida > 0 ? (capVida + intVida + (intVida*IVA)) : 0;
    const daniosConIva = principalDanios > 0 ? (capDan + intDan + (intDan*IVA)) : 0;

    // Anualidad (si aplica): se suma como cargo anual fijo (por defecto 0)
    const cargoAnual = (anualidades && anualidadMonto > 0 && i % 12 === 1 && i !== 1) ? anualidadMonto : 0;

    const total = (capAuto + intAuto) + (capVida + intVida) + (capDan + intDan)
                + ivaInt + cargoAnual;

    rows.push({
      i,
      saldo: saldoAuto, // saldo auto visible
      capital: capAuto,
      interes: intAuto,
      ivaInt: intAuto*IVA,
      vida: vidaConIva,
      danios: daniosConIva,
      total
    });
  }

  // Pago mensual aproximado: usamos el mes 1 como referencia
  const pagoMensual = rows[0]?.total ?? 0;

  return {
    modo: "TRADICIONAL",
    plan: plan.nombre,
    tasaAnual,
    plazo,
    precio, engMonto, engPct,
    comPct,
    vidaMonto, vidaTipo,
    daniosMonto, daniosTipo,
    pagoInicial,
    montoFin,
    pagoMensual,
    table: rows
  };
}

function render(result){
  lastResult = result;

  $("modoPill").textContent = `Modo: ${result.modo}`;

  $("outPago").textContent = money(result.pagoMensual);
  $("outInicial").textContent = money(result.pagoInicial);
  $("outFin").textContent = money(result.montoFin);

  $("outPrecio").textContent = money(result.precio);
  $("outEnganche").textContent = `${money(result.engMonto)} · ${pct(result.engPct)}`;
  $("outPlazo").textContent = `${result.plazo} meses`;
  $("outComision").textContent = (result.comPct*100).toFixed(2) + "%";

  const vidaLabel = result.vidaTipo === "financiado" ? "Financiado" : "Contado";
  $("outVida").textContent = `${money(result.vidaMonto)} · ${vidaLabel}`;

  let daniosLabel = "Por cuenta del cliente";
  if (result.daniosTipo === "financiado") daniosLabel = "Financiado";
  if (result.daniosTipo === "contado") daniosLabel = "Contado";
  $("outDanios").textContent = `${money(result.daniosMonto)} · ${daniosLabel}`;

  // Preview tabla: 12 primeras + 3 últimas
  const tb = $("tblAmort").querySelector("tbody");
  tb.innerHTML = "";
  const rows = result.table || [];
  const preview = [];
  for (let i=0; i<Math.min(12, rows.length); i++) preview.push(rows[i]);
  if (rows.length > 15){
    preview.push({sep:true});
    preview.push(rows[rows.length-3], rows[rows.length-2], rows[rows.length-1]);
  }

  for (const r of preview){
    const tr = document.createElement("tr");
    if (r.sep){
      tr.innerHTML = `<td colspan="8" style="color:var(--muted); text-align:center;">…</td>`;
      tb.appendChild(tr);
      continue;
    }
    tr.innerHTML = `
      <td>${r.i}</td>
      <td>${money(r.saldo)}</td>
      <td>${money(r.capital)}</td>
      <td>${money(r.interes)}</td>
      <td>${money(r.ivaInt)}</td>
      <td>${money(r.vida)}</td>
      <td>${money(r.danios)}</td>
      <td><b>${money(r.total)}</b></td>
    `;
    tb.appendChild(tr);
  }

  $("btnCopiar").disabled = false;
  $("btnTabla").disabled = false;
  $("btnPdf").disabled = false;
}

function buildWhatsAppText(result){
  const modelo = $("selModelo").value;
  const version = $("selVersion").value;
  const anio = $("inpAnio").value;

  // Mensualidad total: toma el primer pago real de la tabla (si existe) para coincidir con "Ver tabla"
  const mensualidadWhats = (()=>{
    const rows = result?.table || [];
    if (rows.length){
      const r = (rows[0]?.i === 0 && rows[1]) ? rows[1] : rows[0];
      if (r && Number.isFinite(r.total)) return r.total;
    }
    return result?.pagoMensual || 0;
  })();

  const isMsi = String(result.modo || "").toUpperCase().includes("MSI");

  const lines = [
    `🚗 *Honda Montejo - CotizaGO* ✅`,
    `━━━━━━━━━━━━━━━━`,
    `🧾 *Vehículo:* ${modelo} ${version} (${anio})`,
    `💰 *Precio:* ${money(result.precio)}`,
    `💵 *Enganche:* ${money(result.engMonto)} (${pct(result.engPct)})`,
    `📌 *Plan:* ${result.plan || "—"}${isMsi ? " 🎉 *MSI*" : ""}`,
    `🗓️ *Plazo:* ${result.plazo} meses`,
    `🏷️ *Tasa:* ${result.tasaAnual ? (result.tasaAnual*100).toFixed(2) + "% anual (sin IVA)" : "0% (MSI)"}`,
    `━━━━━━━━━━━━━━━━`,
    `📉 *Monto a financiar:* ${money(result.montoFin)}`,
    `💳 *Pago mensual aprox:* ${money(mensualidadWhats)} (con IVA + seguros si aplica)`,
    `🛡️ *Seguro vida:* ${money(result.vidaMonto)} (${result.vidaTipo})`,
    `🛡️ *Seguro daños:* ${money(result.daniosMonto)} (${result.daniosTipo})`,
    `🤝 *Comisión:* ${(result.comPct*100).toFixed(2)}% (de contado)`,
    `✅ *Pago inicial aprox:* ${money(result.pagoInicial)}`,
    `━━━━━━━━━━━━━━━━`,
    `📲 Si gustas, te comparto la tabla completa y el PDF.`
  ];

  return lines.join("\n");
}

async function init(){
  // SW
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
    navigator.serviceWorker.addEventListener("message", (e)=>{
      if (e.data?.type === "UPDATE_AVAILABLE"){
        $("btnUpdate").hidden = false;
      }
    });
  }

  // Install prompt
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    $("btnInstall").hidden = false;
  });
  $("btnInstall").addEventListener("click", async ()=>{
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("btnInstall").hidden = true;
  });

  $("btnUpdate").addEventListener("click", ()=>{
    if (navigator.serviceWorker?.controller){
      navigator.serviceWorker.controller.postMessage({ type:"SKIP_WAITING" });
    }
    location.reload();
  });

  // Load data
  const [rawPrecios, creditos] = await Promise.all([
    loadJSON("./json/precios.json"),
    loadJSON("./json/creditos.json")
  ]);

  PRECIOS = normalizePrecios(rawPrecios);
  CREDITOS = creditos;

  $("vigenciaPill").textContent = CREDITOS?.vigencia ? `Vigencia: ${CREDITOS.vigencia}` : "Listo";

  // Fill selects
  fillSelect($("selModelo"), PRECIOS.modelos, x=>x.nombre, x=>x.nombre);
  $("selModelo").addEventListener("change", ()=>{
    const mo = currentModeloObj();
    fillSelect($("selVersion"), mo.versiones, x=>x.nombre, x=>x.nombre);
    syncPrecioFromSelection(true);
    recomputeEnganchePercents();
    refreshRateAndTerms();
  });

  const firstModel = PRECIOS.modelos[0];
  fillSelect($("selVersion"), firstModel?.versiones || [], x=>x.nombre, x=>x.nombre);

  $("selVersion").addEventListener("change", ()=>{
    syncPrecioFromSelection(true);
    recomputeEnganchePercents();
    refreshRateAndTerms();
  });

  // Plans
  fillSelect($("selPlan"), CREDITOS.planes, p=>p.id, p=>p.nombre);
  $("selPlan").addEventListener("change", ()=>{
    refreshRateAndTerms();
  });

  // Default price
  syncPrecioFromSelection(true);

  // Inputs
  const onAnyChange = ()=>{
    recomputeEnganchePercents();
    refreshRateAndTerms();
  };

  $("inpPrecio").addEventListener("input", ()=>{
    precioEditado = true;
    recomputeEnganchePercents();
    refreshRateAndTerms();
  });
  $("inpEngancheMonto").addEventListener("input", onAnyChange);
  $("inpEnganchePct").addEventListener("input", onAnyChange);
  $("selPlazo").addEventListener("change", onAnyChange);
  $("selMsi").addEventListener("change", onAnyChange);

  $("inpVidaMonto").addEventListener("input", onAnyChange);
  $("selVidaTipo").addEventListener("change", onAnyChange);
  $("inpDaniosMonto").addEventListener("input", onAnyChange);
  $("selDaniosTipo").addEventListener("change", onAnyChange);
  $("selComision").addEventListener("change", onAnyChange);
  $("chkAnualidades").addEventListener("change", onAnyChange);
  $("inpAnualidadMonto").addEventListener("input", onAnyChange);

  // First pass defaults
  setInputMoney("inpEngancheMonto", Math.round(numFromInput($("inpPrecio").value) * 0.30));
  recomputeEnganchePercents();
  refreshRateAndTerms();

  $("btnCalcular").addEventListener("click", ()=>{
    try{
      const result = computeQuote();
      render(result);
    }catch(err){
      alert(err?.message || String(err));
    }
  });

  $("btnCopiar").addEventListener("click", async ()=>{
    if (!lastResult) return;
    const txt = buildWhatsAppText(lastResult);
    try{
      await navigator.clipboard.writeText(txt);
      $("btnCopiar").textContent = "Copiado ✅";
      setTimeout(()=> $("btnCopiar").textContent = "Copiar para WhatsApp", 1200);
    }catch{
      prompt("Copia este texto:", txt);
    }
  });

  $("btnTabla").addEventListener("click", ()=>{
    $("detailsTabla").open = true;
    $("detailsTabla").scrollIntoView({ behavior:"smooth", block:"start" });

  $("btnPdf").addEventListener("click", async ()=>{
    if (!lastResult) return;

    // Construye un HTML imprimible para PDF
    const modelo = $("selModelo").value;
    const version = $("selVersion").value;
    const anio = $("inpAnio").value;

    const r = lastResult;
    const header = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial; padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div>
            <div style="font-size:18px;font-weight:900;">Cotización ${r.modo}</div>
            <div style="color:#555;">${modelo} · ${version} · ${anio}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:800;">Pago mensual</div>
            <div style="font-size:18px;font-weight:900;">${money(r.pagoMensual)}</div>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid #ddd;margin:12px 0;" />

        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tbody>
            <tr><td style="padding:6px 0;color:#555;">Precio</td><td style="padding:6px 0;text-align:right;font-weight:800;">${money(r.precio)}</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Enganche</td><td style="padding:6px 0;text-align:right;font-weight:800;">${money(r.engMonto)} (${pct(r.engPct)})</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Plazo</td><td style="padding:6px 0;text-align:right;font-weight:800;">${r.plazo} meses</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Tasa</td><td style="padding:6px 0;text-align:right;font-weight:800;">${r.tasaAnual ? (r.tasaAnual*100).toFixed(2) + "% anual (sin IVA)" : "MSI (0%)"}</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Pago inicial</td><td style="padding:6px 0;text-align:right;font-weight:800;">${money(r.pagoInicial)}</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Monto a financiar</td><td style="padding:6px 0;text-align:right;font-weight:800;">${money(r.montoFin)}</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Seguro vida</td><td style="padding:6px 0;text-align:right;font-weight:800;">${money(r.vidaMonto)} (${r.vidaTipo})</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Seguro daños</td><td style="padding:6px 0;text-align:right;font-weight:800;">${money(r.daniosMonto)} (${r.daniosTipo})</td></tr>
            <tr><td style="padding:6px 0;color:#555;">Comisión</td><td style="padding:6px 0;text-align:right;font-weight:800;">${(r.comPct*100).toFixed(2)}%</td></tr>
          </tbody>
        </table>
      </div>
    `;

    const rows = (r.table || []).map(x => `
      <tr>
        <td style="padding:6px;border-bottom:1px solid #eee;">${x.i}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${money(x.saldo)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${money(x.capital)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${money(x.interes)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${money(x.ivaInt)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${money(x.vida)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${money(x.danios)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:800;">${money(x.total)}</td>
      </tr>
    `).join("");

    const table = `
      <div style="padding:0 16px 16px 16px;font-family:system-ui,Segoe UI,Roboto,Arial;">
        <div style="font-weight:900;margin:6px 0 10px 0;">Tabla de amortización</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:2px solid #ddd;">#</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">Saldo</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">Capital</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">Interés</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">IVA int.</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">Vida</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">Daños</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #ddd;">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="color:#666;font-size:10px;margin-top:10px;">* IVA 16% aplicado únicamente sobre intereses. Valores aproximados por redondeo.</div>
      </div>
    `;

    const container = document.createElement("div");
    container.innerHTML = header + table;

    if (!window.html2pdf){
      // Fallback: abre vista imprimible
      const w = window.open("", "_blank");
      w.document.write(container.innerHTML);
      w.document.close();
      w.focus();
      w.print();
      return;
    }

    const opt = {
      margin:       8,
      filename:     `Cotizacion_${modelo}_${version}_${anio}.pdf`.replace(/\s+/g,"_"),
      image:        { type: "jpeg", quality: 0.95 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" }
    };

    try{
      const worker = window.html2pdf().set(opt).from(container);
      // Obtener blob para compartir
      const pdfBlob = await worker.outputPdf("blob");
      const file = new File([pdfBlob], opt.filename, { type: "application/pdf" });

      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share){
        await navigator.share({
          title: "Cotización",
          text: "Te comparto la cotización en PDF.",
          files: [file]
        });
      } else {
        // descarga normal
        await worker.save();
        alert("PDF generado. Si deseas compartir por WhatsApp, ábrelo y compártelo.");
      }
    }catch(err){
      console.error(err);
      alert("No se pudo generar/compartir PDF. Intenta de nuevo.");
    }
  });
  });
}

init().catch(err=>{
  console.error(err);
  alert("Error al iniciar. Revisa que existan json/precios.json y json/creditos.json");
});
