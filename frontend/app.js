(() => {
    "use strict";

    const CLASES = ["NORM", "MI", "STTC", "CD", "HYP"];
    // Paleta de colores clínicos vibrantes (Verde, Rojo, Naranja, Cian, Azul)
    const COL = ["#10b981", "#ef4444", "#f59e0b", "#06b6d4", "#3b82f6"];
    const SPLITS = ["train", "val", "test"];
    const DERIV = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
    const MI = 1;

    const $ = (s) => document.querySelector(s);
    const fmt = d3.format(",");
    const pct = d3.format(".1%");

    // ------------------------------------------------------------ estado
    const E = {
        split: "test", sexo: "all", emin: 0, emax: 90, clases: new Set(), front: false,
        color: "label", proy: "umap", sel: -1, vecIds: [], lead: 0, atn: true
    };

    let P = null;
    let ID2I = new Map();
    let vis, visList = new Int32Array(0), colIdx, paleta = COL, etiquetasPaleta = CLASES;
    let bx, by, qt = null;

    // ------------------------------------------------------------ carga
    async function cargarPuntos(proy) {
        const r = await fetch(`/api/puntos?proy=${proy}`);
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();
        P = {
            n: d.n, id: Int32Array.from(d.id), x: Float32Array.from(d.x), y: Float32Array.from(d.y),
            label: Uint8Array.from(d.label), pred: Uint8Array.from(d.pred), conf: Float32Array.from(d.conf),
            knn: Float32Array.from(d.knn), age: Float32Array.from(d.age), sex: Uint8Array.from(d.sex),
            split: Uint8Array.from(d.split),
        };
        ID2I = new Map();
        for (let i = 0; i < P.n; i++) ID2I.set(P.id[i], i);
        vis = new Uint8Array(P.n);
        colIdx = new Uint8Array(P.n);
    }

    // ------------------------------------------------------------ filtros
    function recomputar() {
        const sp = E.split === "all" ? -1 : SPLITS.indexOf(E.split);
        const sxv = E.sexo === "all" ? -1 : +E.sexo;
        const conteo = [0, 0, 0, 0, 0];
        const lista = [];
        for (let i = 0; i < P.n; i++) {
            let ok = (sp < 0 || P.split[i] === sp) && (sxv < 0 || P.sex[i] === sxv) &&
                P.age[i] >= E.emin && P.age[i] <= E.emax;
            if (ok) conteo[P.label[i]]++;
            ok = ok && (E.clases.size === 0 || E.clases.has(P.label[i])) &&
                (!E.front || (P.label[i] === MI && P.pred[i] !== MI));
            vis[i] = ok ? 1 : 0;
            if (ok) lista.push(i);
        }
        visList = Int32Array.from(lista);
        if (bx) qt = d3.quadtree().x((i) => bx[i]).y((i) => by[i]).addAll(Array.from(visList));
        return conteo;
    }

    function actualizarColor() {
        if (E.color === "ambig") {
            paleta = [0, 0.25, 0.5, 0.75, 1].map((t) => d3.interpolateRdYlGn(t));
            etiquetasPaleta = ["0–20 %", "20–40 %", "40–60 %", "60–80 %", "80–100 %"].map((s) => s + " vecinos coinciden");
            for (let i = 0; i < P.n; i++) colIdx[i] = Math.min(4, Math.floor(P.knn[i] * 5));
        } else {
            paleta = COL;
            etiquetasPaleta = CLASES;
            colIdx.set(E.color === "label" ? P.label : P.pred);
        }
        $("#leyenda-meso").innerHTML = paleta
            .map((c, k) => `<span><i class="dot" style="background:${c}"></i>${etiquetasPaleta[k]}</span>`).join("");
    }

    function refrescar() {
        const conteo = recomputar();
        actualizarColor();
        pintarDonut(conteo);
        pintarStats();
        pintarAviso();
        pedirDibujo();
    }

    // ------------------------------------------------------------ macro: donut y estadísticas
    function pintarDonut(conteo) {
        const total = d3.sum(conteo);
        const S = 190, R = 90, r = 60;
        const svg = d3.select("#donut").selectAll("svg").data([0]).join("svg").attr("width", S).attr("height", S);
        const g = svg.selectAll("g").data([0]).join("g").attr("transform", `translate(${S / 2},${S / 2})`);
        const arcos = d3.pie().sort(null).value((d) => d)(conteo);
        const arc = d3.arc().innerRadius(r).outerRadius(R).padAngle(0.015);
        g.selectAll("path").data(arcos).join("path")
            .attr("d", arc).attr("fill", (_, k) => COL[k])
            .attr("opacity", (_, k) => (E.clases.size && !E.clases.has(k) ? 0.25 : 1))
            .style("cursor", "pointer")
            .style("transition", "all 0.2s")
            .on("click", (_, d) => alternarClase(d.index));
        g.selectAll("text.t").data([0]).join("text").attr("class", "t").attr("text-anchor", "middle").attr("dy", "-0.1em")
            .style("font-size", "22px").style("font-weight", 700).style("fill", "var(--ink)").text(fmt(total));
        g.selectAll("text.s").data([0]).join("text").attr("class", "s").attr("text-anchor", "middle").attr("dy", "1.6em")
            .style("font-size", "11px").style("fill", "var(--muted)").text("pacientes");

        $("#leyenda-donut").innerHTML = CLASES.map((c, k) =>
            `<li data-k="${k}" class="${E.clases.size && !E.clases.has(k) ? "off" : ""}">
         <i class="dot" style="background:${COL[k]}"></i>${c}
         <span class="n">${fmt(conteo[k])} · ${total ? pct(conteo[k] / total) : "–"}</span></li>`).join("");
    }

    function alternarClase(k) {
        E.clases.has(k) ? E.clases.delete(k) : E.clases.add(k);
        refrescar();
    }

    function pintarStats() {
        let n = 0, ok = 0, mi = 0, miOk = 0, miComoOtra = 0;
        for (const i of visList) {
            n++;
            if (P.pred[i] === P.label[i]) ok++;
            if (P.label[i] === MI) { mi++; P.pred[i] === MI ? miOk++ : miComoOtra++; }
        }
        $("#stats").innerHTML = n
            ? `Exactitud del modelo: <b>${pct(ok / n)}</b><br>` +
            (mi ? `Sensibilidad MI: <b>${pct(miOk / mi)}</b> (${fmt(miOk)} de ${fmt(mi)}; ${fmt(miComoOtra)} evadidos)` : "Sin pacientes MI filtrados.")
            : "Ajusta los filtros demográficos.";
    }

    function pintarAviso() {
        const el = $("#aviso");
        const msgs = {
            test: "Fold 10 (Test): Datos completamente nuevos para el modelo. La separación patológica es imparcial y empírica.",
            val: "Fold 9 (Validación): Datos utilizados internamente para optimizar hiperparámetros.",
            train: "Fold 1-8 (Train): Datos de entrenamiento. Las agrupaciones están fuertemente sesgadas por la memorización.",
            all: "Vista Global: Mezcla de todos los conjuntos. Recomendable aislar 'Test' para conclusiones clínicas.",
        };
        el.textContent = msgs[E.split];
        el.classList.toggle("warn", E.split === "train" || E.split === "all");
    }

    // ------------------------------------------------------------ meso: dispersión en canvas
    const wrap = $("#scatter-wrap"), canvas = $("#scatter"), ctx = canvas.getContext("2d");
    const tip = $("#tip");
    let W = 0, H = 0, dpr = 1, tf = d3.zoomIdentity;

    function ajustar() {
        const r = wrap.getBoundingClientRect();
        W = r.width; H = r.height; dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        if (!P || W < 10 || H < 10) return;
        const m = 20;
        const sxs = d3.scaleLinear().domain(d3.extent(P.x)).range([m, W - m]);
        const sys = d3.scaleLinear().domain(d3.extent(P.y)).range([H - m, m]);
        bx = new Float32Array(P.n); by = new Float32Array(P.n);
        for (let i = 0; i < P.n; i++) { bx[i] = sxs(P.x[i]); by[i] = sys(P.y[i]); }
        refrescar();
    }

    let pendiente = false;
    function pedirDibujo() {
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(() => { pendiente = false; dibujar(); });
    }

    function vecinosIdx() {
        return E.vecIds.map((id) => ID2I.get(id)).filter((v) => v !== undefined);
    }

    function dibujar() {
        if (!P || !bx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const s = Math.min(8, 2.5 * Math.pow(tf.k, 0.45));
        const h = s / 2;

        // Contexto tenue
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = "#94a3b8";
        for (let i = 0; i < P.n; i++) {
            if (vis[i]) continue;
            const x = tf.applyX(bx[i]), y = tf.applyY(by[i]);
            if (x < -s || x > W + s || y < -s || y > H + s) continue;
            ctx.beginPath(); ctx.arc(x, y, h, 0, 6.2832); ctx.fill();
        }

        // Puntos activos
        ctx.globalAlpha = 0.85;
        for (let c = 0; c < paleta.length; c++) {
            ctx.fillStyle = paleta[c];
            for (const i of visList) {
                if (colIdx[i] !== c) continue;
                const x = tf.applyX(bx[i]), y = tf.applyY(by[i]);
                if (x < -s || x > W + s || y < -s || y > H + s) continue;
                ctx.beginPath(); ctx.arc(x, y, h, 0, 6.2832); ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        if (E.sel >= 0) {
            const sx0 = tf.applyX(bx[E.sel]), sy0 = tf.applyY(by[E.sel]);
            const vs = vecinosIdx();
            ctx.strokeStyle = "rgba(15, 23, 42, 0.2)"; ctx.lineWidth = 1;
            for (const v of vs) {
                ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(tf.applyX(bx[v]), tf.applyY(by[v])); ctx.stroke();
            }
            for (const v of vs) {
                ctx.beginPath(); ctx.arc(tf.applyX(bx[v]), tf.applyY(by[v]), 5, 0, 6.2832);
                ctx.fillStyle = COL[P.label[v]]; ctx.fill();
                ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
            }
            ctx.beginPath(); ctx.arc(sx0, sy0, 8, 0, 6.2832);
            ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
            ctx.lineWidth = 2; ctx.strokeStyle = "#0f172a"; ctx.stroke();
        }
    }

    function buscarPunto(ev) {
        if (!qt) return undefined;
        const r = canvas.getBoundingClientRect();
        const px = (ev.clientX - r.left - tf.x) / tf.k, py = (ev.clientY - r.top - tf.y) / tf.k;
        return qt.find(px, py, 12 / tf.k);
    }

    canvas.addEventListener("pointermove", (ev) => {
        const i = buscarPunto(ev);
        if (i === undefined) { tip.style.display = "none"; canvas.style.cursor = "crosshair"; return; }
        canvas.style.cursor = "pointer";
        const r = wrap.getBoundingClientRect();
        tip.innerHTML = `<b>ECG ${P.id[i]}</b><br>Real: ${CLASES[P.label[i]]} · Predicción IA: ${CLASES[P.pred[i]]} (${pct(P.conf[i])})` +
            `<br>Acuerdo vecinal latente: ${Math.round(P.knn[i] * 10)}/10`;
        tip.style.display = "block";
        const tx = ev.clientX - r.left + 14, ty = ev.clientY - r.top + 14;
        tip.style.left = Math.min(tx, r.width - tip.offsetWidth - 10) + "px";
        tip.style.top = Math.min(ty, r.height - tip.offsetHeight - 10) + "px";
    });
    canvas.addEventListener("pointerleave", () => { tip.style.display = "none"; });
    canvas.addEventListener("click", (ev) => { const i = buscarPunto(ev); if (i !== undefined) seleccionar(i); });

    const zoom = d3.zoom().scaleExtent([1, 40]).on("zoom", (e) => { tf = e.transform; pedirDibujo(); });
    d3.select(canvas).call(zoom);

    // ------------------------------------------------------------ micro: ficha del paciente
    async function seleccionar(i) {
        E.sel = i;
        pedirDibujo();
        const r = await fetch(`/api/paciente/${P.id[i]}`);
        if (!r.ok) return;
        const d = await r.json();
        if (E.sel !== i) return;
        E.vecIds = d.vecinos;
        pintarFicha(d);
        pedirDibujo();
        $("#vacio").hidden = true;
        $("#detalle").hidden = false;
        await cargarSenal();
    }

    function pintarFicha(d) {
        const kl = CLASES.indexOf(d.label), kp = CLASES.indexOf(d.prediccion);
        $("#f-titulo").textContent = `ID Registro: ${d.ecg_id}`;
        $("#f-meta").textContent = `Paciente ${d.patient_id} · Sexo: ${d.sexo} · Edad: ${d.edad === null ? ">89" : d.edad} años`;
        $("#f-badges").innerHTML =
            `<span class="badge" style="background:${COL[kl]}">Diagnóstico Real: ${d.label}</span>` +
            `<span class="badge" style="background:${COL[kp]}">Predicción IA: ${d.prediccion}</span>` +
            (kl !== kp ? `<span class="badge warn">Riesgo Subclínico / Frontera</span>` : "");
        $("#f-probs").innerHTML = d.probs.map((p, k) =>
            `<div class="pb"><span>${CLASES[k]}</span><div class="barra"><i style="width:${(p * 100).toFixed(1)}%;background:${COL[k]}"></i></div><b>${(p * 100).toFixed(1)}%</b></div>`).join("");
        const nm = Math.round(d.frac_vecinos_MI * 10);
        let txt = `<b>${Math.round(d.knn_acuerdo * 10)} de 10</b> registros clínicamente cercanos comparten el diagnóstico real; ${nm} son MI.`;
        if (d.label === "MI" && d.prediccion !== "MI")
            txt += "<br><span style='color: #b45309; margin-top:4px; display:block;'>⚠️ <b>Alerta Fronteriza:</b> Discrepancia crítica entre etiqueta original y morfología actual evaluada por IA.</span>";
        $("#f-knn").innerHTML = txt;
        $("#f-vecinos").innerHTML = d.vecinos.map((id) => {
            const i = ID2I.get(id);
            return i === undefined ? "" :
                `<button class="chip" data-id="${id}"><i class="dot" style="background:${COL[P.label[i]]}"></i>${id}</button>`;
        }).join("");
    }

    $("#f-vecinos").addEventListener("click", (ev) => {
        const b = ev.target.closest(".chip");
        if (b) seleccionar(ID2I.get(+b.dataset.id));
    });

    // ------------------------------------------------------------ micro: señal ECG con atención
    const M = { t: 16, r: 16, b: 30, l: 48 };
    let ecg = null, bandas = [], x0, zx, yS, zoomE;
    let ultimoPaciente = -1;

    async function cargarSenal() {
        const id = P.id[E.sel];
        const r = await fetch(`/api/senal/${id}?derivacion=${E.lead}`);
        if (!r.ok || P.id[E.sel] !== id) return;
        ecg = await r.json();
        bandas = [];
        const paso = 5;
        for (let i = 0; i < ecg.mv.length; i += paso) {
            let s = 0, c = 0;
            for (let j = i; j < Math.min(ecg.mv.length, i + paso); j++) { s += ecg.atencion[j]; c++; }
            bandas.push({ i, a: s / c });
        }
        const nuevo = ultimoPaciente !== id;
        ultimoPaciente = id;
        montarECG(nuevo);
    }

    function montarECG(reset) {
        if (!ecg) return;
        const r = $("#ecg-wrap").getBoundingClientRect();
        const w = r.width, h = r.height;
        if (w < 10 || h < 10) return;
        const svg = d3.select("#ecg").attr("width", w).attr("height", h);
        svg.selectAll("*").remove();

        const T = ecg.mv.length / ecg.fs;
        x0 = d3.scaleLinear().domain([0, T]).range([M.l, w - M.r]);
        const ext = d3.extent(ecg.mv), pad = (ext[1] - ext[0]) * 0.1 || 0.1;
        yS = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([h - M.b, M.t]);

        svg.append("clipPath").attr("id", "clip").append("rect")
            .attr("x", M.l).attr("y", 0).attr("width", w - M.l - M.r).attr("height", h);
        svg.append("g").attr("class", "grid");
        const g = svg.append("g").attr("clip-path", "url(#clip)");
        g.append("g").attr("class", "bandas");
        g.append("path").attr("class", "trazo");
        svg.append("g").attr("class", "ejex").attr("transform", `translate(0,${h - M.b})`);
        svg.append("g").attr("class", "ejey").attr("transform", `translate(${M.l},0)`);
        svg.append("text").attr("x", 8).attr("y", M.t + 6).style("font-size", "10px").style("fill", "var(--muted)").style("font-weight", "500")
            .text(`mV · ${ecg.derivacion}`);

        zoomE = d3.zoom().scaleExtent([1, 10])
            .translateExtent([[M.l, 0], [w - M.r, h]]).extent([[M.l, 0], [w - M.r, h]])
            .on("zoom", (e) => { zx = e.transform.rescaleX(x0); renderECG(); });
        svg.call(zoomE);
        if (reset) svg.call(zoomE.transform, d3.zoomIdentity);
        else { zx = d3.zoomTransform(svg.node()).rescaleX(x0); renderECG(); }
    }

    function renderECG() {
        if (!ecg || !zx) return;
        const svg = d3.select("#ecg");
        const w = +svg.attr("width"), h = +svg.attr("height");

        svg.select(".grid").selectAll("line.v").data(zx.ticks(10)).join("line").attr("class", "v")
            .attr("x1", (d) => zx(d)).attr("x2", (d) => zx(d)).attr("y1", M.t).attr("y2", h - M.b);
        svg.select(".grid").selectAll("line.h").data(yS.ticks(6)).join("line").attr("class", "h")
            .attr("x1", M.l).attr("x2", w - M.r).attr("y1", (d) => yS(d)).attr("y2", (d) => yS(d));

        const fs = ecg.fs, paso = 5;
        svg.select(".bandas").selectAll("rect").data(bandas, (d) => d.i).join("rect")
            .attr("x", (d) => zx(d.i / fs)).attr("width", (d) => Math.max(0, zx((d.i + paso) / fs) - zx(d.i / fs)) + 0.6)
            .attr("y", M.t).attr("height", h - M.b - M.t)
            .attr("fill", "var(--danger)").attr("fill-opacity", (d) => (E.atn ? d.a * 0.6 : 0));

        svg.select(".trazo").attr("d", d3.line().x((_, i) => zx(i / fs)).y((d) => yS(d))(ecg.mv));
        svg.select(".ejex").call(d3.axisBottom(zx).ticks(10).tickFormat((d) => d + "s"));
        svg.select(".ejey").call(d3.axisLeft(yS).ticks(6));
    }

    // ------------------------------------------------------------ controles
    function enlazar() {
        $("#f-split").addEventListener("click", (ev) => {
            const b = ev.target.closest("button"); if (!b) return;
            E.split = b.dataset.v;
            document.querySelectorAll("#f-split button").forEach((x) => x.classList.toggle("on", x === b));
            refrescar();
        });
        $("#f-sexo").addEventListener("change", (ev) => { E.sexo = ev.target.value; refrescar(); });
        const edades = () => {
            let a = +$("#f-emin").value, b = +$("#f-emax").value;
            if (a > b) { [a, b] = [b, a]; }
            E.emin = a; E.emax = b;
            $("#v-edad").textContent = `${a}–${b}${b === 90 ? "+" : ""}`;
            refrescar();
        };
        $("#f-emin").addEventListener("input", edades);
        $("#f-emax").addEventListener("input", edades);
        $("#f-front").addEventListener("change", (ev) => { E.front = ev.target.checked; refrescar(); });
        $("#leyenda-donut").addEventListener("click", (ev) => {
            const li = ev.target.closest("li"); if (li) alternarClase(+li.dataset.k);
        });
        $("#s-color").addEventListener("change", (ev) => { E.color = ev.target.value; actualizarColor(); pedirDibujo(); });
        $("#s-proy").addEventListener("change", async (ev) => {
            const idSel = E.sel >= 0 ? P.id[E.sel] : null;
            E.proy = ev.target.value;
            try { await cargarPuntos(E.proy); } catch (e) { $("#aviso").textContent = "No se pudo cargar la proyección: " + e.message; return; }
            E.sel = idSel !== null && ID2I.has(idSel) ? ID2I.get(idSel) : -1;
            tf = d3.zoomIdentity;
            d3.select(canvas).call(zoom.transform, d3.zoomIdentity);
            ajustar();
        });
        $("#btn-reset").addEventListener("click", () => {
            d3.select(canvas).transition().duration(350).call(zoom.transform, d3.zoomIdentity);
        });

        const sl = $("#s-lead");
        sl.innerHTML = DERIV.map((d, k) => `<option value="${k}">Derivación ${d}</option>`).join("");
        sl.value = E.lead;
        sl.addEventListener("change", (ev) => { E.lead = +ev.target.value; if (E.sel >= 0) cargarSenal(); });
        $("#c-atn").addEventListener("change", (ev) => { E.atn = ev.target.checked; renderECG(); });

        $("#btn-buscar").addEventListener("click", buscar);
        $("#buscar").addEventListener("keydown", (ev) => { if (ev.key === "Enter") buscar(); });
        $("#btn-frontera").addEventListener("click", () => {
            const cand = [];
            for (const i of visList) if (P.label[i] === MI && P.pred[i] !== MI) cand.push(i);
            if (!cand.length) { $("#aviso").textContent = "No hay MI mal clasificados en la cohorte actual."; return; }
            seleccionar(cand[Math.floor(Math.random() * cand.length)]);
        });
    }

    function buscar() {
        const id = +$("#buscar").value;
        const i = ID2I.get(id);
        if (i === undefined) { $("#aviso").textContent = `El ECG ID ${id} no fue encontrado en los filtros actuales.`; return; }
        seleccionar(i);
    }

    // ------------------------------------------------------------ inicio
    (async function init() {
        try {
            await cargarPuntos(E.proy);
        } catch (e) {
            $("#aviso").textContent = "No se pudieron cargar los datos: " + e.message;
            return;
        }
        enlazar();
        new ResizeObserver(() => ajustar()).observe(wrap);
        new ResizeObserver(() => montarECG(false)).observe($("#ecg-wrap"));
    })();
})();