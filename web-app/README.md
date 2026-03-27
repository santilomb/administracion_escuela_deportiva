# 🌐 CASTA Web App — Guía de Setup

## Estructura

```
web-app/
├── index.html      ← Toda la UI (SPA)
├── style.css       ← Estilos
├── app.js          ← Lógica JS + Firebase
├── manifest.json   ← PWA manifest
└── sw.js           ← Service Worker (offline)
```

## Paso 1 — Configurar Firebase

Abrir `web-app/app.js` y reemplazar el objeto `firebaseConfig` con los datos reales del proyecto Firebase:

```js
const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROJECT.firebaseapp.com",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc",
};
```

Esos datos los encontrás en **Firebase Console → Configuración del proyecto → Tus apps → Web**.

## Paso 2 — Activar dominio para Google Auth

En **Firebase Console → Authentication → Sign-in method → Google → Dominios autorizados**, agregar:
- `localhost` (para pruebas locales)
- El dominio donde lo servís (ej: `tu-proyecto.web.app`)

## Paso 3 — Correr localmente

### Opción A: Con `npx serve` (recomendado)
```powershell
cd web-app
npx serve .
```
Se abre en `http://localhost:3000`

### Opción B: Con Python
```powershell
cd web-app
python -m http.server 8080
```
Se abre en `http://localhost:8080`

### Opción C: Con Firebase Hosting local
```powershell
firebase serve --only hosting
```

> ⚠️ Importante: **NO abrir el index.html directamente** con `file://` — Firebase Auth no funciona sin un servidor HTTP.

## Paso 4 — Acceder desde el celular

1. Correr el servidor en la PC
2. Conectar el celular a la misma WiFi
3. Abrir el browser del celular y navegar a `http://IP_DE_TU_PC:3000`
   - Ver la IP con: `ipconfig` (Windows) → IPv4 Address
   - Ej: `http://192.168.1.100:3000`

## Paso 5 — Instalar como PWA (opcional)

En el celular, en el browser:
- **Android Chrome**: menú → "Agregar a la pantalla de inicio"
- **iOS Safari**: compartir → "Agregar a inicio"

Esto la pone en el home como una app nativa.

## Paso 6 — Deploy en Firebase Hosting (acceso desde cualquier lado)

```powershell
# Actualizar firebase.json para apuntar a web-app/
firebase deploy --only hosting
```

Quedaría disponible en `https://TU_PROYECTO.web.app` para todos.

---

## Funcionalidades

| Módulo | Descripción |
|--------|-------------|
| 🔐 Login | Google Auth (solo usuarios autorizados) |
| 📊 Dashboard | Stats rápidos + actividades del día |
| 👨‍🎓 Alumnos | CRUD completo + búsqueda por nombre/DNI |
| 🏃 Actividades | CRUD (solo admin) |
| 📋 Inscripciones | Inscribir alumnos a actividades (desde ficha del alumno) |
| ✅ Asistencia | Checklist por actividad y fecha, guarda en Firestore |
| 💰 Pagos | Ver últimos 6 meses por alumno, registrar pago con descuentos |
| 📤 Exportar | CSV de alumnos por actividad, pagos por mes, deudores |

## Arquitectura

- **Frontend**: HTML + Vanilla JS + CSS puro (sin npm, sin bundler)
- **Backend**: Firebase Firestore (realtime) + Cloud Functions (pagos)
- **Auth**: Firebase Auth con Google
- **Offline**: Service Worker (caché de assets)
- **Deploy**: Firebase Hosting o cualquier servidor HTTP estático

## Roles

- **admin**: acceso completo a todo
- **prof**: puede cargar asistencia y registrar pagos; NO puede crear/editar actividades
