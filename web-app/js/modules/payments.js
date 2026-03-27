import { db } from '../firebase/init.js';
import { collection, doc, setDoc, query, where, getDocs, serverTimestamp, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state } from '../core/state.js';
import { $, escHtml, daysLabel, showToast, formatCurrency } from '../utils/helpers.js';
import { MONTH_NAMES_ES } from './attendance.js';
import { generateReceiptPDF } from '../utils/pdf-generator.js';

export function initPayments() {
    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'payments') {
            initPaymentsPage();
        }
    });

    $('pay-activity-select')?.addEventListener('change', loadPaymentsGrid);
    $('pay-month-select')?.addEventListener('change', loadPaymentsGrid);
}

export function initPaymentsPage() {
    populatePaymentsActivitySelect();
    populatePaymentsMonthSelect();
}

function populatePaymentsActivitySelect() {
    const sel = $('pay-activity-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar actividad —</option>' +
        state.activities.filter(a => a.status === 'active').map(a =>
            `<option value="${escHtml(a.id)}">${escHtml(a.name)} (${daysLabel(a.days || [])})</option>`
        ).join('');
    if (prev) sel.value = prev;
}

function populatePaymentsMonthSelect() {
    const sel = $('pay-month-select');
    if (!sel) return;
    const now = new Date();
    const yr = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    sel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const key = `${yr}-${String(m).padStart(2, '0')}`;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = MONTH_NAMES_ES[m - 1];
        if (m === curMonth) opt.selected = true;
        sel.appendChild(opt);
    }
}

export async function loadPaymentsGrid() {
    const actId = $('pay-activity-select').value;
    const monthKey = $('pay-month-select').value;
    const cont = $('payments-grid');
    if (!actId || !monthKey) { cont.innerHTML = ''; return; }

    cont.innerHTML = '<div class="loading-spinner">Cargando...</div>';
    try {
        const activity = state.activities.find(a => a.id === actId);
        const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('activityId', '==', actId)));
        const studentIds = enrollSnap.docs.map(d => d.data().studentId);
        const enrolledStudents = studentIds
            .map(id => state.students.find(s => s.id === id))
            .filter(Boolean)
            .filter(s => s.active !== false)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'));

        if (enrolledStudents.length === 0) {
            cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>Sin alumnos inscriptos en esta actividad</div>';
            return;
        }

        const paySnap = await getDocs(query(collection(db, 'payments'),
            where('activityId', '==', actId), where('monthKey', '==', monthKey)));
        const paymentMap = {};
        paySnap.docs.forEach(d => { paymentMap[d.data().studentId] = { id: d.id, ...d.data() }; });

        renderPaymentsGrid(enrolledStudents, paymentMap, actId, activity, monthKey);
    } catch (e) {
        $('payments-grid').innerHTML = `<div class="empty-state">Error: ${escHtml(e.message)}</div>`;
    }
}

export function renderPaymentsGrid(enrolledStudents, paymentMap, actId, activity, monthKey) {
    const cont = $('payments-grid');
    const defaultFee = activity?.currentFee || 0;
    const [yr, mo] = monthKey.split('-');
    const monthLabel = `${MONTH_NAMES_ES[+mo - 1]} ${yr}`;

    const methodOptions = [
        ['cash', '💵 Efectivo'],
        ['transfer', '🏦 Transferencia'],
        ['mercadopago', '📱 MercadoPago'],
    ];

    const rows = enrolledStudents.map(s => {
        const pmt = paymentMap[s.id];
        const isPaid = pmt && pmt.status === 'paid';
        const isNotAttending = pmt && pmt.status === 'not_attending';
        const cuota = pmt ? (pmt.grossAmount ?? (isNotAttending ? 0 : defaultFee)) : defaultFee;
        const seguro = pmt ? (pmt.seguroAmount ?? 0) : 0;
        const method = pmt ? (pmt.paymentMethod || 'cash') : 'cash';
        const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';

        const statusSelect = `<select class="pay-status-select ${isPaid ? 'pay-paid' : isNotAttending ? 'pay-not-attending' : 'pay-pending'}"
            data-action="status" data-student="${escHtml(s.id)}">
            <option value="pending" ${!isPaid && !isNotAttending ? 'selected' : ''}>PENDIENTE</option>
            <option value="paid" ${isPaid ? 'selected' : ''}>PAGADO</option>
            <option value="not_attending" ${isNotAttending ? 'selected' : ''}>NO CONCURRE</option>
        </select>`;

        const cuotaInput = `<input type="number" class="pay-amount-input" value="${cuota}" min="0" step="100"
            data-action="cuota" data-student="${escHtml(s.id)}">`;

        const seguroInput = `<input type="number" class="pay-amount-input" value="${seguro}" min="0" step="100"
            data-action="seguro" data-student="${escHtml(s.id)}">`;

        const methodSelect = `<select class="pay-method-select"
            data-action="method" data-student="${escHtml(s.id)}">
            ${methodOptions.map(([v, l]) => `<option value="${v}" ${method === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>`;

        const receiptBtn = isPaid
            ? `<button class="pay-receipt-btn" title="Descargar comprobante"
                data-action="receipt" data-student="${escHtml(s.id)}">📄</button>` : '';

        const isWaSent = pmt?.waSent || false;
        const waColor = isWaSent ? '#25D366' : 'var(--gray-400)';
        const waIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${waColor}"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

        const waBtn = (isPaid && phone)
            ? `<button class="pay-wa-btn" title="${isWaSent ? 'Reenviar WhatsApp' : 'Enviar por WhatsApp'}"
                data-action="wa" data-student="${escHtml(s.id)}">${waIcon}</button>` : '';

        return `<tr>
            <td class="pay-student-cell">
                <div class="pay-student-name">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
                <div class="pay-student-sub">${s.school ? escHtml(s.school) : ''}${s.grade ? ' · ' + escHtml(s.grade) : ''}</div>
            </td>
            <td>${statusSelect}</td>
            <td>${cuotaInput}</td>
            <td>${seguroInput}</td>
            <td>${methodSelect}</td>
            <td class="pay-actions-cell">${receiptBtn}${waBtn}</td>
        </tr>`;
    }).join('');

    const paidCount = enrolledStudents.filter(s => paymentMap[s.id]?.status === 'paid').length;
    const notAttCount = enrolledStudents.filter(s => paymentMap[s.id]?.status === 'not_attending').length;
    const pendingCount = enrolledStudents.length - paidCount - notAttCount;

    cont.innerHTML = `<div class="card pay-card">
        <div class="pay-header">
            <span class="pay-month-label">💳 ${escHtml(activity?.name || actId)} — ${monthLabel}</span>
            <span class="pay-summary-badges">
                <span class="badge badge-green">${paidCount} pagados</span>
                <span class="badge badge-orange">${pendingCount} pendientes</span>
                ${notAttCount > 0 ? `<span class="badge badge-gray">${notAttCount} no asiste</span>` : ''}
                ${activity ? `<span class="badge badge-blue">Cuota: ${formatCurrency(defaultFee)}</span>` : ''}
            </span>
        </div>
        <div class="pay-table-wrap">
            <table class="pay-grid-table">
                <thead><tr>
                    <th class="pay-th-student">ALUMNO</th>
                    <th class="pay-th">ESTADO</th>
                    <th class="pay-th">CUOTA ($)</th>
                    <th class="pay-th">SEGURO ($)</th>
                    <th class="pay-th">MÉTODO</th>
                    <th class="pay-th">COMPROBANTE</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;

    window._payState = { enrolledStudents, paymentMap, actId, activity, monthKey };

    cont.querySelectorAll('[data-action="status"]').forEach(el => {
        el.addEventListener('change', (e) => setPaymentStatus(actId, monthKey, e.target.dataset.student, e.target.value));
    });
    cont.querySelectorAll('[data-action="cuota"]').forEach(el => {
        el.addEventListener('blur', (e) => setPaymentField(actId, monthKey, e.target.dataset.student, 'grossAmount', +e.target.value));
    });
    cont.querySelectorAll('[data-action="seguro"]').forEach(el => {
        el.addEventListener('blur', (e) => setPaymentField(actId, monthKey, e.target.dataset.student, 'seguroAmount', +e.target.value));
    });
    cont.querySelectorAll('[data-action="method"]').forEach(el => {
        el.addEventListener('change', (e) => setPaymentField(actId, monthKey, e.target.dataset.student, 'paymentMethod', e.target.value));
    });
    cont.querySelectorAll('[data-action="receipt"]').forEach(el => {
        el.addEventListener('click', (e) => {
            const sid = e.currentTarget.dataset.student;
            const pmt = paymentMap[sid];
            const s = enrolledStudents.find(x => x.id === sid);
            generateReceiptPDF(
                { ...pmt, studentName: `${s.lastName}, ${s.firstName}`, activityName: activity?.name || actId }, 
                s, activity
            );
        });
    });
    cont.querySelectorAll('[data-action="wa"]').forEach(el => {
        el.addEventListener('click', (e) => {
            const sid = e.currentTarget.dataset.student;
            const pmt = paymentMap[sid];
            const s = enrolledStudents.find(x => x.id === sid);
            const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';
            sendPaymentWhatsApp(pmt.id, sid, phone, `${s.firstName} ${s.lastName}`, activity?.name, monthKey, pmt.finalAmount);
        });
    });
}

export async function getNextReceiptNumber() {
    const counterRef = doc(db, 'counters', 'receiptCounter');
    let nextNumber = 1;
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (snap.exists()) {
            nextNumber = (snap.data().lastNumber || 0) + 1;
        }
        tx.set(counterRef, { lastNumber: nextNumber }, { merge: true });
    });
    return `CASTA-${String(nextNumber).padStart(6, '0')}`;
}

export async function setPaymentStatus(actId, monthKey, studentId, newStatus) {
    const s = window._payState;
    if (!s) return;

    const student = s.enrolledStudents.find(x => x.id === studentId);
    const existing = s.paymentMap[studentId];
    const cuota = existing ? (existing.grossAmount ?? s.activity?.currentFee ?? 0) : (s.activity?.currentFee ?? 0);
    const seguro = existing ? (existing.seguroAmount ?? 0) : 0;
    const method = existing ? (existing.paymentMethod || 'cash') : 'cash';

    if (newStatus === 'paid') {
        const receiptNum = existing?.receiptNumber || await getNextReceiptNumber();
        const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
        const payDoc = {
            id: docId,
            studentId,
            studentName: student ? `${student.lastName}, ${student.firstName}` : studentId,
            activityId: actId,
            activityName: s.activity?.name || actId,
            monthKey,
            status: 'paid',
            grossAmount: cuota,
            seguroAmount: seguro,
            finalAmount: cuota + seguro,
            paymentMethod: method,
            receiptNumber: receiptNum,
            paidAt: serverTimestamp(),
            collectedBy: { uid: state.currentUser.uid, displayName: state.currentUser.displayName || '', email: state.currentUser.email || '' },
            updatedAt: serverTimestamp(),
            updatedBy: state.currentUser.uid,
        };
        await savePaymentDoc(docId, payDoc);
        showToast(`✓ Pago registrado — ${receiptNum}`, 'success');
    } else if (newStatus === 'not_attending') {
        const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
        const payDoc = {
            id: docId,
            studentId,
            studentName: student ? `${student.lastName}, ${student.firstName}` : studentId,
            activityId: actId,
            activityName: s.activity?.name || actId,
            monthKey,
            status: 'not_attending',
            grossAmount: 0,
            seguroAmount: 0,
            finalAmount: 0,
            paymentMethod: method,
            receiptNumber: existing?.receiptNumber || null,
            paidAt: existing?.paidAt || null,
            collectedBy: { uid: state.currentUser.uid, displayName: state.currentUser.displayName || '', email: state.currentUser.email || '' },
            updatedAt: serverTimestamp(),
            updatedBy: state.currentUser.uid,
        };
        await savePaymentDoc(docId, payDoc);
        showToast('Alumno marcado como NO CONCURRE', '');
    } else {
        const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
        await savePaymentDoc(docId, { ...existing, status: 'pending', updatedAt: serverTimestamp(), updatedBy: state.currentUser.uid });
        showToast('Pago marcado como pendiente', '');
    }
    loadPaymentsGrid();
}

export async function setPaymentField(actId, monthKey, studentId, field, value) {
    const s = window._payState;
    if (!s) return;
    const student = s.enrolledStudents.find(x => x.id === studentId);
    const existing = s.paymentMap[studentId];
    const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
    const cuota = field === 'grossAmount' ? value : (existing?.grossAmount ?? s.activity?.currentFee ?? 0);
    const seguro = field === 'seguroAmount' ? value : (existing?.seguroAmount ?? 0);

    const payDoc = {
        id: docId,
        studentId,
        studentName: student ? `${student.lastName}, ${student.firstName}` : studentId,
        activityId: actId,
        activityName: s.activity?.name || actId,
        monthKey,
        status: existing?.status || 'pending',
        grossAmount: cuota,
        seguroAmount: seguro,
        finalAmount: cuota + seguro,
        paymentMethod: field === 'paymentMethod' ? value : (existing?.paymentMethod || 'cash'),
        receiptNumber: existing?.receiptNumber || null,
        paidAt: existing?.paidAt || null,
        collectedBy: existing?.collectedBy || { uid: state.currentUser.uid, displayName: state.currentUser.displayName || '' },
        updatedAt: serverTimestamp(),
        updatedBy: state.currentUser.uid,
    };
    await savePaymentDoc(docId, payDoc);
    s.paymentMap[studentId] = { ...payDoc };
}

export async function savePaymentDoc(docId, data) {
    try {
        await setDoc(doc(db, 'payments', docId), data, { merge: true });
    } catch (e) {
        showToast('Error al guardar: ' + e.message, 'error');
    }
}

export async function sendPaymentWhatsApp(paymentId, studentId, phone, studentName, activityName, monthKey, totalAmount) {
    const [yr, mo] = monthKey.split('-');
    const mes = `${MONTH_NAMES_ES[+mo - 1]} ${yr}`;
    const text = `✅ *Pago registrado — Escuela Deportiva CASTA*\n\n👤 Alumno: ${studentName}\n🏃 Actividad: ${activityName}\n📅 Mes: ${mes}\n💰 Total abonado: ${formatCurrency(totalAmount)}\n\n_Este mensaje es un resumen informativo y no constituye un comprobante con validez legal._`;
    const clean = phone.replace(/\\D/g, '');
    window.open(`https://wa.me/549${clean}?text=${encodeURIComponent(text)}`, '_blank');

    if (paymentId) {
        try {
            await setDoc(doc(db, 'payments', paymentId), { waSent: true, waSentAt: serverTimestamp() }, { merge: true });
            
            const s = window._payState;
            if (s && s.paymentMap && s.paymentMap[studentId]) {
                s.paymentMap[studentId].waSent = true;
                renderPaymentsGrid(s.enrolledStudents, s.paymentMap, s.actId, s.activity, s.monthKey);
            }
        } catch(e) {
            console.error("Error updating waSent flag:", e);
        }
    }
}
