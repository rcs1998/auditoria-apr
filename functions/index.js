const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * adminSetUserPassword
 * -----------------------------------------------------------------------
 * Permite que um usuario com perfil 'admin' defina uma NOVA SENHA para um
 * usuario JA CADASTRADO (ex: ele esqueceu a senha). So e possivel fazer
 * isso via Admin SDK, rodando num backend confiavel (Cloud Function) — o
 * SDK do navegador nunca tem permissao para alterar a senha de outra
 * conta, por design de seguranca do proprio Firebase.
 *
 * Ao definir a nova senha, esta function TAMBEM marca
 * usuarios/{uid}.exigeTrocaSenha = true, para que o usuario seja obrigado
 * a trocar essa senha temporaria assim que fizer login (mesmo fluxo usado
 * na criacao de usuarios novos).
 *
 * Chamada pelo app com: firebase.functions().httpsCallable('adminSetUserPassword')
 */
exports.adminSetUserPassword = functions.https.onCall(async (data, context) => {
  // 1) Precisa estar autenticado
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Voce precisa estar logado.');
  }

  // 2) Precisa ser admin (verificado no Firestore, nunca confiar em dado vindo do cliente)
  const callerSnap = await admin.firestore().collection('usuarios').doc(context.auth.uid).get();
  const callerData = callerSnap.data();
  if (!callerSnap.exists || !callerData || callerData.perfil !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Apenas administradores podem redefinir a senha de outro usuario.');
  }

  // 3) Valida os dados recebidos
  const uid = data && data.uid;
  const novaSenha = data && data.novaSenha;
  if (!uid || typeof uid !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'uid do usuario nao informado.');
  }
  if (!novaSenha || typeof novaSenha !== 'string' || novaSenha.length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'A nova senha deve ter no minimo 6 caracteres.');
  }

  // 4) Confirma que o usuario alvo existe no painel (usuarios/{uid})
  const alvoSnap = await admin.firestore().collection('usuarios').doc(uid).get();
  if (!alvoSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Usuario nao encontrado no painel.');
  }

  // 5) Atualiza a senha no Firebase Authentication (Admin SDK)
  try {
    await admin.auth().updateUser(uid, { password: novaSenha });
  } catch (e) {
    throw new functions.https.HttpsError('internal', 'Erro ao atualizar a senha: ' + e.message);
  }

  // 6) Marca para exigir troca no proximo login, igual ao fluxo de criacao
  await admin.firestore().collection('usuarios').doc(uid).update({ exigeTrocaSenha: true });

  return { ok: true };
});
