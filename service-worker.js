// ═══════════════════════════════════════════════════════
// SERVICE WORKER — Auditoria APR
// Cacheia o "app shell" (HTML/CSS/JS/fontes/ícones) para permitir
// instalação no celular e abertura rápida/offline da interface.
// Chamadas ao Firebase (Firestore/Auth) NÃO são interceptadas —
// a app já tem sua própria lógica de fila offline para isso.
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'auditoria-apr-v4';

const ASSETS_ESTATICOS = [
  './',
  './index.html',
  './instalar.html',
  './style.css',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-32.png',
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

// Permite que a página force a ativação imediata de um service worker novo
// que esteja esperando — usado pela função registrarServiceWorker() no app.js.
self.addEventListener('message', (event) => {
  if (event.data && event.data.tipo === 'ATIVAR_AGORA') {
    self.skipWaiting();
  }
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

// Arquivos de CÓDIGO (HTML/CSS/JS): mudam com frequência a cada atualização
// do sistema. Usar network-first garante que a versão mais nova sempre seja
// exibida quando há internet — o cache só entra em ação se a rede falhar.
const ARQUIVOS_CODIGO = ['.html', '.css', '.js', '.json'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Não intercepta requisições para Firebase/CDNs externos —
  // deixa passar direto para a rede, sem cache do service worker.
  if (DOMINIOS_IGNORADOS.some((dominio) => url.hostname.includes(dominio))) {
    return;
  }

  // Apenas GET é cacheável.
  if (event.request.method !== 'GET') return;

  const ehArquivoDeCodigo = ARQUIVOS_CODIGO.some((ext) => url.pathname.endsWith(ext)) || url.pathname.endsWith('/');

  if (ehArquivoDeCodigo) {
    // NETWORK-FIRST: tenta a rede primeiro; só usa o cache se estiver offline.
    event.respondWith(
      fetch(event.request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.status === 200) {
            const clone = respostaRede.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return respostaRede;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Demais arquivos (ícones, imagens): CACHE-FIRST com atualização em segundo
  // plano — eles raramente mudam, então prioriza velocidade de abertura.
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
        .catch(() => respostaCache);

      return respostaCache || buscaRede;
    })
  );
});
