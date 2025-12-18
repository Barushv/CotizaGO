# CotizaGO — Cotizador Tradicional / MSI (PWA)
**Autor:** Israel Ortiz — Honda Montejo  


PWA para generar cotizaciones rápidas de crédito automotriz con:
- **TRADICIONAL** (tasa por rango de enganche)
- **MSI (Meses sin intereses)** habilitado cuando el enganche es **≥ 50%**
- Tabla de amortización y **PDF listo para compartir por WhatsApp**

> **IVA (México):** 16% aplicado únicamente sobre intereses (modo TRADICIONAL).  
> En **MSI**: interés = 0 e IVA de intereses = 0.

---

## ✅ Flujo de uso
1) Selecciona **Vehículo** y **Versión** → carga precio automático desde `precios.json`.  
2) (Opcional) Edita el **precio** si hay descuento.  
3) Ingresa **enganche** en **$** o **%**.  
4) Selecciona el modo:
- **TRADICIONAL:** se toma la tasa por rango y se calcula mensualidad.
- **MSI (si enganche ≥ 50%):** eliges los meses y se difiere **(precio - enganche)** sin intereses.
5) Configura seguros:
- **Vida** y **Daños**: *contado* o *financiado*.
- Si es financiado, se prorratea y se suma a la mensualidad.
6) Genera **Tabla** y **PDF**.

---

## 🧾 Archivos importantes

### 1) Precios de vehículos
📄 **`/json/precios.json`**  
Estructura esperada:

```json
{
  "CITY": {
    "Sport 2026": "$408,900.00",
    "Prime 2026": "$437,900.00"
  }
}
