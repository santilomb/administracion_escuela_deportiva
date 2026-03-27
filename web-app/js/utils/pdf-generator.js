import { formatCurrency, monthKeyToLabel } from './helpers.js';
import { state } from '../core/state.js';

export async function getLogoBase64() {
    if (window._logoBase64) return window._logoBase64;
    try {
        const res = await fetch('logo.png');
        const blob = await res.blob();
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => { window._logoBase64 = reader.result; resolve(reader.result); };
            reader.readAsDataURL(blob);
        });
    } catch (e) { return null; }
}

export async function generateReceiptPDF(payment, student, activity) {
    try {
        const { jsPDF } = window.jspdf;
        if (!jsPDF) { console.warn('jsPDF not loaded'); return; }

        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = 210;    
        const blue = [30, 100, 200];
        const gray = [120, 120, 120];
        const dark = [30, 30, 30];

        pdf.setFillColor(...blue);
        pdf.rect(0, 0, W, 38, 'F');

        const logoB64 = await getLogoBase64();
        let titleX = 15;
        if (logoB64) {
            pdf.addImage(logoB64, 'PNG', 12, 4, 16, 16);
            titleX = 32;
        }

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(22); pdf.setFont('helvetica', 'bold');
        pdf.text('Escuela Deportiva CASTA', titleX, 16);
        pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
        pdf.text('Comprobante de Pago', titleX, 23);

        pdf.setFontSize(9);
        const dateStr = (payment.paidAt instanceof Date ? payment.paidAt : new Date()).toLocaleString('es-AR');
        pdf.text(`N° ${payment.receiptNumber}`, W - 15, 16, { align: 'right' });
        pdf.text(dateStr, W - 15, 23, { align: 'right' });

        let y = 50;

        const drawSection = (title, rows) => {
            pdf.setFillColor(240, 244, 255);
            pdf.rect(10, y - 5, W - 20, 8, 'F');
            pdf.setTextColor(...blue);
            pdf.setFontSize(10); pdf.setFont('helvetica', 'bold');
            pdf.text(title, 14, y);
            y += 7;
            pdf.setTextColor(...dark);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            rows.forEach(([label, value]) => {
                pdf.setTextColor(...gray);
                pdf.text(label, 14, y);
                pdf.setTextColor(...dark);
                pdf.text(String(value || '—'), 70, y);
                y += 7;
            });
            y += 4;
        };

        const methodLabels = { cash: 'Efectivo', transfer: 'Transferencia bancaria', mercadopago: 'MercadoPago' };

        drawSection('ALUMNO', [
            ['Nombre', student ? `${student.lastName}, ${student.firstName}` : payment.studentName],
        ]);

        drawSection('ACTIVIDAD', [
            ['Actividad', activity ? activity.name : payment.activityName],
            ['Mes', monthKeyToLabel(payment.monthKey)],
        ]);

        pdf.setFillColor(240, 244, 255);
        pdf.rect(10, y - 5, W - 20, 8, 'F');
        pdf.setTextColor(...blue);
        pdf.setFontSize(10); pdf.setFont('helvetica', 'bold');
        pdf.text('DETALLE DEL PAGO', 14, y);
        y += 9;

        const drawRow = (label, amount, bold = false, color = dark) => {
            pdf.setTextColor(...color);
            pdf.setFont('helvetica', bold ? 'bold' : 'normal');
            pdf.setFontSize(10);
            pdf.text(label, 14, y);
            pdf.text(formatCurrency(amount), W - 15, y, { align: 'right' });
            y += 7;
        };

        drawRow('Cuota mensual', payment.grossAmount);
        if (payment.seguroAmount > 0) drawRow('Seguro', payment.seguroAmount);

        pdf.setDrawColor(200, 200, 200);
        pdf.line(10, y, W - 10, y);
        y += 5;

        drawRow('TOTAL ABONADO', payment.finalAmount, true, blue);
        y += 2;
        drawRow('Medio de pago', 0, false, gray); 
        y -= 7; 
        pdf.setTextColor(...dark); pdf.setFont('helvetica', 'normal');
        pdf.text(methodLabels[payment.paymentMethod] || payment.paymentMethod, W - 15, y, { align: 'right' });
        y += 12;

        pdf.setFontSize(8); pdf.setTextColor(...gray);
        pdf.text(`Registrado por: ${payment.collectedBy?.displayName || payment.collectedBy?.email || state.currentUser?.displayName || ''}`, 14, y);
        y += 5;

        pdf.setFillColor(...blue);
        pdf.rect(0, 287, W, 10, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.text('Escuela Deportiva CASTA — Comprobante generado digitalmente', W / 2, 291, { align: 'center' });
        pdf.setFontSize(7);
        pdf.text('Este documento no constituye un comprobante con validez legal. Es un resumen informativo de pago.', W / 2, 296, { align: 'center' });

        pdf.save(`recibo-${payment.receiptNumber}.pdf`);
    } catch (err) {
        console.error('PDF generation error:', err);
    }
}
