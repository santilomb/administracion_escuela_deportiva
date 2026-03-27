# ⚽ CASTA — Escuela Deportiva · Sistema de Administración

Aplicación web progresiva (PWA) para la gestión integral de una escuela de deportes.  
Corre directamente en el navegador del celular, sin necesidad de instalar nada.  
**Compatible con el plan Spark (gratuito) de Firebase.**

---

## 🚀 Tecnologías

| Capa | Tecnología |
|------|------------|
| Frontend | HTML5 + CSS3 + JavaScript (ES Modules) |
| Base de datos | Firebase Firestore |
| Autenticación | Firebase Auth (Google Sign-In) |
| Hosting | Firebase Hosting |
| PDF | jsPDF (generado en el cliente) |

> ℹ️ No se usan Cloud Functions. Toda la lógica corre en el cliente o en Firestore directamente.

---

## 📱 Funcionalidades

- **Alumnos** — Alta, edición, búsqueda y filtrado
- **Actividades** — CRUD con días, horarios, cuota, fechas de vigencia y profesor asignado
- **Profesores (Staff)** — Alta y vinculación automática por email al iniciar sesión
- **Asistencia** — Control de asistencia por actividad y fecha
- **Pagos** — Registro de pagos mensuales con número de comprobante correlativo (`CASTA-000001`), descuentos automáticos y generación de recibo PDF
- **Reversa de pagos** — Solo administradores pueden revertir un pago a pendiente
- **Exportación CSV** — Alumnos por actividad, pagos por mes, listado de deudores
- **Dashboard** — Resumen de estadísticas en tiempo real

---

## 🏗️ Estructura del proyecto

```
administracion_escuela_deportiva/
├── web-app/                 # Aplicación web (lo que se despliega y usa)
│   ├── index.html           # Shell HTML de la SPA
│   ├── app.js               # Lógica completa (Firebase, UI, pagos, PDF)
│   ├── style.css            # Estilos (mobile-first, glassmorphism)
│   ├── manifest.json        # PWA manifest
│   └── sw.js                # Service Worker
├── firestore.rules          # Reglas de seguridad Firestore
├── firestore.indexes.json   # Índices de Firestore
└── firebase.json            # Configuración Firebase CLI (Hosting + Firestore)
```

---

## ⚙️ Requisitos previos

1. **Node.js** ≥ 20 — [nodejs.org](https://nodejs.org)
2. **Firebase CLI** — `npm install -g firebase-tools`
3. Cuenta Firebase con plan **Spark (gratuito)**

---

## 🛠️ Desarrollo local

```powershell
# Servir la web app localmente
npx serve web-app --listen 3334

# Abrir en el celular (misma red WiFi):
# http://<IP-de-tu-PC>:3334
```

---

## 🚢 Despliegue en producción (Firebase Hosting)

```powershell
firebase login
firebase use --add          # Seleccionar proyecto: escuela-deportiva-casta

# Desplegar reglas e índices Firestore
firebase deploy --only firestore

# Desplegar la web app
firebase deploy --only hosting
```

---

## 👤 Primer uso — Crear administrador

El primer usuario que inicia sesión queda con `role: prof` y `active: false`.  
Para activarlo como administrador:

1. Ir a **Firebase Console → Firestore → colección `users`**
2. Abrir el documento con el UID del usuario
3. Modificar: `role: "admin"` y `active: true`

---

## 📋 Colecciones Firestore

| Colección | Descripción |
|-----------|-------------|
| `users` | Usuarios autenticados (role, active, staffId) |
| `staff` | Profesores (email, specialty, linkedUid) |
| `students` | Alumnos (datos personales + familyKey) |
| `activities` | Actividades (días, horario, cuota, startDate, endDate, professorId) |
| `enrollments` | Inscripciones alumno↔actividad |
| `attendance` | Registros de asistencia por fecha |
| `payments` | Pagos mensuales (status: paid / reverted, receiptNumber) |
| `counters/receiptCounter` | Contador correlativo de comprobantes |
