import { db } from '../firebase/init.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state } from '../core/state.js';
import { $, escHtml, daysLabel, formatCurrency, showToast, nowMonthKey } from '../utils/helpers.js';

let _listadoData = { actividad: [], pagos: [], deudores: [], recaudacion: [] };

export function initReports() {
    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'exports') {
            initListados();
        }
    });

    document.querySelectorAll('.listados-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', (e) => switchListadoTab(e.currentTarget.dataset.tab));
    });

    $('lact-activity')?.addEventListener('change', runListadoActividad);
    
    $('lpag-month')?.addEventListener('change', runListadoPagos);
    $('lpag-activity')?.addEventListener('change', runListadoPagos);
    document.querySelectorAll('input[name="lpag-filter"]').forEach(radio => {
        radio.addEventListener('change', runListadoPagos);
    });

    $('ldeu-search')?.addEventListener('input', runListadoDeudores);
    
    $('lrec-month')?.addEventListener('change', runListadoRecaudacion);

    document.querySelectorAll('[data-action="export-csv"]').forEach(btn => {
        btn.addEventListener('click', (e) => listadoExportCSV(e.currentTarget.dataset.tab));
    });

    document.querySelectorAll('[data-action="export-pdf"]').forEach(btn => {
        btn.addEventListener('click', (e) => listadoExportPDF(e.currentTarget.dataset.tab));
    });
}

export function switchListadoTab(tab) {
    document.querySelectorAll('.listados-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.listado-panel').forEach(p => p.classList.toggle('hidden', p.id !== `listado-${tab}`));
    if (tab === 'actividad') initListadoActividad();
    if (tab === 'pagos') initListadoPagos();
    if (tab === 'deudores') runListadoDeudores();
    if (tab === 'recaudacion') initListadoRecaudacion();
}

export function initListados() {
    initListadoActividad();
    initListadoPagos();
    runListadoDeudores();
    initListadoRecaudacion();
}

// ─── TAB: POR ACTIVIDAD ───────────────────────────────────────
function initListadoActividad() {
    const sel = $('lact-activity');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— Seleccionar actividad —</option>` +
        state.activities.filter(a => a.status === 'active').map(a =>
            `<option value="${escHtml(a.id)}" ${a.id === cur ? 'selected' : ''}>${escHtml(a.name)}</option>`).join('');
    if (cur) runListadoActividad();
}

async function runListadoActividad() {
    const actId = $('lact-activity').value;
    const infoDiv = $('lact-info');
    const emptyDiv = $('lact-empty');
    if (!actId) {
        if(infoDiv) infoDiv.style.display = 'none';
        if(emptyDiv) emptyDiv.style.display = 'flex';
        return;
    }
    if(emptyDiv) emptyDiv.style.display = 'none';
    if(infoDiv) infoDiv.style.display = 'block';
    
    const countEl = $('lact-count');
    if(countEl) countEl.innerHTML = '<span class="loading-spinner" style="width:16px;height:16px;border-width:2px;display:inline-block"></span>';
    
    try {
        const act = state.activities.find(a => a.id === actId);
        // Prof logic removed for simplicity here, or we can fetch it if staff module is ready.

        if ($('lact-activity-info')) {
            $('lact-activity-info').innerHTML = `
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
                    <div>
                        <div style="font-size:18px;font-weight:700">${escHtml(act?.name || '')}</div>
                        <div style="font-size:13px;color:var(--gray-500);margin-top:2px">${daysLabel(act?.days || [])} · ${act?.startTime || ''}–${act?.endTime || ''}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:20px;font-weight:800;color:var(--blue)">${formatCurrency(act?.currentFee || 0)}<span style="font-size:12px;font-weight:400">/mes</span></div>
                        <span class="badge ${act?.status === 'active' ? 'badge-green' : 'badge-gray'}">${act?.status === 'active' ? 'Activa' : 'Inactiva'}</span>
                    </div>
                </div>`;
        }

        const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('activityId', '==', actId)));
        const enrolled = enrollSnap.docs
            .map(d => state.students.find(s => s.id === d.data().studentId))
            .filter(Boolean)
            .filter(s => s.active !== false)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'));

        if(countEl) countEl.textContent = enrolled.length;
        _listadoData.actividad = enrolled.map(s => ({
            nombre: `${s.lastName}, ${s.firstName}`,
            telefono: s.guardianPhone || (s.guardian && s.guardian.phone) || '',
            colegio: s.school || '',
            curso: s.grade || '',
            actividad: act?.name || ''
        }));

        if($('lact-students')){
             $('lact-students').innerHTML = enrolled.length === 0
                ? `<div class="empty-state">Sin alumnos inscriptos</div>`
                : enrolled.map((s, i) => {
                    const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';
                    return `<div class="listado-row">
                        <div style="width:24px;text-align:center;font-size:13px;color:var(--gray-400);font-weight:600">${i + 1}</div>
                        <div class="listado-row-main">
                            <div class="listado-row-title">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
                            <div class="listado-row-sub">${phone ? '📞 ' + escHtml(phone) : ''}${s.school ? ' · 🏫 ' + escHtml(s.school) : ''}${s.grade ? ' · ' + escHtml(s.grade) : ''}</div>
                        </div>
                    </div>`;
                }).join('');
        }
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ─── TAB: PAGOS POR MES ───────────────────────────────────────
function initListadoPagos() {
    const monthInput = $('lpag-month');
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const sel = $('lpag-activity');
    if (sel) {
        sel.innerHTML = `<option value="">Todas</option>` +
            state.activities.filter(a => a.status === 'active').map(a =>
                `<option value="${escHtml(a.id)}">${escHtml(a.name)}</option>`).join('');
    }
    runListadoPagos();
}

async function runListadoPagos() {
    const monthKey = ($('lpag-month')?.value || '').replace('-', '-');
    const actFilter = $('lpag-activity')?.value || '';
    const statusFilter = document.querySelector('input[name="lpag-filter"]:checked')?.value || 'all';
    const listEl = $('lpag-list');
    const sumEl = $('lpag-summary');
    if (!monthKey || !listEl) return;

    listEl.innerHTML = `<div class="loading-spinner">Cargando...</div>`;
    try {
        let q = query(collection(db, 'payments'), where('monthKey', '==', monthKey));
        const snap = await getDocs(q);
        let pmts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        pmts = pmts.filter(p => {
            const s = state.students.find(st => st.id === p.studentId);
            return s && s.active !== false;
        });

        if (actFilter) pmts = pmts.filter(p => p.activityId === actFilter);
        if (statusFilter === 'paid') pmts = pmts.filter(p => p.status === 'paid');
        if (statusFilter === 'pending') pmts = pmts.filter(p => p.status !== 'paid');

        let rows = [...pmts];
        if (statusFilter !== 'paid') {
            const enrollSnap = await getDocs(collection(db, 'enrollments'));
            for (const ed of enrollSnap.docs) {
                const enr = ed.data();
                if (actFilter && enr.activityId !== actFilter) continue;
                const existing = pmts.find(p => p.studentId === enr.studentId && p.activityId === enr.activityId);
                if (!existing) {
                    const s = state.students.find(st => st.id === enr.studentId);
                    const a = state.activities.find(ac => ac.id === enr.activityId);
                    if (s && s.active !== false) {
                        rows.push({
                            studentId: enr.studentId,
                            studentName: `${s.lastName}, ${s.firstName}`,
                            activityId: enr.activityId,
                            activityName: a?.name || enr.activityId,
                            monthKey, status: 'pending',
                            finalAmount: 0, grossAmount: a?.currentFee || 0,
                        });
                    }
                }
            }
        }
        rows.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'es'));

        const totalPaid = rows.filter(p => p.status === 'paid').reduce((s, p) => s + (p.finalAmount || 0), 0);
        const cntPaid = rows.filter(p => p.status === 'paid').length;
        const cntPend = rows.filter(p => p.status !== 'paid').length;
        if(sumEl) sumEl.textContent = `${rows.length} registros · ${cntPaid} pagados (${formatCurrency(totalPaid)}) · ${cntPend} pendientes`;

        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const [y, m] = monthKey.split('-');
        const mlbl = `${monthNames[+m - 1]} ${y}`;

        _listadoData.pagos = rows.map(p => ({
            mes: mlbl,
            alumno: p.studentName || p.studentId,
            actividad: p.activityName || p.activityId,
            estado: p.status === 'paid' ? 'Pagado' : 'Pendiente',
            monto: p.finalAmount || p.grossAmount || 0,
            comprobante: p.receiptNumber || '',
            metodoPago: p.paymentMethod || '',
        }));

        if (rows.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💳</div>Sin registros para este filtro</div>`;
            return;
        }
        const methodLabel = m => ({ cash: 'Efectivo', transfer: 'Transferencia', mercadopago: 'MercadoPago' }[m] || m || '—');
        listEl.innerHTML = rows.map(p => {
            const paid = p.status === 'paid';
            return `<div class="listado-row">
                <div class="listado-row-main">
                    <div class="listado-row-title">${escHtml(p.studentName || p.studentId)}</div>
                    <div class="listado-row-sub">${escHtml(p.activityName || '')} · ${paid ? methodLabel(p.paymentMethod) : 'Sin pagar'}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700;font-size:14px;color:${paid ? 'var(--green)' : 'var(--red)'}">${paid ? formatCurrency(p.finalAmount || 0) : '—'}</div>
                    <span class="badge ${paid ? 'badge-green' : 'badge-red'}" style="font-size:10px">${paid ? 'Pagado' : 'Pendiente'}</span>
                </div>
            </div>`;
        }).join('');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ─── TAB: DEUDORES ────────────────────────────────────────────
function activityMonthKeys(actObj) {
    if (!actObj || !actObj.startDate) return [];
    let d = new Date(actObj.startDate);
    const end = new Date(actObj.endDate || new Date().getFullYear() + '-12-31');
    const out = [];
    while (d <= end) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() + 1);
    }
    return out;
}

async function runListadoDeudores() {
    const search = ($('ldeu-search')?.value || '').toLowerCase().trim();
    const listEl = $('ldeu-list');
    const sumEl = $('ldeu-summary');
    if (!listEl) return;

    listEl.innerHTML = `<div class="loading-spinner">Cargando...</div>`;
    try {
        const yr = new Date().getFullYear();
        const months = activityMonthKeys({ startDate: `${yr}-03-01`, endDate: `${yr}-12-31` });

        const [pSnap, eSnap] = await Promise.all([
            getDocs(collection(db, 'payments')),
            getDocs(collection(db, 'enrollments')),
        ]);
        const paymentsMap = new Map();
        pSnap.docs.forEach(d => {
            const p = d.data();
            if (p.status === 'paid') paymentsMap.set(`${p.studentId}_${p.activityId}_${p.monthKey}`, true);
        });

        const deudoresMap = new Map();
        for (const ed of eSnap.docs) {
            const enr = ed.data();
            const s = state.students.find(st => st.id === enr.studentId);
            if (!s || s.active === false) continue;
            const a = state.activities.find(ac => ac.id === enr.activityId);
            const actMonths = a ? activityMonthKeys(a) : months;
            let must = actMonths.filter(m => m <= nowMonthKey());
            let pending = must.filter(m => !paymentsMap.get(`${enr.studentId}_${enr.activityId}_${m}`));
            if (pending.length === 0) continue;

            if (!deudoresMap.has(enr.studentId)) {
                deudoresMap.set(enr.studentId, {
                    student: s, totalPending: 0, deudas: []
                });
            }
            const entry = deudoresMap.get(enr.studentId);
            entry.totalPending += pending.length;
            entry.deudas.push({ activity: a?.name || enr.activityId, months: pending.length });
        }

        let deudores = [...deudoresMap.values()].sort((a, b) => b.totalPending - a.totalPending);

        if (search) {
            deudores = deudores.filter(d =>
                `${d.student.firstName} ${d.student.lastName}`.toLowerCase().includes(search) ||
                String(d.student.dni).includes(search));
        }

        if(sumEl) sumEl.textContent = `${deudores.length} alumnos con pagos pendientes`;
        _listadoData.deudores = deudores.map(d => ({
            alumno: `${d.student.lastName}, ${d.student.firstName}`,
            telefono: d.student.guardianPhone || (d.student.guardian && d.student.guardian.phone) || '',
            cuotasPendientes: d.totalPending,
            detalle: d.deudas.map(x => `${x.activity}: ${x.months} cuota(s)`).join(' | '),
        }));

        if (deudores.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎉</div>No hay deudores</div>`;
            return;
        }
        listEl.innerHTML = deudores.map((d, i) => `
            <div class="listado-row">
                <div style="width:28px;height:28px;border-radius:50%;background:${i < 3 ? 'var(--red-bg)' : 'var(--gray-100)'};color:${i < 3 ? 'var(--red)' : 'var(--gray-600)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${i + 1}</div>
                <div class="listado-row-main">
                    <div class="listado-row-title">${escHtml(d.student.lastName)}, ${escHtml(d.student.firstName)}</div>
                    <div class="listado-row-sub">DNI ${d.student.dni} · ${d.deudas.map(x => `${x.activity}: ${x.months} cuota(s)`).join(' · ')}</div>
                </div>
                <span class="badge badge-red" style="font-size:13px;font-weight:800">${d.totalPending}</span>
            </div>`).join('');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ─── TAB: RECAUDACIÓN ─────────────────────────────────────────
function initListadoRecaudacion() {
    const monthInput = $('lrec-month');
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    runListadoRecaudacion();
}

async function runListadoRecaudacion() {
    const monthKeyRaw = $('lrec-month')?.value;
    const listEl = $('lrec-list');
    const sumEl = $('lrec-summary');
    if (!monthKeyRaw || !listEl) return;

    const [targetYear, targetMonth] = monthKeyRaw.split('-');
    listEl.innerHTML = `<div class="loading-spinner">Cargando...</div>`;
    
    try {
        const snap = await getDocs(query(collection(db, 'payments'), where('status', '==', 'paid')));
        const pmts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const inMonthPmts = pmts.filter(p => {
            if (!p.paidAt) return false;
            const d = p.paidAt.toDate ? p.paidAt.toDate() : new Date(p.paidAt);
            if (isNaN(d)) return false;
            return String(d.getFullYear()) === targetYear && String(d.getMonth() + 1).padStart(2, '0') === targetMonth;
        });

        const totalsByAct = {};
        
        inMonthPmts.forEach(p => {
            const actName = p.activityName || 'Sin actividad';
            if (!totalsByAct[actName]) {
                totalsByAct[actName] = { cuota: 0, seguro: 0, total: 0 };
            }
            const totalPagado = (p.finalAmount || 0);
            const pagadoSeguro = (p.seguroAmount || 0);
            const pagadoCuota = totalPagado - pagadoSeguro;

            totalsByAct[actName].cuota += pagadoCuota;
            totalsByAct[actName].seguro += pagadoSeguro;
            totalsByAct[actName].total += totalPagado;
        });

        const results = Object.keys(totalsByAct).sort().map(actName => ({
            actividad: actName,
            recaudacionCuota: totalsByAct[actName].cuota,
            recaudacionSeguro: totalsByAct[actName].seguro,
            total: totalsByAct[actName].total
        }));

        let grandSumTotal = 0;
        let grandSumCuota = 0;
        let grandSumSeguro = 0;
        results.forEach(r => {
            grandSumTotal += r.total;
            grandSumCuota += r.recaudacionCuota;
            grandSumSeguro += r.recaudacionSeguro;
        });

        _listadoData.recaudacion = results.map(r => ({
            actividad: r.actividad,
            cuota: formatCurrency(r.recaudacionCuota),
            seguro: formatCurrency(r.recaudacionSeguro),
            total: formatCurrency(r.total)
        }));
        
        if (results.length > 0) {
             _listadoData.recaudacion.push({
                 actividad: 'TOTALES',
                 cuota: formatCurrency(grandSumCuota),
                 seguro: formatCurrency(grandSumSeguro),
                 total: formatCurrency(grandSumTotal)
             });
        }
        
        if(sumEl) sumEl.textContent = `Total recaudado: ${formatCurrency(grandSumTotal)}`;

        if (results.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💰</div>No hay cobros registrados en este mes.</div>`;
        } else {
             const rows = results.map(r => `
                <div class="listado-row">
                    <div class="listado-row-main" style="flex:2">
                        <div class="listado-row-title">${escHtml(r.actividad)}</div>
                        <div class="listado-row-sub">Cuota: ${formatCurrency(r.recaudacionCuota)} · Seguro: ${formatCurrency(r.recaudacionSeguro)}</div>
                    </div>
                    <div style="font-weight:700; color:var(--blue)">
                        ${formatCurrency(r.total)}
                    </div>
                </div>
            `).join('');
            
            listEl.innerHTML = rows + `
                 <div class="listado-row" style="background:var(--blue-50); border-top:2px solid var(--blue-200);">
                    <div class="listado-row-main" style="flex:2">
                        <div class="listado-row-title" style="color:var(--blue-900)">TOTAL GENERAL</div>
                        <div class="listado-row-sub">Cuota: ${formatCurrency(grandSumCuota)} · Seguro: ${formatCurrency(grandSumSeguro)}</div>
                    </div>
                    <div style="font-weight:800; font-size:16px; color:var(--blue-700)">
                        ${formatCurrency(grandSumTotal)}
                    </div>
                </div>
            `;
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ─── Exports ──────────────────────────────────────────────────
function downloadCSV(rows, filename) {
    const csv = rows.map(row =>
        row.map(cell => {
            const s = String(cell ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
    ).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function listadoExportCSV(tab) {
    const data = _listadoData[tab] || [];
    if (data.length === 0) { showToast('No hay datos para exportar', 'error'); return; }
    const headers = Object.keys(data[0]).map(k => k.charAt(0).toUpperCase() + k.slice(1));
    const rows = [headers, ...data.map(r => Object.values(r))];
    downloadCSV(rows, `listado_${tab}_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('CSV descargado ✓', 'success');
}

export async function listadoExportPDF(tab) {
    const data = _listadoData[tab] || [];
    if (data.length === 0) { showToast('No hay datos para exportar', 'error'); return; }
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = 210;
        const titles = { actividad: 'Por Actividad', pagos: 'Pagos por Mes', deudores: 'Deudores', recaudacion: 'Recaudación' };

        pdf.setFillColor(21, 101, 192);
        pdf.rect(0, 0, W, 20, 'F');

        let titleX = 14;
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
        pdf.text('Escuela Deportiva CASTA', titleX, 9);
        pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
        pdf.text(`Listado: ${titles[tab]} · ${new Date().toLocaleDateString('es-AR')}`, titleX, 16);

        pdf.setTextColor(0, 0, 0);
        const headers = Object.keys(data[0]);
        const colW = (W - 28) / headers.length;
        let y = 28;

        pdf.setFillColor(227, 242, 253);
        pdf.rect(14, y - 5, W - 28, 8, 'F');
        pdf.setFontSize(8); pdf.setFont(undefined, 'bold');
        headers.forEach((h, i) => pdf.text(h.charAt(0).toUpperCase() + h.slice(1), 14 + i * colW, y, { maxWidth: colW - 1 }));
        y += 6;
        pdf.setFont(undefined, 'normal');

        for (const row of data) {
            if (y > 275) { pdf.addPage(); y = 20; }
            const vals = Object.values(row);
            vals.forEach((v, i) => {
                const txt = String(v ?? '');
                pdf.text(txt, 14 + i * colW, y, { maxWidth: colW - 1 });
            });
            pdf.setDrawColor(220, 220, 220);
            pdf.line(14, y + 2, W - 14, y + 2);
            y += 7;
        }

        pdf.setFontSize(8); pdf.setTextColor(150);
        pdf.text(`Total: ${data.length} registros`, 14, 285);
        pdf.save(`listado_${tab}_${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast('PDF descargado ✓', 'success');
    } catch (e) { showToast('Error PDF: ' + e.message, 'error'); }
}
