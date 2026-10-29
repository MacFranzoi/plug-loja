/* Plug · conta da equipe + ofertas. Carregado em todas as páginas da loja.
   - Login é o mesmo da Academia (nome + PIN). O cookie fica em academia.plugshopping.com.br
     e vale aqui porque é o mesmo site (*.plugshopping.com.br).
   - Promoções, combos, destaques e ocultos vêm da Academia (/api/loja/ofertas) e valem na hora. */
(function () {
  const API = (localStorage.getItem("plugApi") || "https://academia.plugshopping.com.br").replace(/\/$/, "");
  const PC = window.PlugConta = { api: API, usuario: null, funcoes: [], ofertas: { promos: [], combos: [], destaques: [], ocultos: [] } };
  const brl = v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sa = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  PC.brl = brl;

  const chama = (rota, op = {}) => fetch(API + rota, { credentials: "include", ...op, headers: { "Content-Type": "application/json", ...(op.headers || {}) } })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || "Erro " + r.status); return j; });
  PC.chama = chama;
  const tempo = (p, ms) => Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error("tempo")), ms))]);

  /* ---------- chaves e preço ---------- */
  PC.kAce = it => "a:" + it.c + "|" + it.n;
  PC.kCel = (m, v) => "c:" + m.slug + "|" + v.id;
  // final ,99 nos acessórios; 49,99/99,99 nos celulares (regra da Plug: arredonda para cima, mas fica abaixo do preço normal)
  const cent = v => Math.round(v * 100) / 100;
  // menor preço terminado em ,99 (ou 49,99/99,99) que seja ≥ v; se encostar no preço normal, desce um degrau
  const fimAce = (v, base) => { v = cent(v); let x = Math.ceil(cent(v - 0.99)) + 0.99; if (x >= base) x -= 1; return cent(x); };
  const fimCel = (v, base) => { v = cent(v); let x = Math.ceil(cent(v - 49.99) / 50) * 50 + 49.99; if (x >= base) x -= 50; return cent(x); };
  PC.fimAce = fimAce;
  function aplica(base, p, cel) {
    if (p.tipo === "preco") return p.valor < base ? p.valor : null;
    const v = p.tipo === "pct" ? base * (1 - p.valor / 100) : base - p.valor;
    if (v <= 0) return null;
    const x = (cel ? fimCel : fimAce)(v, base);
    return x > 0 && x < base ? x : null;
  }
  PC.precoCom = aplica;
  const casaAce = (p, it) => ({ itens: () => (p.chaves || []).includes(PC.kAce(it)), categoria: () => it.cat === p.chave, grupo: () => it.g === p.chave, tudo_acessorios: () => true })[p.alvo]?.() || false;
  const casaCel = (p, m, v) => ({ itens: () => (p.chaves || []).includes(PC.kCel(m, v)), modelo: () => m.slug === p.chave, marca: () => m.marca === p.chave, condicao: () => v.condicao === p.chave, tudo_celulares: () => true })[p.alvo]?.() || false;
  // melhor promoção (menor preço) que vale para o item
  PC.promoAce = (it, base, lista) => (lista || PC.ofertas.promos).filter(p => casaAce(p, it)).map(p => ({ p, preco: aplica(base, p, false) })).filter(x => x.preco).sort((a, b) => a.preco - b.preco)[0] || null;
  PC.promoCel = (m, v, base, lista) => (lista || PC.ofertas.promos).filter(p => casaCel(p, m, v)).map(p => ({ p, preco: aplica(base, p, true) })).filter(x => x.preco).sort((a, b) => a.preco - b.preco)[0] || null;
  const selo = (x, base) => x.p.selo || `-${Math.max(1, Math.round((1 - x.preco / base) * 100))}%`; // desconto real, já arredondado

  // acessórios: troca o preço, marca "de/por", esconde ocultos, liga destaques, cria os combos como produtos
  PC.aplicaAcessorios = function (itens) {
    const o = PC.ofertas, ocultos = new Set(o.ocultos), dest = new Set(o.destaques);
    const L = itens.filter(it => !ocultos.has(PC.kAce(it)));
    for (const it of L) {
      if (it.p0 === undefined) it.p0 = it.p;
      it.p = it.p0; it.selo = ""; it.promo = false;
      const x = PC.promoAce(it, it.p0);
      if (x) { it.p = x.preco; it.selo = selo(x, it.p0); it.promo = true; }
      if (dest.has(PC.kAce(it))) it.destaque = true;
    }
    const porChave = new Map(L.map(it => [PC.kAce(it), it]));
    for (const c of o.combos || []) {
      const partes = c.itens.map(i => ({ ...i, it: porChave.get(i.chave) }));
      if (partes.some(x => x.chave.startsWith("a:") && !x.it)) continue; // algum acessório do combo saiu da loja: combo some
      const soma = partes.reduce((s, x) => s + (x.it ? x.it.p0 : x.preco || 0) * x.qtd, 0);
      const fs = partes.flatMap(x => x.it ? x.it.fs.slice(0, 1) : x.foto ? [x.foto] : []);
      L.push({ n: c.nome, g: "Combo", cat: "Combos", p: c.preco, p0: soma > c.preco ? +soma.toFixed(2) : c.preco, c: "combo:" + c.id, v: 1e6, gar: false, combo: true,
        selo: soma > c.preco ? `-${Math.round((1 - c.preco / soma) * 100)}%` : "COMBO", promo: soma > c.preco, fs: fs.length ? fs : ["../logo.png"], f: fs[0] || "../logo.png",
        r: c.descricao || "Leve junto e pague menos.", d: partes.map(x => `${x.qtd > 1 ? x.qtd + "× " : ""}${x.it ? x.it.n : x.nome}`), fi: [] });
    }
    return L;
  };
  // celulares: mexe no pix e na tabela de cada variante (mantém o original em pix0/tabela0)
  PC.aplicaCelulares = function (modelos) {
    const o = PC.ofertas, ocultos = new Set(o.ocultos), dest = new Set(o.destaques);
    const L = modelos.filter(m => !ocultos.has("m:" + m.slug));
    for (const m of L) {
      if (dest.has("m:" + m.slug)) m.destaque = true;
      for (const v of m.variantes) {
        if (v.pix0 === undefined) { v.pix0 = v.pix; v.tabela0 = JSON.parse(JSON.stringify(v.tabela || {})); }
        v.pix = v.pix0; v.tabela = JSON.parse(JSON.stringify(v.tabela0)); v.selo = ""; v.promo = false;
        const x = PC.promoCel(m, v, v.pix0);
        if (!x) continue;
        const r = x.preco / v.pix0;
        v.pix = x.preco; v.selo = selo(x, v.pix0); v.promo = true;
        for (const [k, t] of Object.entries(v.tabela)) {
          t.total = k === "PIX" ? x.preco : fimCel(t.total * r, v.tabela0[k].total);
          t.parcela = Math.ceil(t.total / t.vezes * 100) / 100;
        }
      }
      m.promo = m.variantes.some(v => v.promo);
    }
    return L;
  };

  /* ---------- barra da equipe ---------- */
  const css = `.pc-eq{position:fixed;left:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:90;font:600 13px Figtree,system-ui,sans-serif}
  .pc-eq button,.pc-eq a{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:#0c0c0dcc;color:#fff;border:1px solid #ffffff26;backdrop-filter:blur(8px);margin-right:6px}
  .pc-eq.pc-pe{position:static;margin-top:14px}.pc-eq.pc-pe button{background:transparent;color:inherit;border-color:currentColor;padding:6px 12px;opacity:.6}
  .pc-eq .pc-on{background:#ffe01a;color:#0c0c0d;border-color:#ffe01a}
  .pc-eq .pc-x{opacity:.55;font-size:12px}
  .pc-mod{position:fixed;inset:0;z-index:200;background:#000a;display:grid;place-items:center;padding:16px}
  .pc-mod form{background:#141416;color:#fff;border:1px solid #2a2a2e;border-radius:20px;padding:22px;width:min(360px,100%);font:15px Figtree,system-ui,sans-serif}
  .pc-mod h3{margin:0 0 4px;font:800 22px "Bricolage Grotesque",Figtree,sans-serif}.pc-mod p{margin:0 0 14px;color:#aaa;font-size:13px}
  .pc-mod input{box-sizing:border-box;width:100%;margin:0 0 10px;padding:12px 14px;border-radius:12px;border:1px solid #333;background:#0c0c0d;color:#fff;font:16px Figtree,sans-serif}
  .pc-mod .pc-b{display:flex;gap:8px;margin-top:4px}.pc-mod button{flex:1;padding:12px;border-radius:12px;border:0;font:700 15px Figtree,sans-serif;cursor:pointer}
  .pc-mod .pc-ok{background:#ffe01a;color:#0c0c0d}.pc-mod .pc-no{background:#2a2a2e;color:#fff}.pc-mod .pc-err{color:#ff8a8a;min-height:18px;font-size:13px}
  body.pc-f-codigo .pc-cod{display:block!important}
  .pc-cod{display:none;font:500 11px "IBM Plex Mono",monospace;color:#888;margin-top:2px}`;
  function barra() {
    let el = document.querySelector(".pc-eq");
    if (!el) { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); el = document.createElement("div"); el.className = "pc-eq"; }
    const raizT = location.pathname.includes("/acessorios/") || location.pathname.includes("/p/") || location.pathname.includes("/painel/") ? "../" : "";
    // página com espaço no cabeçalho (#pcTopo): o login fica lá, visível
    const topo = document.getElementById("pcTopo");
    if (topo) {
      el.remove();
      const ICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
      topo.innerHTML = !PC.usuario
        ? `<button class="conta" data-pc="entrar" title="Área da equipe">${ICO}<span>Entrar</span></button>`
        : `<details class="conta-m"><summary class="conta">${ICO}<span>${PC.usuario.nome.split(" ")[0]}</span></summary><div class="conta-l">`
          + (PC.funcoes.includes("produtos") ? `<a href="${raizT}painel/">Painel de produtos</a>` : "")
          + `<button data-pc="sair">Sair</button></div></details>`;
      return;
    }
    // sem login: link discreto no rodapé; logado: botões flutuando acima do carrinho
    const pe = document.querySelector("footer .w, footer .wrap, footer") || document.body;
    if (PC.usuario) { el.classList.remove("pc-pe"); document.body.appendChild(el); } else { el.classList.add("pc-pe"); pe.appendChild(el); }
    const raiz = location.pathname.includes("/acessorios/") || location.pathname.includes("/p/") || location.pathname.includes("/painel/") ? "../" : "";
    if (!PC.usuario) { el.innerHTML = `<button data-pc="entrar" class="pc-x" title="Área da equipe">Equipe</button>`; return; }
    el.innerHTML = `<button class="pc-on" data-pc="sair" title="Sair">${PC.usuario.nome.split(" ")[0]} · sair</button>`
      + (PC.funcoes.includes("produtos") && !location.pathname.includes("/painel/") ? `<a href="${raiz}painel/">Painel de produtos</a>` : "");
  }
  function modalLogin() {
    const m = document.createElement("div"); m.className = "pc-mod";
    m.innerHTML = `<form><h3>Área da equipe</h3><p>Mesmo nome e PIN da Academia Plug.</p>
      <input name="nome" placeholder="Seu nome" autocomplete="username" required><input name="pin" placeholder="PIN" inputmode="numeric" type="password" autocomplete="current-password" required>
      <div class="pc-err"></div><div class="pc-b"><button type="button" class="pc-no">Cancelar</button><button class="pc-ok">Entrar</button></div></form>`;
    document.body.appendChild(m); m.querySelector("input").focus();
    m.querySelector(".pc-no").onclick = () => m.remove();
    m.querySelector("form").onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target), err = m.querySelector(".pc-err"); err.textContent = "Entrando…";
      try {
        const u = await chama("/api/login", { method: "POST", body: JSON.stringify({ nome: f.get("nome"), pin: f.get("pin") }) });
        if (u.trocar_pin) { err.innerHTML = `Primeiro escolha seu PIN na <a style="color:#ffe01a" href="${API}">Academia</a>.`; return; }
        m.remove(); await eu(); PC.avisa();
      } catch (x) { err.textContent = x.message === "Failed to fetch" ? "Sem conexão com a Academia." : x.message; }
    };
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-pc]"); if (!b) return;
    if (b.dataset.pc === "entrar") modalLogin();
    if (b.dataset.pc === "sair") { try { await chama("/api/logout", { method: "POST" }); } catch (x) { } PC.usuario = null; PC.funcoes = []; ligaFuncoes(); barra(); PC.avisa(); }
  });
  function ligaFuncoes() {
    document.body.className = document.body.className.replace(/\bpc-f-\S+/g, "").trim();
    PC.funcoes.forEach(f => document.body.classList.add("pc-f-" + f));
  }
  async function eu() {
    try { const r = await tempo(chama("/api/loja/eu"), 4000); PC.usuario = r.usuario; PC.funcoes = r.funcoes || []; } catch (e) { PC.usuario = null; PC.funcoes = []; }
    ligaFuncoes(); barra();
  }
  PC.pode = f => PC.funcoes.includes(f);

  /* ---------- avisos para a página ---------- */
  const ouvintes = [];
  PC.quandoMudar = fn => { ouvintes.push(fn); if (PC.carregado) fn(PC); };
  PC.avisa = () => ouvintes.forEach(fn => { try { fn(PC); } catch (e) { console.error(e); } });

  async function iniciar() {
    barra();
    const of = tempo(fetch(API + "/api/loja/ofertas").then(r => r.json()), 4000).then(o => { PC.ofertas = { promos: [], combos: [], destaques: [], ocultos: [], ...o }; }).catch(() => { });
    await Promise.all([of, eu()]);
    PC.carregado = true; PC.avisa();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
