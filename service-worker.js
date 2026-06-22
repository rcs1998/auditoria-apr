// ═══════════════════════════════════════════════════════
// SERVICE WORKER — Auditoria APR
// Cacheia o "app shell" (HTML/CSS/JS/fontes/ícones) para permitir
// instalação no celular e abertura rápida/offline da interface.
// Chamadas ao Firebase (Firestore/Auth) NÃO são interceptadas —
// a app já tem sua própria lógica de fila offline para isso.
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'auditoria-apr-v1';

const ASSETS_ESTATICOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Domínios que NUNCA devem ser cacheados ou interceptados pelo SW
// (Firebase, Chart.js, fontes do Google — sempre buscar da rede/CDN).
const DOMINIOS_IGNORADOS = [
  'firestore.googleapis.com',
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_ESTATICOS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Não intercepta requisições para Firebase/CDNs externos —
  // deixa passar direto para a rede, sem cache do service worker.
  if (DOMINIOS_IGNORADOS.some((dominio) => url.hostname.includes(dominio))) {
    return;
  }

  // Apenas GET é cacheável.
  if (event.request.method !== 'GET') return;

  // Estratégia: cache-first com atualização em segundo plano
  // (stale-while-revalidate) — abre rápido, mas mantém os arquivos atualizados.
  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      const buscaRede = fetch(event.request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.status === 200) {
            const clone = respostaRede.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return respostaRede;
        })
        .catch(() => respostaCache); // sem rede: usa o que tiver em cache

      return respostaCache || buscaRede;
    })
  );
});
