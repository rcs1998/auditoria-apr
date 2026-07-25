// === GLOBALS ===
let db,auth,authSecundario,functionsFB,CU=null,unsubAuditores=null;
let UNIDADES=[],AUDITORIAS=[],PERGUNTAS=[],AUDITORES=[],PERFIS=[];
let RESPOSTAS={},CHARTS={},filtSecao='';
const CORES=['#1B6B2E','#16A34A','#D97706','#1D4ED8','#DC2626','#7C3AED','#0891B2','#DB2777'];
const SECOES=['Identificacao da APR','Identificacao de Riscos','Medidas de Controle','Qualidade da APR','Evidencias','Desvios'];
const PAGE_TITLES={dashboard:'Dashboard',registros:'Registros',perguntas:'Perguntas',usuarios:'Usuarios',configuracoes:'Configuracoes',perfis:'Perfis de Acesso'};
// Paginas controladas pelo sistema dinamico de perfis de acesso.
// "perfis" (gestao de perfis) fica de fora de propósito: e sempre admin-only,
// para nunca correr o risco de ninguem conseguir editar permissoes.
const PAGINAS_PERMISSAO=['dashboard','registros','perguntas','usuarios','configuracoes'];

// Le o campo "inversa" de forma robusta: aceita true (boolean) ou 'true' (string),
// qualquer outra coisa (false, undefined, null, '', 'false') conta como nao-inversa.
// Isso evita que uma pergunta marcada como inversa deixe de funcionar por causa
// do tipo de dado gravado no Firestore.
function ehInversa(p){return p&&(p.inversa===true||p.inversa==='true');}

// Le o campo "contaComoNC" de forma robusta: por padrao (undefined/null,
// dado antigo gravado antes desta funcionalidade existir) a pergunta CONTA
// como Nao Conformidade, preservando o comportamento de sempre. So deixa de
// contar quando o campo foi explicitamente marcado como false/'false' —
// usado em perguntas informativas (ex: "Foi feito registro fotografico?"),
// que nao devem, sozinhas, marcar a auditoria inteira como NC.
function contaComoNC(p){return !(p&&(p.contaComoNC===false||p.contaComoNC==='false'));}

// Trava o envio da auditoria ate que todos os campos obrigatorios (*) e todas
// as perguntas estejam preenchidos. Comentarios Finais continuam opcionais.
function formularioValido(){
  const auditor=document.getElementById('fAuditor')?.value;
  const unidadeId=document.getElementById('fUnid')?.value;
  const parceiro=document.getElementById('fParc')?.value;
  const data=document.getElementById('fData')?.value;
  const apr=document.getElementById('fAPR')?.value.trim();
  const local=document.getElementById('fLocal')?.value.trim();
  if(!auditor||!unidadeId||!parceiro||!data||!apr||!local)return false;
  if(!PERGUNTAS.length)return false;
  for(const p of PERGUNTAS){if(RESPOSTAS[p.id]===undefined)return false;}
  return true;
}

function atualizarEstadoEnvio(){
  const btn=document.getElementById('btnEnviar');
  if(!btn)return;
  btn.disabled=!formularioValido();
}

// === FIREBASE (config fixa — todo usuario usa o mesmo projeto,
// sem precisar configurar nada no primeiro acesso) ===
// IMPORTANTE: como a leitura de "auditores", "unidades" e "unidades/{id}/parceiros"
// precisa funcionar no formulario PUBLICO (sem login), as regras de seguranca do
// Firestore devem permitir "read" publico nessas colecoes e exigir autenticacao
// apenas para "write" (e para toda operacao em "auditorias" e "usuarios").
const FIREBASE_CONFIG={
  apiKey:"AIzaSyC5Kz7Hns8sHhUNKZUODAsPc_JjXI1eyBE",
  authDomain:"auditoria-apr-1.firebaseapp.com",
  projectId:"auditoria-apr-1",
  storageBucket:"auditoria-apr-1.firebasestorage.app",
  messagingSenderId:"70897842287",
  appId:"1:70897842287:web:d47ef7b13d9fa91e8ab59a"
};

// === INIT ===
window.onload=()=>{
  document.getElementById('fData').value=new Date().toISOString().split('T')[0];
  // Event delegation for dynamically generated buttons
  document.addEventListener('click',function(e){
    const pb=e.target.closest('.print-btn');
    if(pb)openPrint(pb.getAttribute('data-id'));
    const pe=e.target.closest('.perg-edit');
    if(pe)openModalPerg(pe.getAttribute('data-id'));
    const pd=e.target.closest('.perg-del');
    if(pd)delPergunta(pd.getAttribute('data-id'));
    const rd=e.target.closest('.reg-del');
    if(rd)delAuditoria(rd.getAttribute('data-id'));
  });
  document.getElementById('s-form').addEventListener('input',atualizarEstadoEnvio);
  document.getElementById('s-form').addEventListener('change',atualizarEstadoEnvio);
  initFB(FIREBASE_CONFIG);
};

function initFB(cfg){
  try{
    if(!firebase.apps.length)firebase.initializeApp(cfg);
    db=firebase.firestore();
    auth=firebase.auth();
    functionsFB=firebase.functions();
    // App Firebase SECUNDARIO, usado apenas para criar novos usuarios.
    // Motivo: firebase.auth().createUserWithEmailAndPassword() na instancia
    // PRINCIPAL loga automaticamente como o usuario recem-criado, derrubando
    // a sessao do admin que estava logado. Criando o usuario nesta instancia
    // separada, a sessao do admin (auth principal) nunca e afetada.
    const appSecundario=firebase.apps.find(a=>a.name==='Secundario')||firebase.initializeApp(cfg,'Secundario');
    authSecundario=appSecundario.auth();
    // Carrega auditores, unidades e perguntas imediatamente, sem depender
    // de login, para que o formulario publico funcione para qualquer visitante.
    subscribeAuditores();
    loadUnidadesForm();
    loadPerguntas();
    auth.onAuthStateChanged(async u=>{if(u)await onLogin(u);});
    irForm();
  }catch(e){
    toast('Erro ao conectar ao Firebase: '+e.message,'err');
    console.error(e);
  }
}

function irForm(){
  showS('s-form');
  const btn=document.getElementById('btnPainel');
  if(CU){btn.textContent='Ir ao Painel';btn.onclick=()=>showS('s-app');}
  else{btn.textContent='Acessar Painel';btn.onclick=acessarPainel;}
}

function acessarPainel(){if(CU)showS('s-app');else showS('s-login');}

// === AUDITORES REALTIME ===
function subscribeAuditores(){
  if(!db)return;
  if(unsubAuditores)unsubAuditores();
  unsubAuditores=db.collection('auditores').orderBy('nome').onSnapshot(snap=>{
    AUDITORES=snap.docs.map(d=>({id:d.id,...d.data()}));
    updateAuditorSel();
    renderAuditoresConfig();
    ['dAudit','rAudit'].forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      const v=el.value;el.innerHTML='<option value="">Todos</option>';
      AUDITORES.forEach(a=>{const o=document.createElement('option');o.value=a.nome;o.textContent=a.nome;el.appendChild(o);});
      el.value=v;
    });
  },err=>{
    console.error('Erro ao carregar auditores:',err);
    toast('Nao foi possivel carregar os auditores. Verifique as regras do Firestore.','err');
  });
}

function updateAuditorSel(){
  const sel=document.getElementById('fAuditor');if(!sel)return;
  const v=sel.value;sel.innerHTML='<option value="">Selecione o auditor...</option>';
  AUDITORES.forEach(a=>{const o=document.createElement('option');o.value=a.nome;o.textContent=a.nome;sel.appendChild(o);});
  if(v)sel.value=v;
}

function renderAuditoresConfig(){
  const el=document.getElementById('listaAuditores');if(!el)return;
  el.innerHTML='';
  if(!AUDITORES.length){
    el.innerHTML='<div style="font-size:13px;color:var(--s500);padding:8px">Nenhum auditor cadastrado.</div>';
    return;
  }
  AUDITORES.forEach(function(a){
    const row=document.createElement('div');row.className='item-row';
    const lbl=document.createElement('div');lbl.className='item-lbl';lbl.textContent=a.nome;
    const btn=document.createElement('button');btn.className='btn-icon del';btn.innerHTML='&#128465;';
    btn.title='Remover';
    btn.addEventListener('click',function(){delAuditor(a.id);});
    row.appendChild(lbl);row.appendChild(btn);el.appendChild(row);
  });
}

async function addAuditor(){
  const nome=document.getElementById('nAuditor').value.trim();
  if(!nome){toast('Digite o nome','err');return;}
  if(AUDITORES.some(a=>a.nome.toLowerCase()===nome.toLowerCase())){toast('Ja cadastrado','err');return;}
  try{
    await db.collection('auditores').add({nome,criadoEm:new Date()});
    document.getElementById('nAuditor').value='';
    toast('Auditor adicionado! Ja aparece no formulario.','ok');
  }catch(e){toast('Erro ao adicionar: '+e.message,'err');}
}

// Define uma nova senha para um usuario JA CADASTRADO que esqueceu a
// senha. Isso exige uma Cloud Function com Admin SDK (ver functions/index.js
// no projeto) — o SDK do navegador nao tem permissao para trocar a senha
// de outra conta. Se a function ainda nao estiver publicada, mostramos um
// erro explicando isso, sem quebrar o restante do painel.
async function redefinirSenhaUsuario(uid,nomeOuEmail){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let sugestao='';for(let i=0;i<10;i++)sugestao+=chars[Math.floor(Math.random()*chars.length)];
  const novaSenha=prompt('Nova senha temporaria para "'+nomeOuEmail+'" (minimo 6 caracteres).\nSugestao pronta abaixo, pode editar:',sugestao);
  if(novaSenha===null)return; // cancelou
  if(novaSenha.length<6){toast('A senha deve ter no minimo 6 caracteres','err');return;}
  try{
    const fn=functionsFB.httpsCallable('adminSetUserPassword');
    await fn({uid,novaSenha});
    toast('Senha redefinida! Informe a nova senha a '+nomeOuEmail+'.','ok');
    await renderUsers();
  }catch(e){
    if(e.code==='functions/not-found'||e.code==='not-found'||/not.?found/i.test(e.message||'')){
      toast('Recurso de redefinicao ainda nao publicado (Cloud Function). Veja o CORRECOES-LEIAME.md para publicar.','err');
    }else{
      toast('Erro: '+e.message,'err');
    }
  }
}

async function delAuditor(id){
  if(!confirm('Remover este auditor da lista?'))return;
  try{
    await db.collection('auditores').doc(id).delete();
    toast('Removido','ok');
  }catch(e){toast('Erro ao remover: '+e.message,'err');}
}

// === PERFIS DE ACESSO (RBAC) ===
// Cada perfil e um documento em "perfis": {chave, nome, permissoes:{dashboard,
// registros, perguntas, usuarios, configuracoes}, protegido}. O campo
// usuario.perfil grava a "chave" do perfil. O perfil de chave 'admin' SEMPRE
// tem acesso total, mesmo que o documento no Firestore diga outra coisa —
// isso e travado no codigo (nao so nos dados) para nunca deixar ninguem
// bloqueado da area que gerencia os proprios perfis.
async function loadPerfis(){
  try{
    const snap=await db.collection('perfis').get();
    PERFIS=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!PERFIS.length){
      try{await seedPerfis();}catch(e){console.warn('Nao foi possivel semear os perfis padrao:',e);}
    }
  }catch(e){
    // Se a colecao "perfis" ainda nao tiver regra de seguranca liberada no
    // Firestore, este erro NAO deve travar o login inteiro. O sistema cai
    // para o acesso minimo (ver permissoesDoPerfil) ate a regra ser corrigida.
    console.warn('Nao foi possivel carregar perfis de acesso (verifique as regras do Firestore para a colecao "perfis"):',e);
    PERFIS=[];
  }
}

async function seedPerfis(){
  const defaults=[
    {chave:'admin',nome:'Admin',protegido:true,permissoes:{dashboard:true,registros:true,perguntas:true,usuarios:true,configuracoes:true}},
    {chave:'gestor',nome:'Gestor',protegido:true,permissoes:{dashboard:true,registros:true,perguntas:true,usuarios:true,configuracoes:false}},
  ];
  const batch=db.batch();
  defaults.forEach(p=>{const ref=db.collection('perfis').doc();batch.set(ref,{...p,criadoEm:new Date()});});
  await batch.commit();
  const snap=await db.collection('perfis').get();
  PERFIS=snap.docs.map(d=>({id:d.id,...d.data()}));
}

// Retorna o objeto de permissoes efetivo para uma chave de perfil.
// 'admin' e sempre full-access, como trava de seguranca do proprio codigo.
function permissoesDoPerfil(chave){
  if(chave==='admin')return{dashboard:true,registros:true,perguntas:true,usuarios:true,configuracoes:true};
  const p=PERFIS.find(x=>x.chave===chave);
  if(p)return{...p.permissoes};
  // Perfil desconhecido/removido: acesso minimo (apenas dashboard e registros)
  // para nao travar o usuario totalmente fora do sistema.
  return{dashboard:true,registros:true,perguntas:false,usuarios:false,configuracoes:false};
}

function temPermissao(pagina){
  if(!CU)return false;
  if(CU.perfil==='admin')return true;
  return !!(CU.permissoes&&CU.permissoes[pagina]);
}

function renderPerfisList(){
  const el=document.getElementById('listaPerfis');if(!el)return;
  el.innerHTML='';
  if(!PERFIS.length){el.innerHTML='<div style="font-size:13px;color:var(--s500);padding:8px">Nenhum perfil cadastrado.</div>';return;}
  PERFIS.forEach(function(p){
    const row=document.createElement('div');row.className='item-row';row.style.flexWrap='wrap';
    const info=document.createElement('div');info.style.flex='1';info.style.minWidth='200px';
    const nm=document.createElement('div');nm.className='item-lbl';nm.textContent=p.nome+(p.chave==='admin'?' (acesso total, fixo)':'');
    const perms=PAGINAS_PERMISSAO.filter(pg=>permissoesDoPerfil(p.chave)[pg]).map(pg=>PAGE_TITLES[pg]).join(', ')||'Nenhuma pagina liberada';
    const sub=document.createElement('div');sub.className='item-sub';sub.textContent=perms;
    info.appendChild(nm);info.appendChild(sub);
    const btnE=document.createElement('button');btnE.className='btn-icon';btnE.innerHTML='&#9999;';btnE.title='Editar';
    btnE.addEventListener('click',function(){openModalPerfil(p.chave);});
    row.appendChild(info);row.appendChild(btnE);
    if(!p.protegido){
      const btnD=document.createElement('button');btnD.className='btn-icon del';btnD.innerHTML='&#128465;';btnD.title='Excluir';
      btnD.addEventListener('click',function(){delPerfil(p.chave,p.id);});
      row.appendChild(btnD);
    }
    el.appendChild(row);
  });
}

function openModalPerfil(chave){
  const p=chave?PERFIS.find(x=>x.chave===chave):null;
  document.getElementById('mfTitle').textContent=p?'Editar Perfil':'Novo Perfil';
  document.getElementById('mfChave').value=chave||'';
  document.getElementById('mfNome').value=p?p.nome:'';
  const perms=p?p.permissoes:{dashboard:true,registros:true,perguntas:false,usuarios:false,configuracoes:false};
  document.getElementById('mfDashboard').checked=!!perms.dashboard;
  document.getElementById('mfRegistros').checked=!!perms.registros;
  document.getElementById('mfPerguntas').checked=!!perms.perguntas;
  document.getElementById('mfUsuarios').checked=!!perms.usuarios;
  document.getElementById('mfConfiguracoes').checked=!!perms.configuracoes;
  // Perfil 'admin' sempre tem acesso total e nao pode ter isso alterado.
  const travado=chave==='admin';
  ['mfDashboard','mfRegistros','mfPerguntas','mfUsuarios','mfConfiguracoes'].forEach(id=>{
    document.getElementById(id).disabled=travado;
    if(travado)document.getElementById(id).checked=true;
  });
  openModal('modalPerfil');
}

async function salvarPerfil(){
  const chave=document.getElementById('mfChave').value;
  const nome=document.getElementById('mfNome').value.trim();
  if(!nome){toast('Digite o nome do perfil','err');return;}
  const permissoes={
    dashboard:document.getElementById('mfDashboard').checked,
    registros:document.getElementById('mfRegistros').checked,
    perguntas:document.getElementById('mfPerguntas').checked,
    usuarios:document.getElementById('mfUsuarios').checked,
    configuracoes:document.getElementById('mfConfiguracoes').checked,
  };
  try{
    if(chave){
      const p=PERFIS.find(x=>x.chave===chave);
      if(p)await db.collection('perfis').doc(p.id).update({nome,permissoes});
    }else{
      const novaChave=slugify(nome);
      if(!novaChave){toast('Nome invalido','err');return;}
      if(PERFIS.some(x=>x.chave===novaChave)){toast('Ja existe um perfil com esse nome','err');return;}
      await db.collection('perfis').add({chave:novaChave,nome,permissoes,protegido:false,criadoEm:new Date()});
    }
    closeModal('modalPerfil');toast('Perfil salvo!','ok');
    await loadPerfis();renderPerfisList();populatePerfilSelects();
    if(CU)CU.permissoes=permissoesDoPerfil(CU.perfil);
  }catch(e){toast('Erro: '+e.message,'err');}
}

async function delPerfil(chave,id){
  const emUso=await db.collection('usuarios').where('perfil','==',chave).limit(1).get();
  if(!emUso.empty){toast('Existem usuarios com este perfil. Troque o perfil deles antes de excluir.','err');return;}
  if(!confirm('Excluir este perfil de acesso?'))return;
  await db.collection('perfis').doc(id).delete();
  toast('Perfil excluido','ok');
  await loadPerfis();renderPerfisList();populatePerfilSelects();
}

function slugify(s){
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

// Preenche os selects de "Perfil" (criar/editar usuario) com os perfis
// cadastrados dinamicamente no Firestore.
function populatePerfilSelects(){
  ['uPerfil','muPerfil'].forEach(id=>{
    const sel=document.getElementById(id);if(!sel)return;
    const v=sel.value;
    sel.innerHTML='';
    PERFIS.forEach(p=>{
      const o=document.createElement('option');o.value=p.chave;
      o.textContent=p.nome+(p.chave==='admin'?' - acesso total':'');
      sel.appendChild(o);
    });
    if(v&&PERFIS.some(p=>p.chave===v))sel.value=v;
  });
}

// === AUTH ===
async function fazerLogin(){
  const email=document.getElementById('lEmail').value.trim();
  const senha=document.getElementById('lSenha').value;
  const errEl=document.getElementById('loginErr');
  errEl.style.display='none';
  try{await auth.signInWithEmailAndPassword(email,senha);}
  catch(e){errEl.textContent='E-mail ou senha incorretos.';errEl.style.display='block';}
}

async function onLogin(u){
  const doc=await db.collection('usuarios').doc(u.uid).get();
  CU=doc.exists?{uid:u.uid,...doc.data()}:{uid:u.uid,email:u.email,nome:u.displayName||u.email,perfil:'gestor',ativo:true};
  if(CU.ativo===false){
    toast('Sua conta foi desativada. Fale com um administrador.','err');
    await auth.signOut();
    CU=null;
    irForm();
    return;
  }
  await loadPerfis();
  CU.permissoes=permissoesDoPerfil(CU.perfil);
  document.getElementById('uAv').textContent=(CU.nome||'?')[0].toUpperCase();
  document.getElementById('uNm').textContent=CU.nome||CU.email;
  const rb=document.getElementById('roleBadge');
  const perfilInfo=PERFIS.find(p=>p.chave===CU.perfil);
  rb.textContent=perfilInfo?perfilInfo.nome:(CU.perfil==='admin'?'Admin':'Gestor');
  rb.className='badge '+(CU.perfil==='admin'?'b-admin':'b-gestor');
  aplicarVisibilidadeMenu();
  showS('s-app');
  document.getElementById('btnPainel').textContent='Ir ao Painel';
  document.getElementById('btnPainel').onclick=()=>showS('s-app');
  await loadPerguntas();
  await loadUnidadesForm();
  await loadAuditorias();
  // Se o perfil deste usuario nao tem acesso ao Dashboard (pagina padrao ao
  // abrir o painel), navega automaticamente para a primeira pagina permitida.
  if(!temPermissao('dashboard')){
    const primeiroBtn=[...document.querySelectorAll('.nb[data-page]')].find(b=>b.style.display!=='none');
    if(primeiroBtn)goP(primeiroBtn);
  }
  // Senha temporaria: obriga a troca antes de liberar qualquer outra acao.
  if(CU.exigeTrocaSenha===true)abrirTrocarSenha(true);
}

// Mostra/esconde os itens do menu lateral conforme as permissoes do
// perfil do usuario logado. "Perfis de Acesso" so aparece para o perfil
// 'admin', sempre, independente do que estiver no Firestore (evita que
// alguem se tranque fora da gestao de permissoes).
function aplicarVisibilidadeMenu(){
  document.querySelectorAll('[data-page]').forEach(el=>{
    const pagina=el.getAttribute('data-page');
    const show=pagina==='perfis'?CU.perfil==='admin':!!CU.permissoes[pagina];
    el.style.display=show?'flex':'none';
  });
  const secGestao=document.querySelector('.sb-sec[data-role="gestor"]');
  if(secGestao)secGestao.style.display=(CU.permissoes.perguntas||CU.permissoes.usuarios)?'block':'none';
  const secAdmin=document.querySelector('.sb-sec[data-role="admin"]');
  if(secAdmin)secAdmin.style.display=(CU.permissoes.configuracoes||CU.perfil==='admin')?'block':'none';
}

async function fazerLogout(){await auth.signOut();CU=null;irForm();}

// Gera uma senha temporaria aleatoria e ja preenche o campo, para o admin
// so copiar e repassar ao usuario.
function gerarSenhaTemp(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s='';
  for(let i=0;i<10;i++)s+=chars[Math.floor(Math.random()*chars.length)];
  document.getElementById('uSenha').value=s;
}

async function criarUsuario(){
  const nome=document.getElementById('uNome').value.trim();
  const email=document.getElementById('uEmail').value.trim();
  const senha=document.getElementById('uSenha').value;
  const perfil=document.getElementById('uPerfil').value;
  if(!nome||!email||!senha){toast('Preencha todos os campos','err');return;}
  if(senha.length<6){toast('A senha deve ter no minimo 6 caracteres','err');return;}
  try{
    // IMPORTANTE: cria o usuario na instancia SECUNDARIA do Firebase Auth
    // (authSecundario), nao na instancia principal (auth). Isso evita o bug
    // onde criar um usuario novo derrubava a sessao do admin e logava
    // automaticamente como o usuario recem-criado.
    const cred=await authSecundario.createUserWithEmailAndPassword(email,senha);
    try{
      await cred.user.updateProfile({displayName:nome});
      await db.collection('usuarios').doc(cred.user.uid).set({
        nome,email,perfil,ativo:true,
        exigeTrocaSenha:true, // usuario sera obrigado a trocar no primeiro acesso
        criadoEm:new Date()
      });
    }finally{
      await authSecundario.signOut(); // sempre encerra a sessao secundaria; o admin continua logado normalmente
    }
    document.getElementById('uNome').value='';
    document.getElementById('uEmail').value='';
    document.getElementById('uSenha').value='';
    toast('Usuario criado! Informe a senha temporaria a ele.','ok');
    await renderUsers();
  }catch(e){toast('Erro: '+e.message,'err');}
}

async function renderUsers(){
  populatePerfilSelects();
  const snap=await db.collection('usuarios').get();
  const users=snap.docs.map(d=>({id:d.id,...d.data()}));
  const el=document.getElementById('listaUsers');
  el.innerHTML='';
  if(!users.length){el.innerHTML='<div style="font-size:13px;color:var(--s500);padding:8px">Nenhum usuario.</div>';return;}
  users.forEach(function(u){
    const row=document.createElement('div');row.className='item-row';
    const av=document.createElement('div');av.className='u-av';av.style.flexShrink='0';av.textContent=(u.nome||'?')[0].toUpperCase();
    const info=document.createElement('div');info.style.flex='1';
    const nm=document.createElement('div');nm.className='item-lbl';nm.textContent=u.nome||'--';
    const em=document.createElement('div');em.className='item-sub';em.textContent=u.email+(u.exigeTrocaSenha?' • aguardando troca de senha':'');
    info.appendChild(nm);info.appendChild(em);
    const inativo=u.ativo===false;
    if(inativo)row.style.opacity='0.5';
    const perfilInfo=PERFIS.find(p=>p.chave===u.perfil);
    const nomePerfil=perfilInfo?perfilInfo.nome:u.perfil;
    const badge=document.createElement('span');badge.className='badge '+(u.perfil==='admin'?'b-admin':'b-gestor');badge.textContent=nomePerfil+(inativo?' (inativo)':'');
    const btnAt=document.createElement('button');btnAt.className='btn-icon';btnAt.title=inativo?'Ativar':'Inativar';
    btnAt.innerHTML=inativo?'&#128274;':'&#128275;';
    btnAt.addEventListener('click',function(){toggleAtivoUser(u.id,u.ativo!==false);});
    const btnRS=document.createElement('button');btnRS.className='btn-icon';btnRS.innerHTML='&#128273;';btnRS.title='Definir nova senha (usuario esqueceu a senha)';
    btnRS.addEventListener('click',function(){redefinirSenhaUsuario(u.id,u.nome||u.email);});
    if(CU.perfil!=='admin')btnRS.style.display='none';
    const btn=document.createElement('button');btn.className='btn-icon';btn.innerHTML='&#9999;';
    btn.addEventListener('click',function(){openEditUser(u.id,u.nome||'',u.perfil,u.exigeTrocaSenha===true);});
    const btnDel=document.createElement('button');btnDel.className='btn-icon del';btnDel.innerHTML='&#128465;';btnDel.title='Excluir cadastro';
    btnDel.addEventListener('click',function(){delUsuario(u.id,u.nome||u.email);});
    row.appendChild(av);row.appendChild(info);row.appendChild(badge);row.appendChild(btnAt);row.appendChild(btnRS);row.appendChild(btn);row.appendChild(btnDel);
    el.appendChild(row);
  });
}

function openEditUser(id,nome,perfil,exigeTrocaSenha){
  document.getElementById('muId').value=id;
  document.getElementById('muNome').value=nome;
  populatePerfilSelects();
  document.getElementById('muPerfil').value=perfil;
  document.getElementById('muSenhaTemp').checked=!!exigeTrocaSenha;
  openModal('modalUser');
}

async function toggleAtivoUser(id,ativoAtual){
  if(id===CU?.uid){toast('Voce nao pode inativar sua propria conta','err');return;}
  try{
    await db.collection('usuarios').doc(id).update({ativo:!ativoAtual});
    toast(ativoAtual?'Usuario inativado':'Usuario ativado','ok');
    await renderUsers();
  }catch(e){toast('Erro: '+e.message,'err');}
}

async function salvarUser(){
  const id=document.getElementById('muId').value;
  const nome=document.getElementById('muNome').value.trim();
  const perfil=document.getElementById('muPerfil').value;
  const exigeTrocaSenha=document.getElementById('muSenhaTemp').checked;
  await db.collection('usuarios').doc(id).update({nome,perfil,exigeTrocaSenha});
  closeModal('modalUser');toast('Atualizado!','ok');
  await renderUsers();
}

// Exclui o CADASTRO do usuario no painel (colecao "usuarios" no Firestore).
// Isso resolve o problema de cadastros "fantasma": se a conta tambem foi
// removida direto no Firebase Authentication, use este botao para tirar o
// registro da lista de Usuarios do painel (o Firestore nao se sincroniza
// sozinho com exclusoes feitas manualmente no Firebase Auth). Se a conta
// AINDA existir no Firebase Authentication, exclua-a tambem por la (o SDK
// do navegador nao tem permissao para apagar a conta de outra pessoa por
// motivos de seguranca do proprio Firebase).
async function delUsuario(id,nomeOuEmail){
  if(id===CU?.uid){toast('Voce nao pode excluir sua propria conta','err');return;}
  if(!confirm('Excluir o cadastro de "'+nomeOuEmail+'" do painel? Se a conta ainda existir no Firebase Authentication, remova-a tambem por la.'))return;
  try{
    await db.collection('usuarios').doc(id).delete();
    toast('Usuario removido do painel','ok');
    await renderUsers();
  }catch(e){toast('Erro ao excluir: '+e.message,'err');}
}

// === TROCA DE SENHA (obrigatoria no primeiro acesso com senha temporaria,
// ou voluntaria a qualquer momento pelo botao de chave no menu lateral) ===
let senhaTrocaObrigatoria=false;
function abrirTrocarSenha(obrigatoria){
  senhaTrocaObrigatoria=!!obrigatoria;
  document.getElementById('smNova').value='';
  document.getElementById('smConfirma').value='';
  document.getElementById('smErr').style.display='none';
  document.getElementById('smAvisoObrig').style.display=senhaTrocaObrigatoria?'block':'none';
  document.getElementById('smCancelBtn').style.display=senhaTrocaObrigatoria?'none':'block';
  openModal('modalSenha');
}

async function confirmarTrocaSenha(){
  const nova=document.getElementById('smNova').value;
  const confirma=document.getElementById('smConfirma').value;
  const errEl=document.getElementById('smErr');
  errEl.style.display='none';
  if(nova.length<6){errEl.textContent='A senha deve ter no minimo 6 caracteres.';errEl.style.display='block';return;}
  if(nova!==confirma){errEl.textContent='As senhas nao coincidem.';errEl.style.display='block';return;}
  try{
    await auth.currentUser.updatePassword(nova);
    if(CU)await db.collection('usuarios').doc(CU.uid).update({exigeTrocaSenha:false});
    if(CU)CU.exigeTrocaSenha=false;
    closeModal('modalSenha');
    toast('Senha atualizada com sucesso!','ok');
  }catch(e){
    // updatePassword pode exigir login recente; nesse caso, pede para
    // sair e entrar novamente antes de trocar a senha.
    if(e.code==='auth/requires-recent-login'){
      errEl.textContent='Por seguranca, saia e entre novamente antes de trocar a senha.';
    }else{
      errEl.textContent='Erro: '+e.message;
    }
    errEl.style.display='block';
  }
}

// === UNIDADES & PARCEIROS ===
async function loadUnidadesForm(){
  if(!db)return;
  const snap=await db.collection('unidades').orderBy('nome').get();
  UNIDADES=snap.docs.map(d=>({id:d.id,...d.data()}));
  ['fUnid','dUnid','rUnid','cfgUnidSel'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const first=el.options[0].cloneNode(true);el.innerHTML='';el.appendChild(first);
    UNIDADES.forEach(u=>{const o=document.createElement('option');o.value=u.id;o.textContent=u.nome;el.appendChild(o);});
  });
}

async function loadParceiros(){
  const uid=document.getElementById('fUnid').value;
  const sel=document.getElementById('fParc');
  if(!uid){sel.innerHTML='<option value="">Selecione a unidade primeiro...</option>';return;}
  sel.innerHTML='<option value="">Carregando...</option>';
  const snap=await db.collection('unidades').doc(uid).collection('parceiros').orderBy('nome').get();
  sel.innerHTML='<option value="">Selecione o parceiro...</option>';
  snap.docs.forEach(d=>{const o=document.createElement('option');o.value=d.data().nome;o.textContent=d.data().nome;sel.appendChild(o);});
}

async function renderUnidadesCfg(){
  await loadUnidadesForm();
  const listaUnidEl=document.getElementById('listaUnid');listaUnidEl.innerHTML='';
  if(!UNIDADES.length){listaUnidEl.innerHTML='<div style="font-size:13px;color:var(--s500)">Nenhuma unidade.</div>';}
  else{UNIDADES.forEach(function(u){
    const row=document.createElement('div');row.className='item-row';
    const lbl=document.createElement('div');lbl.className='item-lbl';lbl.textContent=u.nome;
    const btn=document.createElement('button');btn.className='btn-icon del';btn.innerHTML='&#128465;';
    btn.addEventListener('click',function(){delUnidade(u.id);});
    row.appendChild(lbl);row.appendChild(btn);listaUnidEl.appendChild(row);
  });}
  const sel=document.getElementById('cfgUnidSel');
  sel.innerHTML='<option value="">Selecione...</option>';
  UNIDADES.forEach(u=>{const o=document.createElement('option');o.value=u.id;o.textContent=u.nome;sel.appendChild(o);});
}

async function addUnidade(){
  const nome=document.getElementById('nUnid').value.trim();
  if(!nome){toast('Digite o nome','err');return;}
  if(UNIDADES.some(u=>u.nome.toLowerCase()===nome.toLowerCase())){toast('Ja cadastrada','err');return;}
  await db.collection('unidades').add({nome,criadoEm:new Date()});
  document.getElementById('nUnid').value='';toast('Unidade adicionada!','ok');
  await renderUnidadesCfg();
}

async function delUnidade(id){
  if(!confirm('Excluir unidade e todos os parceiros?'))return;
  const snap=await db.collection('unidades').doc(id).collection('parceiros').get();
  const batch=db.batch();snap.docs.forEach(d=>batch.delete(d.ref));
  batch.delete(db.collection('unidades').doc(id));await batch.commit();
  toast('Excluida','ok');await renderUnidadesCfg();
}

async function renderParcCfg(){
  const uid=document.getElementById('cfgUnidSel').value;
  const lista=document.getElementById('listaParcCfg');
  const row=document.getElementById('addParcRow');
  if(!uid){lista.innerHTML='';row.style.display='none';return;}
  const snap=await db.collection('unidades').doc(uid).collection('parceiros').orderBy('nome').get();
  lista.innerHTML='';
  if(!snap.docs.length){lista.innerHTML='<div style="font-size:13px;color:var(--s500)">Nenhum parceiro.</div>';}
  else{snap.docs.forEach(function(d){
    const pnome=d.data().nome,pid=d.id,puid=uid;
    const prow=document.createElement('div');prow.className='item-row';
    const plbl=document.createElement('div');plbl.className='item-lbl';plbl.textContent=pnome;
    const pbtn=document.createElement('button');pbtn.className='btn-icon del';pbtn.innerHTML='&#128465;';
    pbtn.addEventListener('click',function(){delParceiro(puid,pid);});
    prow.appendChild(plbl);prow.appendChild(pbtn);lista.appendChild(prow);
  });}

  row.style.display='flex';
}

async function addParceiro(){
  const uid=document.getElementById('cfgUnidSel').value;
  const nome=document.getElementById('nParc').value.trim();
  if(!uid||!nome){toast('Selecione a unidade e digite o nome','err');return;}
  try{
    const snap=await db.collection('unidades').doc(uid).collection('parceiros').get();
    const jaExiste=snap.docs.some(d=>(d.data().nome||'').toLowerCase()===nome.toLowerCase());
    if(jaExiste){toast('Este parceiro ja esta cadastrado nesta unidade','err');return;}
    await db.collection('unidades').doc(uid).collection('parceiros').add({nome,criadoEm:new Date()});
    document.getElementById('nParc').value='';toast('Parceiro adicionado!','ok');
    await renderParcCfg();await loadUnidadesForm();
  }catch(e){toast('Erro: '+e.message,'err');}
}

async function delParceiro(uid,pid){
  if(!confirm('Excluir este parceiro?'))return;
  await db.collection('unidades').doc(uid).collection('parceiros').doc(pid).delete();
  toast('Excluido','ok');await renderParcCfg();
}

// === PERGUNTAS ===
async function loadPerguntas(){
  try{
    // Evitamos orderBy em dois campos (secao + ordem), que exigiria um
    // indice composto no Firestore. Buscamos tudo e ordenamos no cliente.
    const snap=await db.collection('perguntas').get();
    PERGUNTAS=snap.docs.map(d=>({id:d.id,...d.data()}));
    ordenarPerguntas();
    // Semear as perguntas padrao exige permissao de escrita (gestor/admin).
    // So tenta se ja houver um usuario logado com esse perfil; visitantes
    // anonimos apenas leem o que ja estiver cadastrado.
    if(!PERGUNTAS.length && CU){
      try{await seedPerguntas();}
      catch(e){console.warn('Nao foi possivel semear as perguntas padrao:',e);}
    }
    renderFormPerguntas();
  }catch(e){
    console.error('Erro ao carregar perguntas:',e);
    toast('Nao foi possivel carregar as perguntas. Verifique as regras do Firestore.','err');
  }
}

function ordenarPerguntas(){
  PERGUNTAS.sort((a,b)=>{
    const sa=SECOES.indexOf(a.secao),sb=SECOES.indexOf(b.secao);
    if(sa!==sb)return sa-sb;
    return (a.ordem||0)-(b.ordem||0);
  });
}

async function seedPerguntas(){
  const defaults=[
    {secao:'Identificacao da APR',ordem:1,texto:'A APR possui identificação da atividade?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Identificacao da APR',ordem:2,texto:'A data está preenchida na APR?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Identificacao da APR',ordem:3,texto:'A equipe está listada?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Identificacao de Riscos',ordem:1,texto:'Os riscos foram identificados?',tipo:'simnao',peso:3,inversa:false},
    {secao:'Identificacao de Riscos',ordem:2,texto:'Os riscos são compatíveis com a atividade?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Medidas de Controle',ordem:1,texto:'Existem controles para os riscos?',tipo:'simnao',peso:3,inversa:false},
    {secao:'Medidas de Controle',ordem:2,texto:'Os controles são específicos (não genéricos)?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Qualidade da APR',ordem:1,texto:'A APR está clara e legível?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Qualidade da APR',ordem:2,texto:'Foi copiada de outra APR sem adaptação?',tipo:'simnao',peso:1,inversa:true},
    {secao:'Qualidade da APR',ordem:3,texto:'Nota geral da APR (0 a 10)',tipo:'nota',peso:1,inversa:false},
    {secao:'Evidencias',ordem:1,texto:'Registro / evidência fotográfica presente?',tipo:'simnao',peso:1,inversa:false},
    {secao:'Desvios',ordem:1,texto:'Existe não conformidade identificada?',tipo:'simnao',peso:1,inversa:true},
  ];
  const batch=db.batch();
  defaults.forEach(p=>{const ref=db.collection('perguntas').doc();batch.set(ref,{...p,criadoEm:new Date()});});
  await batch.commit();
  const snap=await db.collection('perguntas').get();
  PERGUNTAS=snap.docs.map(d=>({id:d.id,...d.data()}));
  ordenarPerguntas();
}

function renderFormPerguntas(){
  const c=document.getElementById('form-perguntas');
  if(!PERGUNTAS.length){c.innerHTML='<div class="empty"><div class="empty-ico">?</div><div class="empty-txt">Nenhuma pergunta configurada.</div></div>';atualizarEstadoEnvio();return;}
  // Agrupa pelas secoes que realmente existem nos dados, em vez de exigir
  // que o texto bata perfeitamente com a lista fixa SECOES. Isso evita que
  // uma pergunta "suma" do formulario por causa de acento/maiuscula/espaco
  // diferente no campo secao. As secoes conhecidas vem primeiro, na ordem
  // padrao; qualquer secao extra aparece depois.
  const secoesPresentes=[...new Set(PERGUNTAS.map(p=>p.secao))];
  const ordemSecoes=[...SECOES.filter(s=>secoesPresentes.includes(s)),...secoesPresentes.filter(s=>!SECOES.includes(s))];
  const frag=document.createDocumentFragment();
  ordemSecoes.forEach(function(sec,si){
    const ps=PERGUNTAS.filter(function(p){return p.secao===sec;});
    if(!ps.length)return;
    const hdr=document.createElement('div');
    hdr.className='sec-hdr'+(sec==='Desvios'?' red':'');
    hdr.textContent=(si+2)+'. '+sec;
    frag.appendChild(hdr);
    ps.forEach(function(p){
      const block=document.createElement('div');block.className='qblock';
      if(p.tipo==='nota'){
        const lbl=document.createElement('div');lbl.className='q-lbl';
        lbl.innerHTML=p.texto+' <span class="q-peso">P'+p.peso+'</span>';
        block.appendChild(lbl);
        const grid=document.createElement('div');grid.className='nota-grid';
        for(let n=0;n<=10;n++){
          const btn=document.createElement('button');
          btn.className='nb2';btn.id='nb-'+p.id+'-'+n;btn.textContent=n;
          btn.setAttribute('data-qid',p.id);btn.setAttribute('data-n',n);
          btn.onclick=function(){selNota(this.getAttribute('data-qid'),parseInt(this.getAttribute('data-n')));};
          grid.appendChild(btn);
        }
        block.appendChild(grid);
      }else{
        const lbl=document.createElement('div');lbl.className='q-lbl';
        lbl.innerHTML=p.texto+' <span class="q-peso'+(p.peso>=3?' hi':'')+'">P'+p.peso+'</span>';
        block.appendChild(lbl);
        const rg=document.createElement('div');rg.className='rg';
        ['Sim','Nao'].forEach(function(val){
          const lbEl=document.createElement('label');
          lbEl.className='ro';lbEl.id='ro-'+(val==='Sim'?'sim':'nao')+'-'+p.id;
          lbEl.innerHTML='<input type="radio" name="'+p.id+'" value="'+val+'"> '+val;
          lbEl.setAttribute('data-qid',p.id);lbEl.setAttribute('data-val',val);
          lbEl.onclick=function(){selOpt(this.getAttribute('data-qid'),this.getAttribute('data-val'));};
          rg.appendChild(lbEl);
        });
        block.appendChild(rg);
      }
      frag.appendChild(block);
    });
  });
  c.innerHTML='';c.appendChild(frag);
  atualizarEstadoEnvio();
}

function selOpt(qid,val){
  RESPOSTAS[qid]=val;
  const p=PERGUNTAS.find(x=>x.id===qid);
  const ok=p&&ehInversa(p)?val==='Nao':val==='Sim';
  const cls=ok?'sim':'nao';
  document.getElementById('ro-sim-'+qid).className='ro'+(val==='Sim'?' '+cls:'');
  document.getElementById('ro-nao-'+qid).className='ro'+(val==='Nao'?' '+cls:'');
  atualizarEstadoEnvio();
}
function selNota(qid,n){
  RESPOSTAS[qid]=n;
  document.querySelectorAll('[id^="nb-'+qid+'-"]').forEach(b=>b.classList.remove('sel'));
  const btn=document.getElementById('nb-'+qid+'-'+n);if(btn)btn.classList.add('sel');
  atualizarEstadoEnvio();
}

function filtSec(sec,btn){
  filtSecao=sec;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');renderPerguntasConfig();
}

function renderPerguntasConfig(){
  const el=document.getElementById('listaPerg');
  const list=filtSecao?PERGUNTAS.filter(p=>p.secao===filtSecao):PERGUNTAS;
  if(!list.length){el.innerHTML='<div class="empty"><div class="empty-ico">?</div><div class="empty-txt">Nenhuma pergunta.</div></div>';return;}
  let html='',lastSec='';
  list.forEach(p=>{
    if(!filtSecao&&p.secao!==lastSec){html+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--g700);padding:14px 0 6px;border-top:2px solid var(--g100);margin-top:4px">'+p.secao+'</div>';lastSec=p.secao;}
    html+='<div class="pq-row"><div class="pq-body"><div class="pq-txt">'+p.texto+'</div>';
    html+='<div class="pq-meta"><span>'+(p.tipo==='nota'?'Nota':'Sim/Nao')+'</span><span class="pq-peso-tag'+(p.peso>=3?' hi':'')+'">Peso '+p.peso+'</span><span>'+p.secao+'</span>'+(ehInversa(p)?'<span style="color:var(--yel)">Inversa</span>':'')+(p.tipo!=='nota'&&!contaComoNC(p)?'<span style="color:var(--blu)">Nao conta como NC</span>':'')+'</div></div>';
    html+='<button class="btn-icon perg-edit" data-id="'+p.id+'">&#9999;</button>';
    html+='<button class="btn-icon del perg-del" data-id="'+p.id+'">&#128465;</button></div>';
  });
  el.innerHTML=html;
}

function openModalPerg(id){
  document.getElementById('mpTitle').textContent=id?'Editar Pergunta':'Nova Pergunta';
  document.getElementById('mpId').value=id||'';
  if(id){
    const p=PERGUNTAS.find(x=>x.id===id);if(!p)return;
    document.getElementById('mpTxt').value=p.texto||'';
    document.getElementById('mpSec').value=p.secao||'Identificacao da APR';
    document.getElementById('mpTipo').value=p.tipo||'simnao';
    document.getElementById('mpPeso').value=(p.peso!=null?p.peso:1);
    document.getElementById('mpOrdem').value=p.ordem||1;
    document.getElementById('mpInversa').checked=ehInversa(p);
    document.getElementById('mpContaNC').checked=contaComoNC(p);
  }else{
    document.getElementById('mpTxt').value='';
    document.getElementById('mpSec').value='Identificacao da APR';
    document.getElementById('mpTipo').value='simnao';
    document.getElementById('mpPeso').value=1;document.getElementById('mpOrdem').value=1;
    document.getElementById('mpInversa').checked=false;
    document.getElementById('mpContaNC').checked=true;
  }
  atualizarVisibilidadeNCToggle();
  openModal('modalPerg');
}

// A opcao "conta como Nao Conformidade" so faz sentido para perguntas
// Sim/Nao — perguntas do tipo Nota nao tem esse conceito.
function atualizarVisibilidadeNCToggle(){
  const tipo=document.getElementById('mpTipo').value;
  document.getElementById('mpNCWrap').style.display=tipo==='nota'?'none':'block';
}

async function salvarPergunta(){
  const id=document.getElementById('mpId').value;
  const pesoInput=document.getElementById('mpPeso').value;
  let peso=parseInt(pesoInput);
  if(Number.isNaN(peso))peso=1;
  peso=Math.max(0,Math.min(5,peso));
  const data={
    texto:document.getElementById('mpTxt').value.trim(),
    secao:document.getElementById('mpSec').value,
    tipo:document.getElementById('mpTipo').value,
    peso,
    ordem:parseInt(document.getElementById('mpOrdem').value)||1,
    inversa:document.getElementById('mpInversa').checked,
    contaComoNC:document.getElementById('mpContaNC').checked,
  };
  if(!data.texto){toast('Digite o texto','err');return;}
  if(id)await db.collection('perguntas').doc(id).update(data);
  else await db.collection('perguntas').add({...data,criadoEm:new Date()});
  closeModal('modalPerg');toast(id?'Atualizada!':'Criada!','ok');
  await loadPerguntas();renderPerguntasConfig();
}

async function delPergunta(id){
  if(!confirm('Excluir esta pergunta?'))return;
  await db.collection('perguntas').doc(id).delete();
  toast('Excluida','ok');await loadPerguntas();renderPerguntasConfig();
}

// === ENVIO FORMULARIO ===
async function enviarAuditoria(){
  const auditor=document.getElementById('fAuditor').value;
  const unidadeId=document.getElementById('fUnid').value;
  const parceiro=document.getElementById('fParc').value;
  const data=document.getElementById('fData').value;
  const apr=document.getElementById('fAPR').value.trim();
  const local=document.getElementById('fLocal').value.trim();
  const coment=document.getElementById('fComent').value.trim();
  if(!auditor||!unidadeId||!parceiro||!data||!apr||!local){toast('Preencha todos os campos obrigatorios (*)','err');return;}
  for(const p of PERGUNTAS){if(RESPOSTAS[p.id]===undefined){toast('Responda: '+p.texto,'err');return;}}
  const unidadeNome=UNIDADES.find(u=>u.id===unidadeId)?.nome||unidadeId;
  let obtidos=0,maximos=0,isNC=false;
  PERGUNTAS.forEach(p=>{
    if(p.tipo==='nota')return;
    maximos+=p.peso; // pergunta com peso 0 nao influencia a % de conformidade
    const ok=ehInversa(p)?RESPOSTAS[p.id]==='Nao':RESPOSTAS[p.id]==='Sim';
    if(ok)obtidos+=p.peso;
    // perguntas marcadas como "nao conta como NC" (ex: informativas, tipo
    // "foi feito registro fotografico?") nunca marcam a auditoria como NC,
    // mesmo respondidas fora do padrao esperado.
    if(!ok&&contaComoNC(p))isNC=true;
  });
  const conformidade=maximos>0?Math.round((obtidos/maximos)*100):0;
  const notaP=PERGUNTAS.find(p=>p.tipo==='nota');
  const doc={auditor,unidadeId,unidadeNome,parceiro,data,apr,local,coment,
    respostas:{...RESPOSTAS},conformidade,naoConformidade:isNC,
    nota:notaP?(RESPOSTAS[notaP.id]??null):null,
    enviadoEm:firebase.firestore.FieldValue.serverTimestamp()};
  try{
    const btn=document.getElementById('btnEnviar');
    btn.disabled=true;btn.textContent='Enviando...';
    await db.collection('auditorias').add(doc);
    toast('Auditoria enviada com sucesso!','ok');
    resetForm();if(CU)await loadAuditorias();
    btn.disabled=false;btn.textContent='Enviar Auditoria';
  }catch(e){toast('Erro: '+e.message,'err');document.getElementById('btnEnviar').disabled=false;document.getElementById('btnEnviar').textContent='Enviar Auditoria';}
}

function resetForm(){
  ['fAuditor','fUnid'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fParc').innerHTML='<option value="">Selecione a unidade primeiro...</option>';
  ['fAPR','fLocal','fComent'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fData').value=new Date().toISOString().split('T')[0];
  RESPOSTAS={};
  document.querySelectorAll('.ro').forEach(el=>el.className='ro');
  document.querySelectorAll('.nb2').forEach(b=>b.classList.remove('sel'));
  window.scrollTo({top:0,behavior:'smooth'});
  atualizarEstadoEnvio();
}

// === AUDITORIAS ===
async function loadAuditorias(){
  try{
    const snap=await db.collection('auditorias').orderBy('enviadoEm','desc').limit(500).get();
    AUDITORIAS=snap.docs.map(d=>recalcAuditoria({id:d.id,...d.data()}));
    atualizarFiltroEmpresas();
    renderDash();renderReg();
  }catch(e){console.warn(e);}
}

// Recalcula conformidade, nao-conformidade e nota a partir das respostas brutas
// e das perguntas ATUAIS, em vez de confiar cegamente no valor gravado no
// documento. Isso corrige exibicoes desatualizadas quando uma pergunta muda
// (ex: marcar/desmarcar "Resposta inversa") sem precisar editar dados antigos.
function recalcAuditoria(a){
  const respostas=a.respostas||{};
  let obtidos=0,maximos=0,isNC=false,nota=null,temPerguntaRespondida=false;
  PERGUNTAS.forEach(p=>{
    const resp=respostas[p.id];
    if(p.tipo==='nota'){if(resp!=null)nota=resp;return;}
    if(resp===undefined)return; // pergunta nao existia quando a auditoria foi enviada
    temPerguntaRespondida=true;
    maximos+=p.peso;
    const ok=ehInversa(p)?resp==='Nao':resp==='Sim';
    if(ok)obtidos+=p.peso;
    if(!ok&&contaComoNC(p))isNC=true;
  });
  if(temPerguntaRespondida){
    a.conformidade=maximos>0?Math.round((obtidos/maximos)*100):0;
    a.naoConformidade=isNC;
  }
  if(nota!=null)a.nota=nota;
  return a;
}

// Preenche os filtros "Empresa" do Dashboard e de Registros com as empresas
// que realmente aparecem nas auditorias carregadas (antes ficavam sem opcoes).
function atualizarFiltroEmpresas(){
  const nomes=[...new Set(AUDITORIAS.map(a=>a.parceiro).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  ['dParc','rParc'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const v=el.value;el.innerHTML='<option value="">Todas</option>';
    nomes.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;el.appendChild(o);});
    if(nomes.includes(v))el.value=v;
  });
}

function getFilt(unid,parc,audit,per,nc){
  const cutoff=per?new Date(Date.now()-parseInt(per)*864e5):null;
  return AUDITORIAS.filter(a=>{
    if(unid&&a.unidadeId!==unid)return false;
    if(parc&&a.parceiro!==parc)return false;
    if(audit&&a.auditor!==audit)return false;
    if(nc==='nc'&&!a.naoConformidade)return false;
    if(nc==='ok'&&a.naoConformidade)return false;
    if(cutoff&&a.data&&new Date(a.data)<cutoff)return false;
    return true;
  });
}

// === DASHBOARD ===
function corConf(v){return v>=90?'#16A34A':v>=75?'#D97706':'#DC2626';}
function kc(id){if(CHARTS[id]){CHARTS[id].destroy();delete CHARTS[id];}}

function renderDash(){
  const dados=getFilt(
    document.getElementById('dUnid')?.value||'',
    document.getElementById('dParc')?.value||'',
    document.getElementById('dAudit')?.value||'',
    document.getElementById('dPer')?.value||'','');
  const pm={};
  dados.forEach(a=>{
    if(!pm[a.parceiro])pm[a.parceiro]={total:0,nc:0,conf:[],notas:[]};
    pm[a.parceiro].total++;if(a.naoConformidade)pm[a.parceiro].nc++;
    if(a.conformidade!=null)pm[a.parceiro].conf.push(a.conformidade);
    if(a.nota!=null)pm[a.parceiro].notas.push(+a.nota);
  });
  const emps=Object.keys(pm);
  const cm={};emps.forEach(e=>{const cs=pm[e].conf;cm[e]=cs.length?Math.round(cs.reduce((a,b)=>a+b,0)/cs.length):0;});
  const media=emps.length?Math.round(emps.reduce((s,e)=>s+cm[e],0)/emps.length):0;
  const totalNC=dados.filter(a=>a.naoConformidade).length;
  const melhor=[...emps].sort((a,b)=>cm[b]-cm[a])[0];
  document.getElementById('kConf').textContent=dados.length?media+'%':'--';
  document.getElementById('kAud').textContent=dados.length;
  document.getElementById('kNC').textContent=totalNC;
  document.getElementById('kMel').textContent=melhor||'--';
  document.getElementById('kMelSub').textContent=melhor?cm[melhor]+'% conformidade':'';
  kc('b');
  if(emps.length)CHARTS['b']=new Chart(document.getElementById('cBar'),{
    type:'bar',data:{labels:emps,datasets:[{data:emps.map(e=>cm[e]),backgroundColor:emps.map(e=>corConf(cm[e])+'CC'),borderColor:emps.map(e=>corConf(cm[e])),borderWidth:2,borderRadius:8}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'%'}}},scales:{y:{min:0,max:100,grid:{color:'#F1F5F9'},ticks:{callback:v=>v+'%',font:{family:'Outfit',size:12}}},x:{grid:{display:false},ticks:{font:{family:'Outfit',size:12}}}},animation:{duration:600}}
  });
  kc('nc');
  if(emps.length)CHARTS['nc']=new Chart(document.getElementById('cNC'),{
    type:'doughnut',data:{labels:emps,datasets:[{data:emps.map(e=>pm[e].nc||0),backgroundColor:CORES.slice(0,emps.length),borderWidth:3,borderColor:'#fff'}]},
    options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{family:'Outfit',size:11},padding:10}},tooltip:{callbacks:{label:c=>c.label+': '+c.raw+' NC'}}},animation:{duration:600}}
  });
  kc('l');
  const meses={};
  dados.forEach(a=>{
    if(!a.data)return;
    const d=new Date(a.data);
    const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const lbl=d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
    if(!meses[k])meses[k]={lbl,d:{}};
    if(!meses[k].d[a.parceiro])meses[k].d[a.parceiro]=[];
    if(a.conformidade!=null)meses[k].d[a.parceiro].push(a.conformidade);
  });
  const keys=Object.keys(meses).sort();
  if(keys.length)CHARTS['l']=new Chart(document.getElementById('cLin'),{
    type:'line',data:{labels:keys.map(k=>meses[k].lbl),datasets:emps.map((e,i)=>({
      label:e,borderColor:CORES[i%CORES.length],backgroundColor:CORES[i%CORES.length]+'18',
      pointBackgroundColor:CORES[i%CORES.length],borderWidth:2.5,pointRadius:4,tension:0.3,spanGaps:true,
      data:keys.map(k=>{const cs=meses[k].d[e];return cs&&cs.length?Math.round(cs.reduce((a,b)=>a+b,0)/cs.length):null;})
    }))},
    options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{family:'Outfit',size:11},padding:12}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.raw+'%'}}},
      scales:{y:{min:0,max:100,grid:{color:'#F1F5F9'},ticks:{callback:v=>v+'%',font:{family:'Outfit',size:12}}},x:{grid:{display:false},ticks:{font:{family:'Outfit',size:12}}}},animation:{duration:600}}
  });
  const sorted=[...emps].sort((a,b)=>cm[b]-cm[a]);
  const medals=['1o','2o','3o'];
  document.getElementById('rankList').innerHTML=sorted.map((e,i)=>{
    const c=cm[e],nc=pm[e].nc,cor=corConf(c);
    return'<div class="rank-row"><div class="rank-medal">'+(i<3?medals[i]:(i+1)+'o')+'</div><div class="rank-body"><div class="rank-name">'+e+'<span class="badge '+(nc>0?'b-nc':'b-ok')+'">'+nc+' NC</span></div>'
      +'<div style="display:flex;align-items:center;gap:8px"><div class="rank-bg" style="flex:1"><div class="rank-bar" style="width:'+c+'%;background:'+cor+'"></div></div>'
      +'<span class="rank-pct" style="color:'+cor+'">'+c+'%</span></div></div></div>';
  }).join('')||'<div class="empty"><div class="empty-ico">-</div><div class="empty-txt">Sem dados</div></div>';
  kc('nota');
  if(emps.length)CHARTS['nota']=new Chart(document.getElementById('cNota'),{
    type:'bar',data:{labels:emps,datasets:[{data:emps.map(e=>{const ns=pm[e].notas;return ns.length?+(ns.reduce((a,b)=>a+b,0)/ns.length).toFixed(1):0;}),
      backgroundColor:CORES.slice(0,emps.length).map(c=>c+'BB'),borderColor:CORES.slice(0,emps.length),borderWidth:2,borderRadius:8}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'Nota: '+c.raw+'/10'}}},
      scales:{y:{min:0,max:10,grid:{color:'#F1F5F9'},ticks:{font:{family:'Outfit',size:12}}},x:{grid:{display:false},ticks:{font:{family:'Outfit',size:12}}}},animation:{duration:600}}
  });

  // Perguntas com mais Nao Conformidades: conta, entre as auditorias filtradas,
  // quantas vezes cada pergunta Sim/Nao foi respondida fora do padrao esperado.
  // Perguntas marcadas como "nao conta como NC" ficam de fora deste ranking,
  // pois sao apenas informativas (ex: registro fotografico).
  const ncPorPergunta={};
  dados.forEach(a=>{
    const respostas=a.respostas||{};
    PERGUNTAS.forEach(p=>{
      if(p.tipo==='nota')return;
      if(!contaComoNC(p))return;
      const resp=respostas[p.id];
      if(resp===undefined)return;
      const ok=ehInversa(p)?resp==='Nao':resp==='Sim';
      if(!ok){
        if(!ncPorPergunta[p.id])ncPorPergunta[p.id]={texto:p.texto,secao:p.secao,count:0};
        ncPorPergunta[p.id].count++;
      }
    });
  });
  const rankNCQ=Object.values(ncPorPergunta).sort((a,b)=>b.count-a.count).slice(0,8);
  kc('ncq');
  document.getElementById('cNCQ').style.display=rankNCQ.length?'block':'none';
  document.getElementById('ncqEmpty').style.display=rankNCQ.length?'none':'block';
  if(rankNCQ.length)CHARTS['ncq']=new Chart(document.getElementById('cNCQ'),{
    type:'bar',
    data:{labels:rankNCQ.map(r=>r.texto.length>42?r.texto.slice(0,42)+'…':r.texto),
      datasets:[{data:rankNCQ.map(r=>r.count),backgroundColor:'#DC2626CC',borderColor:'#DC2626',borderWidth:2,borderRadius:6}]},
    options:{indexAxis:'y',maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{
        title:c=>rankNCQ[c[0].dataIndex].texto,
        label:c=>c.raw+' ocorrencia'+(c.raw===1?'':'s')+' — secao: '+rankNCQ[c.dataIndex].secao
      }}},
      scales:{x:{beginAtZero:true,ticks:{precision:0,font:{family:'Outfit',size:12}},grid:{color:'#F1F5F9'}},
        y:{ticks:{font:{family:'Outfit',size:11}},grid:{display:false}}},
      animation:{duration:600}}
  });
}

// === REGISTROS ===
function renderReg(){
  const dados=getFilt(
    document.getElementById('rUnid')?.value||'',
    document.getElementById('rParc')?.value||'',
    document.getElementById('rAudit')?.value||'',
    '',document.getElementById('rNC')?.value||'');
  document.getElementById('cntReg').textContent=dados.length+' registros';
  document.getElementById('tbReg').innerHTML=dados.length?dados.map(a=>{
    const isNC=a.naoConformidade;
    const n=a.nota!=null?+a.nota:null;
    const nc=n!=null?(n>=8?'#16A34A':n>=6?'#D97706':'#DC2626'):'#64748B';
    const conf=a.conformidade!=null?a.conformidade:null;
    const corC=conf!=null?corConf(conf):'#64748B';
    return'<tr><td>'+(a.data||'--')+'</td><td><strong>'+(a.auditor||'--')+'</strong></td><td>'+(a.unidadeNome||'--')+'</td><td>'+(a.parceiro||'--')+'</td>'
      +'<td>'+(a.apr||'--')+'</td><td>'+(a.local||'--')+'</td>'
      +'<td><span style="font-weight:800;color:'+nc+'">'+(n!=null?n+'/10':'--')+'</span></td>'
      +'<td><span style="font-weight:700;color:'+corC+'">'+(conf!=null?conf+'%':'--')+'</span></td>'
      +'<td><span class="badge '+(isNC?'b-nc':'b-ok')+'">'+(isNC?'NC':'OK')+'</span></td>'
      +'<td><button class="btn-icon print-btn" data-id="'+a.id+'" title="Imprimir">&#128438;</button>'
      +(CU&&CU.perfil==='admin'?'<button class="btn-icon del reg-del" data-id="'+a.id+'" title="Excluir registro">&#128465;</button>':'')
      +'</td></tr>';
  }).join(''):'<tr><td colspan="10"><div class="empty"><div class="empty-ico">-</div><div class="empty-txt">Nenhum registro</div></div></td></tr>';
}

async function delAuditoria(id){
  if(!confirm('Excluir permanentemente este registro de auditoria? Esta acao nao pode ser desfeita.'))return;
  try{
    await db.collection('auditorias').doc(id).delete();
    toast('Registro excluido','ok');
    await loadAuditorias();
  }catch(e){toast('Erro ao excluir: '+e.message,'err');}
}

// === IMPRESSAO ===
// === EXPORTACAO EM PDF DO DASHBOARD ===
// Usa html2canvas para "fotografar" a area do dashboard (KPIs + graficos +
// ranking) e jsPDF para montar um PDF, paginando automaticamente se o
// conteudo for mais alto que uma pagina A4.
async function exportarDashboardPDF(){
  const btn=document.getElementById('btnExportPDF');
  const area=document.getElementById('dashCapture');
  if(!area){toast('Nao foi possivel localizar o dashboard','err');return;}
  const textoOriginal=btn.innerHTML;
  btn.disabled=true;btn.innerHTML='Gerando PDF...';
  try{
    const canvas=await html2canvas(area,{scale:2,backgroundColor:'#EEF4EF',useCORS:true});
    const{jsPDF}=window.jspdf;
    const pdf=new jsPDF('p','mm','a4');
    const pageW=pdf.internal.pageSize.getWidth();
    const pageH=pdf.internal.pageSize.getHeight();
    const imgW=pageW-20; // margem de 10mm de cada lado
    const imgH=(canvas.height*imgW)/canvas.width;
    const imgData=canvas.toDataURL('image/png');
    // Titulo/cabecalho na primeira pagina
    pdf.setFontSize(14);
    pdf.setTextColor(27,107,46);
    pdf.text('Dashboard - Auditoria APR',10,12);
    pdf.setFontSize(9);
    pdf.setTextColor(100,116,139);
    pdf.text('Gerado em '+new Date().toLocaleString('pt-BR'),10,18);
    let heightLeft=imgH,position=24;
    pdf.addImage(imgData,'PNG',10,position,imgW,imgH);
    heightLeft-=(pageH-position);
    while(heightLeft>0){
      pdf.addPage();
      position=heightLeft-imgH+10;
      pdf.addImage(imgData,'PNG',10,position,imgW,imgH);
      heightLeft-=pageH;
    }
    pdf.save('dashboard-auditoria-apr-'+new Date().toISOString().split('T')[0]+'.pdf');
    toast('PDF gerado com sucesso!','ok');
  }catch(e){
    toast('Erro ao gerar PDF: '+e.message,'err');
    console.error(e);
  }finally{
    btn.disabled=false;btn.innerHTML=textoOriginal;
  }
}

function openPrint(id){
  const a=AUDITORIAS.find(x=>x.id===id);if(!a)return;
  const conf=a.conformidade??0;const corC=corConf(conf);const isNC=a.naoConformidade;
  let secoes='';
  const secoesPresentesP=[...new Set(PERGUNTAS.map(p=>p.secao))];
  const ordemSecoesP=[...SECOES.filter(s=>secoesPresentesP.includes(s)),...secoesPresentesP.filter(s=>!SECOES.includes(s))];
  ordemSecoesP.forEach(sec=>{
    const ps=PERGUNTAS.filter(p=>p.secao===sec);if(!ps.length)return;
    secoes+='<div class="print-section"><div class="print-section-title">'+sec+'</div>';
    ps.forEach(p=>{
      const resp=a.respostas?.[p.id];
      let txt='--',cls='';
      if(p.tipo==='nota'){txt=resp!=null?'Nota: '+resp+'/10':'--';}
      else if(resp!=null){
        txt=resp;
        const ok=ehInversa(p)?resp==='Nao':resp==='Sim';
        cls=ok?'sim':'nao';
      }
      secoes+='<div class="print-q"><div class="print-q-txt"><strong>P'+p.peso+'</strong> - '+p.texto+'</div><div class="print-q-resp '+cls+'">'+txt+'</div></div>';
    });
    secoes+='</div>';
  });
  document.getElementById('printContent').innerHTML=
    '<div class="print-header"><h1>Auditoria de Qualidade de APR</h1><div class="print-meta">'
    +'<div class="print-meta-item"><strong>Auditor:</strong> '+(a.auditor||'--')+'</div>'
    +'<div class="print-meta-item"><strong>Unidade:</strong> '+(a.unidadeNome||'--')+'</div>'
    +'<div class="print-meta-item"><strong>Empresa:</strong> '+(a.parceiro||'--')+'</div>'
    +'<div class="print-meta-item"><strong>Data:</strong> '+(a.data||'--')+'</div>'
    +'<div class="print-meta-item"><strong>APR Nr:</strong> '+(a.apr||'--')+'</div>'
    +'<div class="print-meta-item"><strong>Local:</strong> '+(a.local||'--')+'</div>'
    +'</div></div>'+secoes
    +(a.coment?'<div class="print-section"><div class="print-section-title">Comentarios Finais</div><p style="font-size:13px;color:#334155;line-height:1.6">'+a.coment+'</p></div>':'')
    +'<div class="print-footer">'
    +'<div class="print-sig"><div class="sig-line"></div><p>Assinatura do Auditor</p><p>'+(a.auditor||'')+'</p></div>'
    +'<div style="text-align:center"><div class="print-conf-badge" style="background:'+corC+'22;color:'+corC+';border:3px solid '+corC+'">'+conf+'%<br><span style="font-size:12px;font-weight:600">Conformidade</span></div>'
    +'<div style="margin-top:8px"><span class="badge '+(isNC?'b-nc':'b-ok')+'" style="font-size:13px;padding:5px 14px">'+(isNC?'Nao Conforme':'Conforme')+'</span></div></div>'
    +'<div class="print-sig"><div class="sig-line"></div><p>Responsavel pela Auditoria</p></div></div>';
  document.getElementById('printView').classList.add('open');
}

// === NAV ===
async function goP(btn){
  hideInfo();
  const id=btn.getAttribute('data-page');
  if(id==='perfis'){
    if(CU.perfil!=='admin'){toast('Apenas o perfil Admin acessa esta pagina','err');return;}
  }else if(!temPermissao(id)){
    toast('Voce nao tem permissao para acessar esta pagina','err');return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  btn.classList.add('active');
  document.getElementById('topbarT').textContent=PAGE_TITLES[id]||id;
  if(id==='configuracoes')await renderUnidadesCfg();
  if(id==='perguntas'){await loadPerguntas();renderPerguntasConfig();}
  if(id==='usuarios'){await renderUsers();renderAuditoresConfig();populatePerfilSelects();}
  if(id==='perfis'){await loadPerfis();renderPerfisList();}
  if(id==='dashboard')renderDash();
  if(id==='registros')renderReg();
}

function showS(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// === INFO POPOVER (botao "?" nos cards/graficos) ===
let infoOpenBtn=null;
function toggleInfo(btn){
  const pop=document.getElementById('infoPop');
  if(infoOpenBtn===btn){hideInfo();return;}
  pop.textContent=btn.getAttribute('data-info')||'';
  pop.style.display='block';
  infoOpenBtn=btn;
  const r=btn.getBoundingClientRect();
  const popW=Math.min(280,window.innerWidth-24);
  pop.style.maxWidth=popW+'px';
  let left=r.left;
  if(left+popW+12>window.innerWidth)left=window.innerWidth-popW-12;
  if(left<12)left=12;
  let top=r.bottom+8;
  const popH=pop.offsetHeight||90;
  if(top+popH+12>window.innerHeight)top=Math.max(12,r.top-popH-8);
  pop.style.left=left+'px';
  pop.style.top=top+'px';
}
function hideInfo(){
  document.getElementById('infoPop').style.display='none';
  infoOpenBtn=null;
}
document.addEventListener('click',function(e){
  if(infoOpenBtn&&!e.target.closest('.info-pop')&&!e.target.closest('.info-btn'))hideInfo();
});
window.addEventListener('resize',hideInfo);
window.addEventListener('scroll',hideInfo,true);

let toastT;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='toast show'+(type==='ok'?' ok':type==='err'?' err':'');
  clearTimeout(toastT);toastT=setTimeout(()=>{el.className='toast';},3500);
}

// === SERVICE WORKER (instalacao/uso offline do app shell) ===
// Registra o service-worker.js para permitir "Adicionar a tela inicial" e
// abertura rapida/offline da interface (o Firebase continua sempre buscando
// dados da rede normalmente - o SW so cacheia HTML/CSS/JS/icones).
function registrarServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./service-worker.js').then(registro=>{
      registro.addEventListener('updatefound',()=>{
        const novoWorker=registro.installing;
        if(!novoWorker)return;
        novoWorker.addEventListener('statechange',()=>{
          if(novoWorker.state==='installed'&&navigator.serviceWorker.controller){
            toast('Nova versao disponivel. Atualize a pagina para aplicar.','');
          }
        });
      });
    }).catch(e=>console.warn('Falha ao registrar service worker:',e));
  });
}
registrarServiceWorker();
