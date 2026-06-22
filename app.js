/* ═══════════════════════════════════════════════════════════════
   AUDITORIA APR — app.js
   Organizado por responsabilidade:
   1. CONFIG / ESTADO GLOBAL
   2. FIREBASE (init)
   3. AUTENTICAÇÃO
   4. PERMISSÕES / NÍVEIS DE ACESSO
   5. PERGUNTAS (Firestore + render do formulário)
   6. UNIDADES & PARCEIROS
   7. ENVIO DE AUDITORIA (+ validação + modo offline)
   8. DASHBOARD
   9. REGISTROS (+ exportação CSV)
   10. CONFIGURAÇÕES (Unidades / Parceiros / Usuários)
   11. NAVEGAÇÃO
   12. UI HELPERS (toast, loading, showScreen)
   13. PWA (service worker + sincronização offline)
   ═══════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════
// 1. CONFIG / ESTADO GLOBAL
// ═══════════════════════════════════════════════════════
const SECAO_NOMES_DEFAULT = {
  'q-bloco-id':         '2. Identificação da APR',
  'q-bloco-riscos':     '3. Identificação de Riscos',
  'q-bloco-controles':  '4. Medidas de Controle',
  'q-bloco-qualidade':  '5. Qualidade da APR',
  'q-bloco-evidencias': '6. Evidências',
  'q-bloco-desvios':    '7. Desvios e Não Conformidades',
};

// Define a ordem de exibição das seções no formulário e na página de Perguntas.
const ORDEM_SECOES_DEFAULT = [
  'q-bloco-id', 'q-bloco-riscos', 'q-bloco-controles',
  'q-bloco-qualidade', 'q-bloco-evidencias', 'q-bloco-desvios',
];

const PERGUNTAS_DEFAULT = {
  'q-bloco-id': [
    { id:'q1', texto:'APR possui identificação da atividade?',    peso:1, tipo:'sn', invertida:false },
    { id:'q2', texto:'Data está preenchida na APR?',              peso:1, tipo:'sn', invertida:false },
    { id:'q3', texto:'Equipe está listada?',                      peso:1, tipo:'sn', invertida:false },
  ],
  'q-bloco-riscos': [
    { id:'q4', texto:'Riscos foram identificados?',               peso:3, tipo:'sn', invertida:false },
    { id:'q5', texto:'Os riscos são compatíveis com a atividade?',peso:1, tipo:'sn', invertida:false },
  ],
  'q-bloco-controles': [
    { id:'q6', texto:'Existem controles para os riscos?',         peso:3, tipo:'sn', invertida:false },
    { id:'q7', texto:'Os controles são específicos (não genéricos)?', peso:1, tipo:'sn', invertida:false },
  ],
  'q-bloco-qualidade': [
    { id:'q8',  texto:'APR está clara e legível?',                peso:1, tipo:'sn', invertida:false },
    { id:'q9',  texto:'Foi copiada de outra APR sem adaptação?',  peso:1, tipo:'sn', invertida:true },
    { id:'q10', texto:'Nota geral da APR (0 a 10)', peso:1, tipo:'nota', invertida:false },
  ],
  'q-bloco-evidencias': [
    { id:'q11', texto:'Registro / evidência fotográfica presente?', peso:1, tipo:'sn', invertida:false },
  ],
  'q-bloco-desvios': [
    { id:'q12', texto:'Existe não conformidade identificada?', peso:1, tipo:'sn', invertida:true },
  ],
};

let SECAO_NOMES   = JSON.parse(JSON.stringify(SECAO_NOMES_DEFAULT));
let PERGUNTAS     = JSON.parse(JSON.stringify(PERGUNTAS_DEFAULT));
let ORDEM_SECOES  = JSON.parse(JSON.stringify(ORDEM_SECOES_DEFAULT));


const RESPOSTAS   = {};
const COMENTARIOS = {};
const CORES_EMPRESA = ['#1B6B2E','#16A34A','#D97706','#1D4ED8','#DC2626','#7C3AED','#0891B2','#DB2777'];

let notaSelecionada = null;
let unidades = [], parceiros = {};
let AUDITORIAS = [];
let CHARTS = {};
let NIVEL_ATUAL = 'tecnico';
let db, auth;

const NIVEIS_PAGINAS = {
  tecnico: ['formulario'],
  gestor:  ['formulario','dashboard','registros','perguntas','usuarios'],
  admin:   ['formulario','dashboard','registros','perguntas','usuarios','config'],
};

const NIVEL_LABEL = { tecnico:'Técnico', gestor:'Gestor', admin:'Admin' };

const PAGE_TITLES = {
  formulario:'Nova Auditoria', dashboard:'Dashboard', registros:'Registros',
  perguntas:'Perguntas', usuarios:'Usuários', config:'Configurações'
};

const OFFLINE_QUEUE_KEY = 'aprOfflineQueue';

// ═══════════════════════════════════════════════════════
// 2. FIREBASE
// ═══════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC5Kz7Hns8sHhUNKZUODAsPc_JjXI1eyBE",
  authDomain: "auditoria-apr-1.firebaseapp.com",
  projectId: "auditoria-apr-1",
  storageBucket: "auditoria-apr-1.firebasestorage.app",
  messagingSenderId: "70897842287",
  appId: "1:70897842287:web:d47ef7b13d9fa91e8ab59a"
};

function initFirebase(cfg) {
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db   = firebase.firestore();
    auth = firebase.auth();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* não suportado, ok */ });

    auth.onAuthStateChanged(user => {
      if (user) onLogin(user);
      else showScreen('s-login');
    });
  } catch(e) {
    showToast(mensagemErroAmigavel(e), 'error');
  }
}

window.onload = () => {
  setDefaultDate();
  initFirebase(FIREBASE_CONFIG);
  registrarServiceWorker();
  monitorarConexao();
};

function setDefaultDate() {
  document.getElementById('fData').value = new Date().toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════
// 3. AUTENTICAÇÃO
// ═══════════════════════════════════════════════════════
async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value;
  const err = document.getElementById('loginErr');
  err.style.display = 'none';

  if (!email || !validarEmail(email)) {
    err.textContent = 'Digite um e-mail válido.';
    err.style.display = 'block';
    return;
  }
  if (!senha) {
    err.textContent = 'Digite sua senha.';
    err.style.display = 'block';
    return;
  }

  setLoading('btnLogin', true, 'Entrando...');
  try {
    await auth.signInWithEmailAndPassword(email, senha);
  } catch(e) {
    err.textContent = mensagemErroAmigavel(e);
    err.style.display = 'block';
  } finally {
    setLoading('btnLogin', false, 'Entrar');
  }
}

async function fazerLogout() {
  await auth.signOut();
}

async function onLogin(user) {
  showScreen('s-app');
  const initial = (user.displayName || user.email || '?')[0].toUpperCase();
  document.getElementById('userAvatar').textContent = initial;
  document.getElementById('userName').textContent   = user.displayName || user.email;
  const avatarMobile = document.getElementById('userAvatarMobile');
  if (avatarMobile) avatarMobile.textContent = initial;

  let userDoc;
  try {
    userDoc = await db.collection('usuarios').doc(user.uid).get();
  } catch(e) {
    showToast('Não foi possível verificar permissões. Conectando offline com nível restrito.', 'error');
  }
  NIVEL_ATUAL = (userDoc && userDoc.exists) ? (userDoc.data().nivel || 'tecnico') : 'tecnico';

  if (NIVEL_ATUAL !== 'admin') {
    try {
      const adminDoc = await db.collection('config').doc('admins').get();
      const admins = adminDoc.exists ? (adminDoc.data().emails || []) : [];
      if (admins.includes(user.email)) {
        NIVEL_ATUAL = 'admin';
        await db.collection('usuarios').doc(user.uid).set(
          { email: user.email, nome: user.displayName || user.email, nivel: 'admin' },
          { merge: true }
        );
      }
    } catch(e) { /* fallback best-effort */ }
  }

  aplicarPermissoes(NIVEL_ATUAL);
  irParaPaginaInicial();

  await carregarPerguntas();
  await carregarUnidadesForm();
  await carregarAuditorias();
  await sincronizarFilaOffline();
}

// ═══════════════════════════════════════════════════════
// 4. PERMISSÕES / NÍVEIS DE ACESSO
// ═══════════════════════════════════════════════════════
function aplicarPermissoes(nivel) {
  const paginasPermitidas = NIVEIS_PAGINAS[nivel] || NIVEIS_PAGINAS.tecnico;

  document.getElementById('nav-dashboard').style.display = paginasPermitidas.includes('dashboard') ? 'flex' : 'none';
  document.getElementById('nav-registros').style.display = paginasPermitidas.includes('registros') ? 'flex' : 'none';
  document.getElementById('nav-perguntas').style.display = paginasPermitidas.includes('perguntas') ? 'flex' : 'none';
  document.getElementById('nav-usuarios').style.display  = paginasPermitidas.includes('usuarios')  ? 'flex' : 'none';
  document.getElementById('nav-config').style.display       = paginasPermitidas.includes('config') ? 'flex' : 'none';
  document.getElementById('nav-config-label').style.display = paginasPermitidas.includes('config') ? 'block' : 'none';
}

async function criarUsuario() {
  const email = document.getElementById('novoEmail').value.trim();
  const senha = document.getElementById('novaSenha').value;
  const nome  = document.getElementById('novoNome').value.trim();
  const nivel = document.getElementById('novoNivel').value;

  if (!nome)  { showToast('Digite o nome do usuário', 'error'); return; }
  if (!validarEmail(email)) { showToast('Digite um e-mail válido', 'error'); return; }
  if (!senha || senha.length < 6) { showToast('A senha deve ter no mínimo 6 caracteres', 'error'); return; }

  setLoading('btnCriarUsuario', true, 'Criando...');
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    await cred.user.updateProfile({ displayName: nome });
    await db.collection('usuarios').doc(cred.user.uid).set({ email, nome, nivel, criadoEm: new Date() });
    document.getElementById('novoEmail').value = '';
    document.getElementById('novaSenha').value = '';
    document.getElementById('novoNome').value  = '';
    document.getElementById('novoNivel').value = 'tecnico';
    showToast('Usuário criado com sucesso!', 'success');
    await renderUsuariosConfig();
  } catch(e) {
    showToast(mensagemErroAmigavel(e), 'error');
  } finally {
    setLoading('btnCriarUsuario', false, '+ Criar');
  }
}

async function alterarNivelUsuario(uid, nivel) {
  try {
    await db.collection('usuarios').doc(uid).update({ nivel });
    showToast('Nível de acesso atualizado!', 'success');
  } catch(e) {
    showToast(mensagemErroAmigavel(e), 'error');
  }
}

async function renderUsuariosConfig() {
  const snap = await db.collection('usuarios').get();
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  document.getElementById('listaUsuarios').innerHTML = users.length
    ? users.map(u => `<div class="item-row">
        <div>
          <div class="item-label">${escapeHtml(u.nome)}</div>
          <div class="item-sub">${escapeHtml(u.email)}</div>
        </div>
        <select onchange="alterarNivelUsuario('${u.uid}', this.value)" style="padding:6px 10px;border-radius:8px;border:1px solid var(--slate200,#ccc)">
          <option value="tecnico" ${u.nivel==='tecnico'?'selected':''}>Técnico</option>
          <option value="gestor" ${u.nivel==='gestor'?'selected':''}>Gestor</option>
          <option value="admin" ${u.nivel==='admin'?'selected':''}>Admin</option>
        </select>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--slate500);padding:8px">Nenhum usuário cadastrado.</div>';
}

// ═══════════════════════════════════════════════════════
// 5. PERGUNTAS (Firestore + render do formulário)
// ═══════════════════════════════════════════════════════
async function carregarPerguntas() {
  try {
    const doc = await db.collection('config').doc('perguntas').get();
    if (doc.exists && doc.data().secoes) {
      const dados = doc.data();
      PERGUNTAS = dados.secoes;
      SECAO_NOMES = dados.nomes || JSON.parse(JSON.stringify(SECAO_NOMES_DEFAULT));
      // "ordem" é novo — se o documento ainda não tiver, monta a partir das chaves existentes.
      ORDEM_SECOES = dados.ordem && dados.ordem.length ? dados.ordem : Object.keys(PERGUNTAS);
    } else {
      PERGUNTAS = JSON.parse(JSON.stringify(PERGUNTAS_DEFAULT));
      SECAO_NOMES = JSON.parse(JSON.stringify(SECAO_NOMES_DEFAULT));
      ORDEM_SECOES = JSON.parse(JSON.stringify(ORDEM_SECOES_DEFAULT));
      await db.collection('config').doc('perguntas').set({ secoes: PERGUNTAS, nomes: SECAO_NOMES, ordem: ORDEM_SECOES });
    }
  } catch(e) {
    PERGUNTAS = JSON.parse(JSON.stringify(PERGUNTAS_DEFAULT));
    SECAO_NOMES = JSON.parse(JSON.stringify(SECAO_NOMES_DEFAULT));
    ORDEM_SECOES = JSON.parse(JSON.stringify(ORDEM_SECOES_DEFAULT));
  }
  renderPerguntas();
  renderSelectSecoes();
}

async function salvarPerguntas() {
  await db.collection('config').doc('perguntas').set({ secoes: PERGUNTAS, nomes: SECAO_NOMES, ordem: ORDEM_SECOES });
}

/** Preenche o <select> de seções da página "Perguntas" respeitando ORDEM_SECOES. */
function renderSelectSecoes() {
  const sel = document.getElementById('pgSecaoSel');
  if (!sel) return;
  const valorAtual = sel.value;
  sel.innerHTML = ORDEM_SECOES.map((id, idx) =>
    `<option value="${id}">${idx+1}. ${escapeHtml(SECAO_NOMES[id] || id)}</option>`
  ).join('');
  // Mantém a seleção anterior se ela ainda existir, senão seleciona a primeira.
  if (ORDEM_SECOES.includes(valorAtual)) sel.value = valorAtual;
  renderPerguntasConfig();
}

async function salvarNomeSecao() {
  const secaoId = document.getElementById('pgSecaoSel').value;
  const nome = document.getElementById('pgNomeSecao').value.trim();
  if (!nome) { showToast('Digite o nome da seção','error'); return; }
  SECAO_NOMES[secaoId] = nome;
  await salvarPerguntas();
  renderPerguntas();
  renderSelectSecoes();
  showToast('Nome da seção atualizado!', 'success');
}

async function adicionarSecao() {
  const nome = document.getElementById('pgNovaSecaoNome').value.trim();
  if (!nome) { showToast('Digite o nome da nova seção','error'); return; }

  const novoId = 'q-secao-' + Date.now();
  SECAO_NOMES[novoId] = nome;
  PERGUNTAS[novoId] = [];
  ORDEM_SECOES.push(novoId);

  await salvarPerguntas();
  document.getElementById('pgNovaSecaoNome').value = '';
  renderPerguntas();
  renderSelectSecoes();
  document.getElementById('pgSecaoSel').value = novoId;
  renderPerguntasConfig();
  showToast('Seção criada!', 'success');
}

async function removerSecao() {
  const secaoId = document.getElementById('pgSecaoSel').value;
  if (!secaoId) return;
  if (ORDEM_SECOES.length <= 1) { showToast('É preciso manter ao menos uma seção.','error'); return; }

  const nomeSecao = SECAO_NOMES[secaoId] || secaoId;
  const qtdPerguntas = (PERGUNTAS[secaoId] || []).length;
  const aviso = qtdPerguntas > 0
    ? `Remover a seção "${nomeSecao}"? Isso também excluirá as ${qtdPerguntas} pergunta(s) dela. Essa ação não pode ser desfeita.`
    : `Remover a seção "${nomeSecao}"?`;
  if (!confirm(aviso)) return;

  delete PERGUNTAS[secaoId];
  delete SECAO_NOMES[secaoId];
  ORDEM_SECOES = ORDEM_SECOES.filter(id => id !== secaoId);

  await salvarPerguntas();
  renderPerguntas();
  renderSelectSecoes();
  showToast('Seção removida!', 'success');
}

function renderPerguntasConfig() {
  const secaoId = document.getElementById('pgSecaoSel').value;
  document.getElementById('pgNomeSecao').value = SECAO_NOMES[secaoId] || '';
  const lista = PERGUNTAS[secaoId] || [];
  document.getElementById('listaPerguntas').innerHTML = lista.length
    ? lista.map((p, idx) => `<div class="item-row">
        <div style="flex:1">
          <div class="item-label">
            ${escapeHtml(p.texto)} <span class="q-peso">P${p.peso}</span>
            ${p.tipo==='nota' ? '<span class="item-sub">(nota)</span>' : ''}
            ${p.invertida ? '<span class="item-sub" style="color:var(--red)">("Não" é conforme)</span>' : ''}
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="removerPergunta('${secaoId}', ${idx})">🗑️ Remover</button>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--slate500);padding:8px">Nenhuma pergunta nesta seção.</div>';
}

async function adicionarPergunta() {
  const secaoId = document.getElementById('pgSecaoSel').value;
  const texto = document.getElementById('novaPerguntaTexto').value.trim();
  const peso = parseInt(document.getElementById('novaPerguntaPeso').value, 10) || 1;
  const tipo = document.getElementById('novaPerguntaTipo').value;
  const invertida = document.getElementById('novaPerguntaInvertida').checked;

  if (!secaoId) { showToast('Crie ou selecione uma seção primeiro','error'); return; }
  if (!texto) { showToast('Digite o texto da pergunta','error'); return; }
  if (peso < 1 || peso > 5) { showToast('O peso deve estar entre 1 e 5','error'); return; }

  if (!PERGUNTAS[secaoId]) PERGUNTAS[secaoId] = [];
  const novoId = 'q' + Date.now();
  PERGUNTAS[secaoId].push({ id: novoId, texto, peso, tipo, invertida: tipo === 'sn' ? invertida : false });

  await salvarPerguntas();
  document.getElementById('novaPerguntaTexto').value = '';
  document.getElementById('novaPerguntaPeso').value = '1';
  document.getElementById('novaPerguntaInvertida').checked = false;
  showToast('Pergunta adicionada!', 'success');
  renderPerguntas();
  renderPerguntasConfig();
}

async function removerPergunta(secaoId, idx) {
  if (!confirm('Remover esta pergunta? Essa ação não pode ser desfeita.')) return;
  PERGUNTAS[secaoId].splice(idx, 1);
  await salvarPerguntas();
  showToast('Pergunta removida!', 'success');
  renderPerguntas();
  renderPerguntasConfig();
}

/** Gera os blocos do formulário (cabeçalho + perguntas) dinamicamente,
 *  na ordem definida por ORDEM_SECOES, dentro do container fixo do HTML. */
function renderPerguntas() {
  const container = document.getElementById('secoes-dinamicas-container');
  if (!container) return;

  container.innerHTML = ORDEM_SECOES.map((secaoId, idx) => {
    const nome = SECAO_NOMES[secaoId] || secaoId;
    const perguntas = PERGUNTAS[secaoId] || [];
    const ehUltima = idx === ORDEM_SECOES.length - 1;
    const corFundo = ehUltima ? 'background:var(--red)' : '';
    return `
      <div class="form-section-header" style="${corFundo}">${escapeHtml(nome)}</div>
      <div>${perguntas.map(p => p.tipo === 'nota' ? renderNota(p) : renderSN(p)).join('')}</div>
    `;
  }).join('');
}

function renderSN(p) {
  const isHigh = p.peso >= 3;
  return `<div class="question-block">
    <div class="q-label">
      ${escapeHtml(p.texto)}
      <span class="q-peso ${isHigh?'high':''}">P${p.peso}</span>
      ${p.invertida ? '<span class="item-sub" style="color:var(--red)">("Não" é conforme)</span>' : ''}
    </div>
    <div class="radio-group">
      <label class="radio-opt" id="opt-sim-${p.id}" onclick="selectOpt('${p.id}','Sim')">
        <input type="radio" name="${p.id}" value="Sim"> ✅ Sim
      </label>
      <label class="radio-opt" id="opt-nao-${p.id}" onclick="selectOpt('${p.id}','Não')">
        <input type="radio" name="${p.id}" value="Não"> ❌ Não
      </label>
    </div>
    <div class="form-field" style="margin-top:8px">
      <input type="text" id="coment-${p.id}" placeholder="Comentário (opcional)" oninput="setComentario('${p.id}', this.value)"/>
    </div>
  </div>`;
}

function renderNota(p) {
  return `<div class="question-block">
    <div class="q-label">${escapeHtml(p.texto)} <span class="q-peso">P${p.peso}</span></div>
    <div class="nota-grid">
      ${[0,1,2,3,4,5,6,7,8,9,10].map(n =>
        `<button class="nota-btn" id="nota-btn-${n}" onclick="selectNota(${n})" type="button">${n}</button>`
      ).join('')}
    </div>
    <div class="form-field" style="margin-top:8px">
      <input type="text" id="coment-${p.id}" placeholder="Comentário (opcional)" oninput="setComentario('${p.id}', this.value)"/>
    </div>
  </div>`;
}

function setComentario(qId, valor) {
  COMENTARIOS[qId] = valor;
}

function selectOpt(qId, val) {
  RESPOSTAS[qId] = val;
  const sim = document.getElementById(`opt-sim-${qId}`);
  const nao = document.getElementById(`opt-nao-${qId}`);
  sim.className = 'radio-opt' + (val==='Sim'?' selected-sim':'');
  nao.className = 'radio-opt' + (val==='Não'?' selected-nao':'');
}

function selectNota(n) {
  notaSelecionada = n;
  document.querySelectorAll('.nota-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById(`nota-btn-${n}`).classList.add('selected');
  RESPOSTAS['q10'] = n;
}

// ═══════════════════════════════════════════════════════
// 6. UNIDADES & PARCEIROS
// ═══════════════════════════════════════════════════════
async function carregarUnidadesForm() {
  try {
    const snap = await db.collection('unidades').orderBy('nome').get();
    unidades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    showToast('Não foi possível carregar as unidades. Verifique sua conexão.', 'error');
    return;
  }

  const sel = document.getElementById('fUnidade');
  sel.innerHTML = '<option value="">Selecione a unidade...</option>';
  unidades.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.nome;
    sel.appendChild(opt);
  });

  const dSel = document.getElementById('dFiltroUnidade');
  dSel.innerHTML = '<option value="">Todas</option>';
  unidades.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.nome;
    dSel.appendChild(opt);
  });
}

async function carregarParceiros() {
  const unidadeId = document.getElementById('fUnidade').value;
  const sel = document.getElementById('fParceiro');
  sel.innerHTML = '<option value="">Carregando...</option>';
  if (!unidadeId) { sel.innerHTML = '<option value="">Selecione a unidade primeiro...</option>'; return; }

  try {
    const snap = await db.collection('unidades').doc(unidadeId).collection('parceiros').orderBy('nome').get();
    parceiros[unidadeId] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    sel.innerHTML = '<option value="">Erro ao carregar parceiros</option>';
    showToast('Não foi possível carregar os parceiros desta unidade.', 'error');
    return;
  }

  sel.innerHTML = '<option value="">Selecione o parceiro...</option>';
  parceiros[unidadeId].forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.nome; opt.textContent = p.nome;
    sel.appendChild(opt);
  });

  const dSel = document.getElementById('dFiltroParceiro');
  dSel.innerHTML = '<option value="">Todas</option>';
  parceiros[unidadeId].forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.nome; opt.textContent = p.nome;
    dSel.appendChild(opt);
  });
}

// ═══════════════════════════════════════════════════════
// 7. ENVIO DE AUDITORIA (+ validação + modo offline)
// ═══════════════════════════════════════════════════════
function validarFormularioAuditoria() {
  const unidadeId  = document.getElementById('fUnidade').value;
  const parceiro   = document.getElementById('fParceiro').value;
  const data       = document.getElementById('fData').value;
  const numeroAPR  = document.getElementById('fNumeroAPR').value.trim();
  const local      = document.getElementById('fLocal').value.trim();

  if (!unidadeId)  return 'Selecione a unidade.';
  if (!parceiro)   return 'Selecione a empresa parceira.';
  if (!data)       return 'Informe a data da auditoria.';
  if (new Date(data) > new Date(new Date().toDateString())) return 'A data da auditoria não pode ser no futuro.';
  if (!numeroAPR)  return 'Informe o número da APR.';
  if (!local)      return 'Informe o local / frente de serviço.';

  const todasPerguntas = Object.values(PERGUNTAS).flat();
  for (const p of todasPerguntas) {
    if (RESPOSTAS[p.id] === undefined) return `Responda a pergunta: "${p.texto}"`;
  }
  return null;
}

async function enviarAuditoria() {
  const erro = validarFormularioAuditoria();
  if (erro) { showToast(erro, 'error'); return; }

  const unidadeId  = document.getElementById('fUnidade').value;
  const parceiro   = document.getElementById('fParceiro').value;
  const data       = document.getElementById('fData').value;
  const numeroAPR  = document.getElementById('fNumeroAPR').value.trim();
  const local      = document.getElementById('fLocal').value.trim();
  const comentarios= document.getElementById('fComentarios').value.trim();

  const todasPerguntas = Object.values(PERGUNTAS).flat();
  const unidadeNome = unidades.find(u => u.id === unidadeId)?.nome || unidadeId;
  const user = auth.currentUser;

  let pontosObtidos = 0, pontosMaximos = 0;
  todasPerguntas.forEach(p => {
    if (p.tipo === 'nota') return;
    const resp = RESPOSTAS[p.id];
    pontosMaximos += p.peso;
    const acertou = p.invertida ? resp === 'Não' : resp === 'Sim';
    if (acertou) pontosObtidos += p.peso;
  });
  const conformidade = pontosMaximos ? Math.round((pontosObtidos / pontosMaximos) * 100) : null;

  const houveDesvio = todasPerguntas.some(p => {
    if (p.tipo === 'nota') return false;
    const esperado = p.invertida ? 'Não' : 'Sim';
    return RESPOSTAS[p.id] !== esperado;
  });

  const doc = {
    unidadeId, unidadeNome, parceiro, data, numeroAPR, local, comentarios,
    respostas: { ...RESPOSTAS },
    comentariosPerguntas: { ...COMENTARIOS },
    nota: RESPOSTAS['q10'] ?? null,
    conformidade,
    naoConformidade: houveDesvio,
    tecnico: { uid: user.uid, nome: user.displayName || user.email, email: user.email },
  };

  setLoading('btnEnviarAuditoria', true, 'Enviando...');

  if (!navigator.onLine) {
    salvarNaFilaOffline(doc);
    showToast('Sem conexão. Auditoria salva no dispositivo e será enviada quando a internet voltar. 📴', 'success');
    resetForm();
    setLoading('btnEnviarAuditoria', false, '✅ Enviar Auditoria');
    return;
  }

  try {
    await db.collection('auditorias').add({ ...doc, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    showToast('Auditoria enviada com sucesso! ✅', 'success');
    resetForm();
    await carregarAuditorias();
  } catch(e) {
    salvarNaFilaOffline(doc);
    showToast('Falha ao enviar. Auditoria salva no dispositivo e será reenviada automaticamente. 📴', 'error');
    resetForm();
  } finally {
    setLoading('btnEnviarAuditoria', false, '✅ Enviar Auditoria');
  }
}

function resetForm() {
  document.getElementById('fUnidade').value = '';
  document.getElementById('fParceiro').innerHTML = '<option value="">Selecione a unidade primeiro...</option>';
  document.getElementById('fNumeroAPR').value = '';
  document.getElementById('fLocal').value = '';
  document.getElementById('fComentarios').value = '';
  setDefaultDate();
  Object.keys(RESPOSTAS).forEach(k => delete RESPOSTAS[k]);
  Object.keys(COMENTARIOS).forEach(k => delete COMENTARIOS[k]);
  notaSelecionada = null;
  document.querySelectorAll('.radio-opt').forEach(el => el.className = 'radio-opt');
  document.querySelectorAll('.nota-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('[id^="coment-"]').forEach(el => el.value = '');
}

// ═══════════════════════════════════════════════════════
// 8. DASHBOARD
// ═══════════════════════════════════════════════════════
async function carregarAuditorias() {
  try {
    const snap = await db.collection('auditorias').orderBy('criadoEm','desc').limit(500).get();
    AUDITORIAS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDash();
    renderRegistros();
  } catch(e) {
    showToast('Não foi possível carregar os registros. Mostrando dados em cache, se houver.', 'error');
  }
}

async function atualizarDashboard() {
  setLoading('btnAtualizarDash', true, 'Atualizando...');
  await carregarAuditorias();
  setLoading('btnAtualizarDash', false, '↻ Atualizar');
}

function getFiltradas() {
  const unidade = document.getElementById('dFiltroUnidade')?.value || '';
  const parceiro= document.getElementById('dFiltroParceiro')?.value || '';
  const dias    = parseInt(document.getElementById('dFiltroPeriodo')?.value) || 0;
  const cutoff  = dias ? new Date(Date.now() - dias*864e5) : null;

  return AUDITORIAS.filter(a => {
    if (unidade && a.unidadeId !== unidade) return false;
    if (parceiro && a.parceiro !== parceiro) return false;
    if (cutoff) {
      const d = a.data ? new Date(a.data) : null;
      if (!d || d < cutoff) return false;
    }
    return true;
  });
}

function corConf(v) { return v>=90?'#16A34A':v>=75?'#D97706':'#DC2626'; }
function kc(id) { if(CHARTS[id]){ CHARTS[id].destroy(); delete CHARTS[id]; } }

function renderDash() {
  const dashLoading = document.getElementById('dashLoading');
  if (dashLoading) dashLoading.style.display = 'flex';

  const dados = getFiltradas();

  const parcMap = {};
  dados.forEach(a => {
    if (!parcMap[a.parceiro]) parcMap[a.parceiro] = { total:0, nc:0, conf:[] };
    parcMap[a.parceiro].total++;
    if (a.naoConformidade) parcMap[a.parceiro].nc++;
    if (a.conformidade != null) parcMap[a.parceiro].conf.push(a.conformidade);
  });

  const emps = Object.keys(parcMap);
  const confMed = {};
  emps.forEach(e => {
    const cs = parcMap[e].conf;
    confMed[e] = cs.length ? Math.round(cs.reduce((a,b)=>a+b,0)/cs.length) : 0;
  });

  const media   = emps.length ? Math.round(emps.reduce((s,e)=>s+confMed[e],0)/emps.length) : 0;
  const totalNC = dados.filter(a=>a.naoConformidade).length;
  const melhor  = [...emps].sort((a,b)=>confMed[b]-confMed[a])[0];

  document.getElementById('dKpiConf').textContent    = dados.length ? media+'%' : '—';
  document.getElementById('dKpiAud').textContent     = dados.length;
  document.getElementById('dKpiNC').textContent      = totalNC;
  document.getElementById('dKpiMelhor').textContent  = melhor || '—';
  document.getElementById('dKpiMelhorSub').textContent = melhor ? confMed[melhor]+'% conformidade' : '';

  kc('b');
  if (emps.length) {
    CHARTS['b'] = new Chart(document.getElementById('cBarras').getContext('2d'), {
      type:'bar',
      data:{ labels:emps, datasets:[{
        data:emps.map(e=>confMed[e]),
        backgroundColor:emps.map(e=>corConf(confMed[e])+'CC'),
        borderColor:emps.map(e=>corConf(confMed[e])),
        borderWidth:2, borderRadius:8
      }]},
      options:{ plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${c.raw}%`}}},
        scales:{ y:{min:0,max:100,grid:{color:'#F1F5F9'},ticks:{callback:v=>v+'%',font:{family:'Outfit',size:12}}},
                 x:{grid:{display:false},ticks:{font:{family:'Outfit',size:12}}} }, animation:{duration:700} }
    });
  }

  kc('nc');
  if (emps.length) {
    CHARTS['nc'] = new Chart(document.getElementById('cNC').getContext('2d'), {
      type:'doughnut',
      data:{ labels:emps, datasets:[{
        data:emps.map(e=>parcMap[e].nc||0),
        backgroundColor:CORES_EMPRESA.slice(0,emps.length),
        borderWidth:3, borderColor:'#fff'
      }]},
      options:{ plugins:{ legend:{position:'bottom',labels:{font:{family:'Outfit',size:11},padding:10}},
        tooltip:{callbacks:{label:c=>` ${c.label}: ${c.raw} NC`}} }, animation:{duration:700} }
    });
  }

  kc('l');
  const meses = {};
  dados.forEach(a => {
    if (!a.data) return;
    const d   = new Date(a.data);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const lbl = d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
    if (!meses[key]) meses[key] = { lbl, emps:{} };
    if (!meses[key].emps[a.parceiro]) meses[key].emps[a.parceiro] = [];
    if (a.conformidade != null) meses[key].emps[a.parceiro].push(a.conformidade);
  });
  const keys = Object.keys(meses).sort();
  if (keys.length) {
    CHARTS['l'] = new Chart(document.getElementById('cLinha').getContext('2d'), {
      type:'line',
      data:{ labels:keys.map(k=>meses[k].lbl), datasets:emps.map((emp,i)=>({
        label:emp, borderColor:CORES_EMPRESA[i%CORES_EMPRESA.length],
        backgroundColor:CORES_EMPRESA[i%CORES_EMPRESA.length]+'18',
        pointBackgroundColor:CORES_EMPRESA[i%CORES_EMPRESA.length],
        borderWidth:2.5, pointRadius:4, tension:0.3, spanGaps:true,
        data:keys.map(k=>{ const cs=meses[k].emps[emp]; return cs&&cs.length?Math.round(cs.reduce((a,b)=>a+b,0)/cs.length):null; })
      }))},
      options:{ plugins:{legend:{position:'bottom',labels:{font:{family:'Outfit',size:11},padding:12}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.raw}%`}}},
        scales:{ y:{min:0,max:100,grid:{color:'#F1F5F9'},ticks:{callback:v=>v+'%',font:{family:'Outfit',size:12}}},
                 x:{grid:{display:false},ticks:{font:{family:'Outfit',size:12}}} }, animation:{duration:700} }
    });
  }

  if (dashLoading) dashLoading.style.display = 'none';
}

// ═══════════════════════════════════════════════════════
// 9. REGISTROS (+ exportação CSV)
// ═══════════════════════════════════════════════════════
function renderRegistros() {
  const dados = [...AUDITORIAS].sort((a,b)=>{ const da=new Date(a.data||0),db2=new Date(b.data||0); return db2-da; });
  document.getElementById('cntReg').textContent = dados.length + ' registros';
  document.getElementById('tbodyReg').innerHTML = dados.length ? dados.map(a => {
    const isNC = a.naoConformidade;
    const n = a.nota != null ? +a.nota : null;
    const nc = n!=null?(n>=8?'#16A34A':n>=6?'#D97706':'#DC2626'):'#64748B';
    const conf = a.conformidade != null ? a.conformidade : '—';
    const corConf2 = typeof conf==='number' ? corConf(conf) : '#64748B';
    return `<tr>
      <td>${a.data || '—'}</td>
      <td>${escapeHtml(a.unidadeNome || '—')}</td>
      <td><strong>${escapeHtml(a.parceiro || '—')}</strong></td>
      <td>${escapeHtml(a.numeroAPR || '—')}</td>
      <td>${escapeHtml(a.local || '—')}</td>
      <td><span style="font-weight:800;color:${nc}">${n!=null?n+'/10':'—'}</span></td>
      <td><span style="font-weight:700;color:${corConf2}">${typeof conf==='number'?conf+'%':'—'}</span></td>
      <td><span class="badge ${isNC?'b-nc':'b-ok'}">${isNC?'⚠ NC':'✓ OK'}</span></td>
    </tr>`;
  }).join('') : `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Nenhuma auditoria registrada ainda</div></div></td></tr>`;
}

function exportarRegistrosCSV() {
  const dados = [...AUDITORIAS].sort((a,b)=>{ const da=new Date(a.data||0),db2=new Date(b.data||0); return db2-da; });
  if (!dados.length) { showToast('Não há registros para exportar.', 'error'); return; }

  setLoading('btnExportarCsv', true, 'Gerando...');
  try {
    const cabecalho = ['Data','Unidade','Empresa Parceira','Numero APR','Local','Nota','Conformidade (%)','Nao Conformidade','Tecnico','Comentarios'];
    const linhas = dados.map(a => [
      a.data || '',
      a.unidadeNome || '',
      a.parceiro || '',
      a.numeroAPR || '',
      a.local || '',
      a.nota != null ? a.nota : '',
      a.conformidade != null ? a.conformidade : '',
      a.naoConformidade ? 'Sim' : 'Não',
      a.tecnico?.nome || '',
      a.comentarios || '',
    ]);

    const csvLinhas = [cabecalho, ...linhas].map(linha =>
      linha.map(campo => {
        const valor = String(campo ?? '').replace(/"/g, '""');
        return /[",;\n]/.test(valor) ? `"${valor}"` : valor;
      }).join(';')
    );
    const csvContent = '\uFEFF' + csvLinhas.join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dataAtual = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `registros-auditoria-apr-${dataAtual}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('CSV exportado com sucesso!', 'success');
  } catch(e) {
    showToast('Erro ao gerar o CSV: ' + e.message, 'error');
  } finally {
    setLoading('btnExportarCsv', false, '⬇️ Exportar CSV');
  }
}

// ═══════════════════════════════════════════════════════
// 10. CONFIGURAÇÕES — UNIDADES & PARCEIROS
// ═══════════════════════════════════════════════════════
async function renderUnidadesConfig() {
  const snap = await db.collection('unidades').orderBy('nome').get();
  unidades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  document.getElementById('listaUnidades').innerHTML = unidades.length
    ? unidades.map(u => `<div class="item-row">
        <div class="item-label">${escapeHtml(u.nome)}</div>
        <button class="btn-icon del" onclick="excluirUnidade('${u.id}')" title="Excluir">🗑</button>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--slate500);padding:8px">Nenhuma unidade cadastrada.</div>';

  const sel = document.getElementById('cfgUnidadeSel');
  sel.innerHTML = '<option value="">Selecione uma unidade...</option>';
  unidades.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.nome;
    sel.appendChild(opt);
  });

  await carregarUnidadesForm();
}

async function adicionarUnidade() {
  const nome = document.getElementById('novaUnidade').value.trim();
  if (!nome) { showToast('Digite o nome da unidade','error'); return; }
  if (unidades.some(u => u.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe uma unidade com esse nome.', 'error'); return;
  }
  await db.collection('unidades').add({ nome, criadoEm: new Date() });
  document.getElementById('novaUnidade').value = '';
  showToast('Unidade adicionada!','success');
  await renderUnidadesConfig();
}

async function excluirUnidade(id) {
  if (!confirm('Excluir esta unidade? Os parceiros vinculados também serão removidos.')) return;
  const snap = await db.collection('unidades').doc(id).collection('parceiros').get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(db.collection('unidades').doc(id));
  await batch.commit();
  showToast('Unidade excluída','success');
  await renderUnidadesConfig();
}

async function renderParceirosConfig() {
  const unidadeId = document.getElementById('cfgUnidadeSel').value;
  const lista = document.getElementById('listaParceiros');
  const addRow = document.getElementById('addParcRow');
  if (!unidadeId) { lista.innerHTML=''; addRow.style.display='none'; return; }

  const snap = await db.collection('unidades').doc(unidadeId).collection('parceiros').orderBy('nome').get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  lista.innerHTML = items.length
    ? items.map(p => `<div class="item-row">
        <div class="item-label">${escapeHtml(p.nome)}</div>
        <button class="btn-icon del" onclick="excluirParceiro('${unidadeId}','${p.id}')" title="Excluir">🗑</button>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--slate500);padding:8px">Nenhum parceiro cadastrado nesta unidade.</div>';

  addRow.style.display = 'flex';
}

async function adicionarParceiro() {
  const unidadeId = document.getElementById('cfgUnidadeSel').value;
  const nome = document.getElementById('novoParceiro').value.trim();
  if (!unidadeId) { showToast('Selecione uma unidade','error'); return; }
  if (!nome) { showToast('Digite o nome do parceiro','error'); return; }
  await db.collection('unidades').doc(unidadeId).collection('parceiros').add({ nome, criadoEm: new Date() });
  document.getElementById('novoParceiro').value = '';
  showToast('Parceiro adicionado!','success');
  await renderParceirosConfig();
  await carregarUnidadesForm();
}

async function excluirParceiro(unidadeId, parcId) {
  if (!confirm('Excluir este parceiro?')) return;
  await db.collection('unidades').doc(unidadeId).collection('parceiros').doc(parcId).delete();
  showToast('Parceiro excluído','success');
  await renderParceirosConfig();
}

// ═══════════════════════════════════════════════════════
// 11. NAVEGAÇÃO
// ═══════════════════════════════════════════════════════
function irParaPaginaInicial() {
  // Sempre volta para "Nova Auditoria" no login — é a única página garantida
  // em todos os níveis. Evita que a tela fique "presa" numa página que o
  // usuário anterior tinha aberto (ex: Configurações) mas que este nível não acessa.
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btnFormulario = document.querySelector('.nav-btn[onclick*="formulario"]');
  goPage('formulario', btnFormulario);
}

async function goPage(id, btn) {
  const paginasPermitidas = NIVEIS_PAGINAS[NIVEL_ATUAL] || NIVEIS_PAGINAS.tecnico;
  if (!paginasPermitidas.includes(id)) {
    showToast('Você não tem permissão para acessar esta página.', 'error');
    return;
  }

  document.querySelectorAll('.page-content').forEach(p=>p.style.display='none');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).style.display = 'block';
  if(btn) btn.classList.add('active');
  document.getElementById('topbarTitle').textContent = PAGE_TITLES[id]||id;

  if (id === 'config') {
    await renderUnidadesConfig();
    await renderParceirosConfig();
  }
  if (id === 'usuarios')   await renderUsuariosConfig();
  if (id === 'perguntas')  renderSelectSecoes();
  if (id === 'dashboard')  renderDash();
  if (id === 'registros')  renderRegistros();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ═══════════════════════════════════════════════════════
// 12. UI HELPERS (toast, loading, validação, segurança)
// ═══════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ t.className='toast'; }, 3500);
}

function setLoading(btnId, loading, textoNormal) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn.dataset.textoOriginal = btn.dataset.textoOriginal || btn.textContent;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '⏳ ' + (textoNormal || 'Carregando...');
  } else {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = textoNormal || btn.dataset.textoOriginal || btn.textContent;
  }
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function mensagemErroAmigavel(e) {
  const code = e?.code || '';
  const mapa = {
    'auth/invalid-email':        'E-mail inválido.',
    'auth/user-not-found':       'E-mail ou senha incorretos.',
    'auth/wrong-password':       'E-mail ou senha incorretos.',
    'auth/invalid-credential':   'E-mail ou senha incorretos.',
    'auth/too-many-requests':    'Muitas tentativas. Aguarde um momento e tente novamente.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/weak-password':        'A senha é muito fraca. Use no mínimo 6 caracteres.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet e tente novamente.',
    'permission-denied':         'Você não tem permissão para realizar esta ação.',
    'unavailable':                'Servidor indisponível no momento. Verifique sua conexão e tente novamente.',
  };
  if (mapa[code]) return mapa[code];
  if (!navigator.onLine) return 'Você está sem conexão com a internet.';
  return 'Ocorreu um erro inesperado. Tente novamente em alguns instantes.';
}

// ═══════════════════════════════════════════════════════
// 13. PWA — Service Worker + sincronização offline
// ═══════════════════════════════════════════════════════
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('Falha ao registrar o Service Worker:', err);
    });
  });
}

function monitorarConexao() {
  window.addEventListener('online', () => {
    showToast('Conexão restabelecida. Sincronizando dados...', 'success');
    sincronizarFilaOffline();
  });
  window.addEventListener('offline', () => {
    showToast('Você está offline. As auditorias serão salvas no dispositivo.', 'error');
  });
}

function getFilaOffline() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
  catch(e) { return []; }
}

function salvarFilaOffline(fila) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(fila));
}

function salvarNaFilaOffline(doc) {
  const fila = getFilaOffline();
  fila.push({ ...doc, _criadoEmLocal: new Date().toISOString() });
  salvarFilaOffline(fila);
}

async function sincronizarFilaOffline() {
  if (!navigator.onLine || !db) return;
  const fila = getFilaOffline();
  if (!fila.length) return;

  const restantes = [];
  let enviados = 0;
  for (const item of fila) {
    try {
      const { _criadoEmLocal, ...doc } = item;
      await db.collection('auditorias').add({ ...doc, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
      enviados++;
    } catch(e) {
      restantes.push(item);
    }
  }
  salvarFilaOffline(restantes);

  if (enviados > 0) {
    showToast(`${enviados} auditoria(s) pendente(s) sincronizada(s) com sucesso! ✅`, 'success');
    await carregarAuditorias();
  }
}
