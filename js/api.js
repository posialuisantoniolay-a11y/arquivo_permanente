/**
 * Camada de acesso aos dados.
 * - Modo online: conversa com o Google Apps Script ligado à planilha.
 * - Modo demonstração: guarda os dados no próprio navegador (localStorage).
 */
const Api = (() => {
  const url = ((window.APP_CONFIG || {}).API_URL || '').trim();
  const modoDemo = !url;
  const CHAVE_SENHA = 'arquivo-permanente-senha';
  const CHAVE_DEMO = 'arquivo-permanente-demo';

  let senha = localStorage.getItem(CHAVE_SENHA) || sessionStorage.getItem(CHAVE_SENHA) || '';

  function definirSenha(nova, lembrar) {
    senha = nova;
    sessionStorage.setItem(CHAVE_SENHA, nova);
    if (lembrar) localStorage.setItem(CHAVE_SENHA, nova);
  }

  function esquecerSenha() {
    senha = '';
    sessionStorage.removeItem(CHAVE_SENHA);
    localStorage.removeItem(CHAVE_SENHA);
  }

  async function remoto(acao, dados) {
    let resposta;
    try {
      // text/plain evita a verificação CORS "preflight", que o Apps Script não suporta.
      resposta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ acao, dados, senha }),
      });
    } catch {
      throw new Error('Sem conexão com o servidor. Verifique a internet e tente novamente.');
    }
    if (!resposta.ok) throw new Error(`Erro no servidor (${resposta.status}).`);
    const json = await resposta.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido.');
    return json.dados;
  }

  // ---------- Modo demonstração ----------
  function lerDemo() {
    const salvo = localStorage.getItem(CHAVE_DEMO);
    if (salvo) return JSON.parse(salvo);
    const inicial = {
      pessoas: [
        { id: 1, nome: 'Ana Vitória Gonçalves de Andrade', caixa: 'A5', tipo: 'PROFESSORES' },
        { id: 2, nome: 'Adelson Carlini', caixa: 'A1', tipo: 'ALUNOS' },
        { id: 3, nome: 'Ademar Cristofolini', caixa: 'A1', tipo: 'ALUNOS' },
        { id: 4, nome: 'Geovana Postengel', caixa: 'G2', tipo: 'ALUNOS' },
        { id: 5, nome: 'João da Silva', caixa: 'B1', tipo: 'FUNCIONÁRIOS' },
      ],
      caixas: ['A1', 'A2', 'A5', 'B1', 'G2'],
      tipos: ['ALUNOS', 'PROFESSORES', 'FUNCIONÁRIOS'],
    };
    gravarDemo(inicial);
    return inicial;
  }

  function gravarDemo(base) {
    localStorage.setItem(CHAVE_DEMO, JSON.stringify(base));
  }

  const normalizar = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  async function demo(acao, dados) {
    await new Promise((r) => setTimeout(r, 150));
    const base = lerDemo();
    switch (acao) {
      case 'entrar':
        return { mensagem: 'Acesso liberado' };
      case 'listar':
        return { ...base, atualizadoEm: new Date().toLocaleString('pt-BR') };
      case 'adicionarPessoa': {
        const pessoa = {
          id: Math.max(0, ...base.pessoas.map((p) => p.id)) + 1,
          nome: normalizar(dados.nome),
          caixa: normalizar(dados.caixa).toUpperCase(),
          tipo: normalizar(dados.tipo).toUpperCase(),
        };
        if (!pessoa.nome || !pessoa.caixa || !pessoa.tipo) throw new Error('Preencha todos os campos.');
        base.pessoas.push(pessoa);
        gravarDemo(base);
        return pessoa;
      }
      case 'excluirPessoa': {
        const antes = base.pessoas.length;
        base.pessoas = base.pessoas.filter((p) => p.id !== Number(dados.id));
        if (base.pessoas.length === antes) throw new Error('Pessoa não encontrada.');
        gravarDemo(base);
        return { id: dados.id };
      }
      case 'adicionarCaixa': {
        const caixa = normalizar(dados.caixa).toUpperCase();
        if (!caixa) throw new Error('Informe o nome da caixa.');
        if (base.caixas.includes(caixa)) throw new Error(`A caixa ${caixa} já existe.`);
        base.caixas.push(caixa);
        gravarDemo(base);
        return { caixa };
      }
      default:
        throw new Error('Ação desconhecida: ' + acao);
    }
  }

  const chamar = (acao, dados = {}) => (modoDemo ? demo(acao, dados) : remoto(acao, dados));

  return {
    modoDemo,
    temSenha: () => modoDemo || !!senha,
    definirSenha,
    esquecerSenha,
    entrar: () => chamar('entrar'),
    listar: () => chamar('listar'),
    adicionarPessoa: (dados) => chamar('adicionarPessoa', dados),
    excluirPessoa: (dados) => chamar('excluirPessoa', dados),
    adicionarCaixa: (caixa) => chamar('adicionarCaixa', { caixa }),
  };
})();
