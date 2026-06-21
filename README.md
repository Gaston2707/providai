<<<<<<< HEAD
# ProvidAI ⚖️
### Tu proveído, siempre a mano

App para abogados que permite buscar expedientes en MEV (Mesa de Entradas Virtual - SCBA) y exportar los proveídos a Excel.

---

## 🚀 Setup inicial (hacer una sola vez)

### 1. Supabase - Configurar base de datos
1. Abrí [supabase.com](https://supabase.com) → tu proyecto `providai`
2. Menú izquierdo → **SQL Editor**
3. Copiá todo el contenido de `supabase_setup.sql` y ejecutalo
4. Esperá que diga "Success"

### 2. Crear tu usuario Admin
1. Abrí la app (tu URL de Netlify)
2. Registrate con tu email y contraseña
3. Volvé a Supabase → SQL Editor y ejecutá:
```sql
UPDATE public.profiles
SET role = 'admin', approved = true
WHERE email = 'TU_EMAIL_AQUI';
```
4. Ahora podés iniciar sesión como admin

### 3. Netlify - Variables de entorno (opcional, para emails)
1. Netlify → tu sitio → **Site settings** → **Environment variables**
2. Agregá:
   - `SUPABASE_URL` = tu URL de Supabase
   - `SUPABASE_SERVICE_KEY` = tu service_role key (en Supabase > Settings > API)

---

## 📁 Estructura del proyecto

```
providai/
├── index.html              → Login / Registro
├── dashboard.html          → Panel del abogado
├── admin.html              → Panel del administrador
├── pending.html            → Página cuenta pendiente
├── assets/
│   └── style.css           → Estilos globales
├── js/
│   ├── auth.js             → Supabase auth helpers
│   ├── mev.js              → Cliente MEV (proxy)
│   └── excel.js            → Exportación Excel
├── netlify/functions/
│   ├── mev-proxy.js        → Proxy para MEV (evita CORS)
│   └── notify-user.js      → Notificación email
├── netlify.toml            → Config Netlify Functions
├── supabase_setup.sql      → Script SQL inicial
└── .gitignore
```

---

## 🔄 Flujo de trabajo diario

```
1. Modificás código en VS Code
2. Guardás los archivos
3. En VS Code: Source Control (ícono Git) → escribís un mensaje → Commit → Sync
4. Netlify detecta el push y redespliega automáticamente (2 minutos)
```

---

## 👥 Flujo de usuarios

1. Abogado se registra en la app
2. Admin recibe notificación y aprueba desde `/admin.html`
3. Abogado puede iniciar sesión
4. Abogado guarda sus credenciales MEV
5. Busca expedientes → extrae proveídos → exporta a Excel

---

## ⚠️ Notas importantes

- Las credenciales MEV se guardan en Supabase (tabla `profiles`)
- El proxy MEV funciona como Netlify Function (serverless)
- El scraping puede requerir ajustes según la estructura actual de MEV
- Puede haber una fase de debugging del scraping una vez que tengas credenciales MEV reales para probar
=======
# providai
App de gestión de expedientes judiciales
>>>>>>> 790a00705cab50a193f3e7ffe39470454e6f68f8
