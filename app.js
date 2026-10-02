(() => {
  const LIMITE_RESULTADOS = 200;
  const $ = (id) => document.getElementById(id);

  const estado = {
    pessoas: [],
    caixas: [],
    tipos: [],
    atualizadoEm: '',
    modoPesquisa: 'nome',
    ultimaCaixa: '',
    ultimoTipo: '',
  };

  // ---------- Utilitários ----------
  const semAcento = (t) =>
    String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const ordenarNatural = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

  const escapar = (t) =>
    String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const termos = (texto) => semAcento(texto).split(/\s+/).filter(Boolean);

  function prepararPessoa(p) {
    const nome = String(p.nome).normalize('NFC');
    return { ...p, nome, chave: semAcento(nome) };
  }

  function destacar(pessoa, lista) {
    const { nome, chave } = pessoa;
    if (!lista.length || chave.length !== nome.length) return escapar(nome);
    const marcado = new Array(nome.length).fill(false);
    for (const t of lista) {
      for (let i = chave.indexOf(t); i !== -1; i = chave.indexOf(t, i + 1)) {
        for (let k = i; k < i + t.length; k++) marcado[k] = true;
      }
    }
    let html = '';
    let aberto = false;
    for (let i = 0; i < nome.length; i++) {
      if (marcado[i] && !aberto) { html += '<mark>'; aberto = true; }
      if (!marcado[i] && aberto) { html += '</mark>'; aberto = false; }
      html += escapar(nome[i]);
    }
    return aberto ? html + '</mark>' : html;
  }

  function buscarPorNome(texto) {
    const lista = termos(texto);
    if (!lista.length) return { lista, resultados: [] };
    const inicio = lista.join(' ');
    const resultados = estado.pessoas
      .filter((p) => lista.every((t) => p.chave.includes(t)))
      .sort((a, b) => {
        const pa = a.chave.startsWith(inicio) ? 0 : 1;
        const pb = b.chave.startsWith(inicio) ? 0 : 1;
        return pa - pb || a.nome.localeCompare(b.nome, 'pt-BR');
      });
    return { lista, resultados };
  }

  function avisar(texto, erro = false) {
    const el = document.createElement('div');
    el.className = 'aviso-flutuante' + (erro ? ' erro-toast' : '');
    el.textContent = texto;
    $('avisos').appendChild(el);
    setTimeout(() => el.remove(), erro ? 7000 : 4000);
  }

  function carregando(ativo, texto = 'Carregando...') {
    $('carregando-texto').textContent = texto;
    $('carregando').hidden = !ativo;
  }

  function confirmar(titulo, html, textoBotao = 'Confirmar') {
    const dlg = $('dlg-confirmar');
    $('confirmar-titulo').textContent = titulo;
    $('confirmar-texto').innerHTML = html;
    $('confirmar-sim').textContent = textoBotao;
    dlg.showModal();
    return new Promise((resolve) => {
      const fim = (valor) => {
        dlg.close();
        $('confirmar-sim').onclick = $('confirmar-nao').onclick = dlg.oncancel = null;
        resolve(valor);
      };
      $('confirmar-sim').onclick = () => fim(true);
      $('confirmar-nao').onclick = () => fim(false);
      dlg.oncancel = () => fim(false);
    });
  }

  async function executar(botao, acao) {
    if (botao) botao.disabled = true;
    try {
      return await acao();
    } catch (erro) {
      tratarErro(erro);
      return undefined;
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  function tratarErro(erro) {
    const msg = erro.message || String(erro);
    if (/senha/i.test(msg)) {
      sair(msg);
      return;
    }
    avisar(msg, true);
  }

  // ---------- Acesso ----------
  function mostrarLogin(mensagem = '') {
    $('app').hidden = true;
    $('tela-login').hidden = false;
    $('login-erro').textContent = mensagem;
    $('login-senha').value = '';
    $('login-senha').focus();
  }

  function sair(mensagem = '') {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    Api.esquecerSenha();
    if (Api.modoDemo) {
      avisar('No modo demonstração não há senha. Configure o endereço da planilha para ativar o acesso.');
      return;
    }
    mostrarLogin(mensagem);
  }

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = e.submitter;
    botao.disabled = true;
    $('login-erro').textContent = '';
    Api.definirSenha($('login-senha').value, $('login-lembrar').checked);
    try {
      await Api.entrar();
      await abrirApp();
    } catch (erro) {
      Api.esquecerSenha();
      $('login-erro').textContent = erro.message;
    } finally {
      botao.disabled = false;
    }
  });

  async function abrirApp() {
    $('tela-login').hidden = true;
    $('app').hidden = false;
    const status = $('status-conexao');
    status.textContent = Api.modoDemo ? 'Modo demonstração' : 'Conectado ao Google Planilhas';
    status.className = 'status ' + (Api.modoDemo ? 'demo' : 'online');
    await carregarDados();
  }

  // ---------- Dados ----------
  async function carregarDados(texto = 'Carregando dados da planilha...') {
    carregando(true, texto);
    try {
      const dados = await Api.listar();
      estado.pessoas = dados.pessoas.map(prepararPessoa);
      estado.caixas = [...dados.caixas].sort(ordenarNatural);
      estado.tipos = dados.tipos;
      estado.atualizadoEm = dados.atualizadoEm;
      renderizarResumo();
      return true;
    } catch (erro) {
      tratarErro(erro);
      return false;
    } finally {
      carregando(false);
    }
  }

  function contarPorCaixa() {
    const contagem = {};
    for (const p of estado.pessoas) contagem[p.caixa] = (contagem[p.caixa] || 0) + 1;
    return contagem;
  }

  function renderizarResumo() {
    const cartao = (rotulo, valor, icone, classe = '') => `
      <div class="estat ${classe}">
        <span class="estat-icone"><svg><use href="#${icone}"/></svg></span>
        <div><strong>${valor.toLocaleString('pt-BR')}</strong><span>${escapar(rotulo)}</span></div>
      </div>`;
    $('estatisticas').innerHTML =
      cartao('Pessoas no arquivo', estado.pessoas.length, 'i-pessoas', 'estat-principal') +
      cartao('Caixas', estado.caixas.length, 'i-caixa') +
      estado.tipos
        .map((tipo) => cartao(tipo.toLowerCase(), estado.pessoas.filter((p) => p.tipo === tipo).length, 'i-pessoas'))
        .join('');
    $('ultima-atualizacao').textContent = estado.atualizadoEm
      ? `Dados atualizados em ${estado.atualizadoEm}`
      : '';
  }

  function opcoes(select, valores, rotulo, selecionado = '') {
    select.innerHTML =
      `<option value="">${rotulo}</option>` +
      valores
        .map((v) => {
          const valor = typeof v === 'string' ? v : v.valor;
          const texto = typeof v === 'string' ? v : v.texto;
          return `<option value="${escapar(valor)}"${valor === selecionado ? ' selected' : ''}>${escapar(texto)}</option>`;
        })
        .join('');
  }

  function linhaPessoa(p, lista, extra = '') {
    return `<tr>
      <td>${destacar(p, lista)}</td>
      <td><span class="etiqueta-caixa">${escapar(p.caixa || '—')}</span></td>
      <td><span class="etiqueta-tipo">${escapar(p.tipo || '—')}</span></td>
      ${extra}
    </tr>`;
  }

  function linhaVazia(colunas, texto) {
    return `<tr class="vazio"><td colspan="${colunas}">${escapar(texto)}</td></tr>`;
  }

  const botaoEditar = (p) =>
    `<td class="col-acao"><button type="button" class="btn btn-editar btn-pequeno" data-editar="${p.id}">Editar</button></td>`;

  // ---------- Diálogos: abrir/fechar ----------
  document.querySelectorAll('[data-abrir]').forEach((botao) =>
    botao.addEventListener('click', () => abrirDialogo(botao.dataset.abrir))
  );

  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar]')) dlg.close();
      else if (e.target === dlg && dlg.id !== 'dlg-confirmar') dlg.close();
    });
  });

  $('form-busca-rapida').addEventListener('submit', (e) => {
    e.preventDefault();
    const termo = $('busca-rapida').value;
    abrirDialogo('dlg-pesquisar');
    $('pesq-nome').value = termo;
    renderizarPesquisa();
    $('busca-rapida').value = '';
  });

  function abrirDialogo(id) {
    const preparar = {
      'dlg-pesquisar': prepararPesquisa,
      'dlg-adicionar': prepararAdicionar,
      'dlg-excluir': prepararExcluir,
      'dlg-caixa': prepararCaixa,
    }[id];
    preparar();
    $(id).showModal();
    const foco = $(id).querySelector('input:not([hidden]), select');
    if (foco) foco.focus();
  }

  // ---------- Pesquisar ----------
  function prepararPesquisa() {
    $('pesq-nome').value = '';
    const contagem = contarPorCaixa();
    opcoes(
      $('pesq-caixa'),
      estado.caixas.map((c) => ({ valor: c, texto: `${c}  (${contagem[c] || 0} pessoas)` })),
      'Selecione uma caixa...'
    );
    definirModoPesquisa('nome');
  }

  function definirModoPesquisa(modo) {
    estado.modoPesquisa = modo;
    document.querySelectorAll('#dlg-pesquisar .aba').forEach((a) =>
      a.classList.toggle('ativa', a.dataset.modo === modo)
    );
    $('pesq-campo-nome').hidden = modo !== 'nome';
    $('pesq-campo-caixa').hidden = modo !== 'caixa';
    renderizarPesquisa();
    (modo === 'nome' ? $('pesq-nome') : $('pesq-caixa')).focus();
  }

  function renderizarPesquisa() {
    const corpo = $('pesq-resultados');
    const info = $('pesq-info');

    if (estado.modoPesquisa === 'caixa') {
      const caixa = $('pesq-caixa').value;
      if (!caixa) {
        info.textContent = 'Escolha uma caixa para ver quem está nela.';
        corpo.innerHTML = linhaVazia(4, 'Nenhuma caixa selecionada');
        return;
      }
      const lista = estado.pessoas
        .filter((p) => p.caixa === caixa)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      info.textContent = `${lista.length} pessoa(s) na caixa ${caixa}.`;
      corpo.innerHTML = lista.length
        ? lista.map((p) => linhaPessoa(p, [], botaoEditar(p))).join('')
        : linhaVazia(4, 'Caixa vazia');
      return;
    }

    const { lista, resultados } = buscarPorNome($('pesq-nome').value);
    if (!lista.length) {
      info.textContent = 'Digite o nome (ou parte dele). Não precisa usar acentos. Para corrigir um registro, clique em "Editar".';
      corpo.innerHTML = linhaVazia(4, 'Digite para pesquisar');
      return;
    }
    info.textContent = resultados.length > LIMITE_RESULTADOS
      ? `${resultados.length} encontrados. Mostrando os ${LIMITE_RESULTADOS} primeiros — refine a busca.`
      : `${resultados.length} encontrado(s).`;
    corpo.innerHTML = resultados.length
      ? resultados.slice(0, LIMITE_RESULTADOS).map((p) => linhaPessoa(p, lista, botaoEditar(p))).join('')
      : linhaVazia(4, 'Nenhuma pessoa encontrada com esse nome');
  }

  $('pesq-nome').addEventListener('input', renderizarPesquisa);
  $('pesq-caixa').addEventListener('change', renderizarPesquisa);
  document.querySelectorAll('#dlg-pesquisar .aba').forEach((a) =>
    a.addEventListener('click', () => definirModoPesquisa(a.dataset.modo))
  );

  // ---------- Adicionar ao arquivo ----------
  function prepararAdicionar() {
    $('form-adicionar').reset();
    $('add-aviso').hidden = true;
    opcoes($('add-caixa'), estado.caixas, 'Selecione...', estado.ultimaCaixa);
    opcoes($('add-tipo'), estado.tipos, 'Selecione...', estado.ultimoTipo);
  }

  function homonimos(nome, ignorarId = null) {
    const chave = termos(nome).join(' ');
    return chave ? estado.pessoas.filter((p) => p.chave === chave && p.id !== ignorarId) : [];
  }

  $('add-nome').addEventListener('input', () => {
    const iguais = homonimos($('add-nome').value);
    const aviso = $('add-aviso');
    aviso.hidden = !iguais.length;
    aviso.innerHTML = iguais
      .map((p) => `Já existe no arquivo: <strong>${escapar(p.nome)}</strong> — caixa ${escapar(p.caixa)} (${escapar(p.tipo || 'sem tipo')})`)
      .join('<br>');
  });

  $('form-adicionar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = {
      nome: $('add-nome').value.replace(/\s+/g, ' ').trim(),
      caixa: $('add-caixa').value,
      tipo: $('add-tipo').value,
    };
    if (!dados.nome) return $('add-nome').focus();

    if (homonimos(dados.nome).length) {
      const ok = await confirmar(
        'Nome repetido',
        `Já existe alguém chamado <strong>${escapar(dados.nome)}</strong> no arquivo.<br>Deseja adicionar mesmo assim?`,
        'Adicionar mesmo assim'
      );
      if (!ok) return;
    }

    const pessoa = await executar(e.submitter, () => Api.adicionarPessoa(dados));
    if (!pessoa) return;
    estado.pessoas.push(prepararPessoa(pessoa));
    estado.ultimaCaixa = dados.caixa;
    estado.ultimoTipo = dados.tipo;
    renderizarResumo();
    $('dlg-adicionar').close();
    avisar(`${pessoa.nome} adicionado(a) na caixa ${pessoa.caixa}.`);
  });

  // ---------- Editar registro ----------
  let emEdicao = null;

  $('pesq-resultados').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-editar]');
    if (!botao) return;
    const pessoa = estado.pessoas.find((p) => p.id === Number(botao.dataset.editar));
    if (pessoa) abrirEdicao(pessoa);
  });

  function abrirEdicao(pessoa) {
    emEdicao = pessoa;
    $('form-editar').reset();
    $('edt-aviso').hidden = true;
    $('edt-nome').value = pessoa.nome;
    opcoes($('edt-caixa'), estado.caixas, 'Selecione...', pessoa.caixa);
    opcoes($('edt-tipo'), estado.tipos, 'Selecione...', pessoa.tipo);
    $('dlg-editar').showModal();
    $('edt-nome').focus();
  }

  $('edt-nome').addEventListener('input', () => {
    const iguais = homonimos($('edt-nome').value, emEdicao && emEdicao.id);
    const aviso = $('edt-aviso');
    aviso.hidden = !iguais.length;
    aviso.innerHTML = iguais
      .map((p) => `Já existe no arquivo: <strong>${escapar(p.nome)}</strong> — caixa ${escapar(p.caixa)} (${escapar(p.tipo || 'sem tipo')})`)
      .join('<br>');
  });

  $('form-editar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pessoa = emEdicao;
    if (!pessoa) return;
    const dados = {
      id: pessoa.id,
      nomeAtual: pessoa.nome,
      nome: $('edt-nome').value.replace(/\s+/g, ' ').trim(),
      caixa: $('edt-caixa').value,
      tipo: $('edt-tipo').value,
    };
    if (!dados.nome) return $('edt-nome').focus();
    if (dados.nome === pessoa.nome && dados.caixa === pessoa.caixa && dados.tipo === pessoa.tipo) {
      $('dlg-editar').close();
      return;
    }

    const editada = await executar(e.submitter, () => Api.editarPessoa(dados));
    if (!editada) return;
    const atualizada = prepararPessoa(editada);
    estado.pessoas = estado.pessoas.map((p) => (p.id === atualizada.id ? atualizada : p));
    renderizarResumo();
    if ($('dlg-pesquisar').open) renderizarPesquisa();
    $('dlg-editar').close();
    avisar(`Registro de ${atualizada.nome} atualizado (caixa ${atualizada.caixa}).`);
  });

  // ---------- Excluir do arquivo ----------
  function prepararExcluir() {
    $('exc-nome').value = '';
    renderizarExcluir();
  }

  function renderizarExcluir() {
    const { lista, resultados } = buscarPorNome($('exc-nome').value);
    const corpo = $('exc-resultados');
    const info = $('exc-info');
    if (!lista.length) {
      info.textContent = 'Pesquise a pessoa que deseja excluir.';
      corpo.innerHTML = linhaVazia(4, 'Digite para pesquisar');
      return;
    }
    info.textContent = resultados.length > LIMITE_RESULTADOS
      ? `${resultados.length} encontrados. Mostrando os ${LIMITE_RESULTADOS} primeiros — refine a busca.`
      : `${resultados.length} encontrado(s).`;
    const botao = (p) =>
      `<td class="col-acao"><button type="button" class="btn btn-perigo btn-pequeno" data-excluir="${p.id}">Excluir</button></td>`;
    corpo.innerHTML = resultados.length
      ? resultados.slice(0, LIMITE_RESULTADOS).map((p) => linhaPessoa(p, lista, botao(p))).join('')
      : linhaVazia(4, 'Nenhuma pessoa encontrada com esse nome');
  }

  $('exc-nome').addEventListener('input', renderizarExcluir);

  $('exc-resultados').addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-excluir]');
    if (!botao) return;
    const pessoa = estado.pessoas.find((p) => p.id === Number(botao.dataset.excluir));
    if (!pessoa) return;

    const ok = await confirmar(
      'Excluir pessoa',
      `Tem certeza que deseja excluir do arquivo?<br><br>
       <strong>${escapar(pessoa.nome)}</strong><br>
       Caixa: <strong>${escapar(pessoa.caixa)}</strong> · Tipo: ${escapar(pessoa.tipo || '—')}<br><br>
       Esta ação não pode ser desfeita.`,
      'Excluir pessoa'
    );
    if (!ok) return;

    const resultado = await executar(botao, () => Api.excluirPessoa({ id: pessoa.id, nome: pessoa.nome }));
    if (!resultado) return;
    estado.pessoas = estado.pessoas.filter((p) => p.id !== pessoa.id);
    renderizarResumo();
    renderizarExcluir();
    avisar(`${pessoa.nome} foi excluído(a) do arquivo.`);
  });

  // ---------- Adicionar caixa ----------
  function prepararCaixa() {
    $('form-caixa').reset();
    $('caixa-aviso').hidden = true;
    $('caixa-existentes').innerHTML = estado.caixas
      .map((c) => `<button type="button" class="chip" data-renomear="${escapar(c)}" title="Renomear caixa ${escapar(c)}">${escapar(c)}</button>`)
      .join('');
  }

  $('caixa-nome').addEventListener('input', () => {
    const valor = $('caixa-nome').value.trim().toUpperCase();
    const existe = valor && estado.caixas.includes(valor);
    $('caixa-aviso').hidden = !existe;
    $('caixa-aviso').textContent = existe ? `A caixa ${valor} já existe.` : '';
  });

  $('form-caixa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const caixa = $('caixa-nome').value.trim().toUpperCase();
    if (!caixa) return;
    if (estado.caixas.includes(caixa)) {
      avisar(`A caixa ${caixa} já existe.`, true);
      return;
    }
    const resultado = await executar(e.submitter, () => Api.adicionarCaixa(caixa));
    if (!resultado) return;
    estado.caixas = [...estado.caixas, resultado.caixa].sort(ordenarNatural);
    renderizarResumo();
    $('dlg-caixa').close();
    avisar(`Caixa ${resultado.caixa} adicionada com sucesso.`);
  });

  // ---------- Renomear caixa ----------
  let caixaEmEdicao = '';

  $('caixa-existentes').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-renomear]');
    if (!chip) return;
    caixaEmEdicao = chip.dataset.renomear;
    const total = contarPorCaixa()[caixaEmEdicao] || 0;
    $('form-renomear-caixa').reset();
    $('ren-atual').textContent = caixaEmEdicao;
    $('ren-nova').value = caixaEmEdicao;
    $('ren-aviso').hidden = true;
    $('ren-info').textContent = total
      ? `As ${total} pessoa(s) desta caixa passarão para o novo nome.`
      : 'Esta caixa está vazia.';
    $('dlg-renomear-caixa').showModal();
    $('ren-nova').select();
  });

  $('ren-nova').addEventListener('input', () => {
    const valor = $('ren-nova').value.trim().toUpperCase();
    const existe = valor && valor !== caixaEmEdicao && estado.caixas.includes(valor);
    $('ren-aviso').hidden = !existe;
    $('ren-aviso').textContent = existe ? `A caixa ${valor} já existe.` : '';
  });

  $('form-renomear-caixa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const antiga = caixaEmEdicao;
    const nova = $('ren-nova').value.replace(/\s+/g, ' ').trim().toUpperCase();
    if (!nova) return $('ren-nova').focus();
    if (nova === antiga) {
      $('dlg-renomear-caixa').close();
      return;
    }
    if (estado.caixas.includes(nova)) {
      avisar(`A caixa ${nova} já existe.`, true);
      return;
    }

    const resultado = await executar(e.submitter, () => Api.renomearCaixa(antiga, nova));
    if (!resultado) return;
    estado.caixas = estado.caixas.map((c) => (c === antiga ? resultado.nova : c)).sort(ordenarNatural);
    estado.pessoas = estado.pessoas.map((p) => (p.caixa === antiga ? { ...p, caixa: resultado.nova } : p));
    if (estado.ultimaCaixa === antiga) estado.ultimaCaixa = resultado.nova;
    renderizarResumo();
    prepararCaixa();
    $('dlg-renomear-caixa').close();
    avisar(`Caixa ${antiga} renomeada para ${resultado.nova} (${resultado.pessoas} pessoa(s) atualizada(s)).`);
  });

  // ---------- Backup ----------
  function carimboData() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
  }

  function baixarArquivo(conteudo, nome, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function pessoasOrdenadas() {
    return [...estado.pessoas].sort((a, b) => a.id - b.id);
  }

  function backupExcel(nomeBase) {
    const contagem = contarPorCaixa();
    const livro = XLSX.utils.book_new();
    const pessoas = XLSX.utils.aoa_to_sheet([
      ['ID', 'Nome', 'Caixa', 'Tipo'],
      ...pessoasOrdenadas().map((p) => [p.id, p.nome, p.caixa, p.tipo]),
    ]);
    pessoas['!cols'] = [{ wch: 8 }, { wch: 50 }, { wch: 14 }, { wch: 16 }];
    const caixas = XLSX.utils.aoa_to_sheet([
      ['Caixa', 'Quantidade de pessoas'],
      ...estado.caixas.map((c) => [c, contagem[c] || 0]),
    ]);
    caixas['!cols'] = [{ wch: 16 }, { wch: 22 }];
    const tipos = XLSX.utils.aoa_to_sheet([['Tipo'], ...estado.tipos.map((t) => [t])]);
    const info = XLSX.utils.aoa_to_sheet([
      ['Backup do Arquivo Permanente - E.E.B. Frei Lucínio Korte'],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      ['Total de pessoas', estado.pessoas.length],
      ['Total de caixas', estado.caixas.length],
    ]);
    info['!cols'] = [{ wch: 22 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(livro, pessoas, 'Pessoas');
    XLSX.utils.book_append_sheet(livro, caixas, 'Caixas');
    XLSX.utils.book_append_sheet(livro, tipos, 'Tipos');
    XLSX.utils.book_append_sheet(livro, info, 'Informações');
    XLSX.writeFile(livro, `${nomeBase}.xlsx`);
  }

  function backupCsv(nomeBase) {
    const celula = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['ID', 'Nome', 'Caixa', 'Tipo'], ...pessoasOrdenadas().map((p) => [p.id, p.nome, p.caixa, p.tipo])];
    const csv = '\uFEFF' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
    baixarArquivo(csv, `${nomeBase}.csv`, 'text/csv;charset=utf-8');
  }

  $('btn-backup').addEventListener('click', async () => {
    const atualizado = await carregarDados('Buscando os dados mais recentes para o backup...');
    if (!atualizado && !estado.pessoas.length) return;
    if (!atualizado) avisar('Não foi possível atualizar; o backup usará os dados já carregados.', true);

    const nomeBase = `backup-arquivo-permanente_${carimboData()}`;
    try {
      if (window.XLSX) {
        backupExcel(nomeBase);
      } else {
        backupCsv(nomeBase);
      }
      avisar(`Backup baixado com ${estado.pessoas.length.toLocaleString('pt-BR')} pessoas.`);
    } catch (erro) {
      avisar('Falha ao gerar o backup: ' + erro.message, true);
    }
  });

  // ---------- Topo ----------
  $('btn-atualizar').addEventListener('click', async () => {
    if (await carregarDados()) avisar('Dados atualizados.');
  });

  $('btn-sair').addEventListener('click', async () => {
    if (await confirmar('Sair', 'Deseja sair do sistema?', 'Sair')) sair();
  });

  // ---------- Início ----------
  if (Api.temSenha()) abrirApp();
  else mostrarLogin();
})();
