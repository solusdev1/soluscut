import Link from "next/link";

const features = [
  {
    number: "01",
    title: "Cortes que entendem contexto",
    copy: "Detecção de fala, rostos e ritmo para encontrar os trechos que realmente merecem virar clipe.",
  },
  {
    number: "02",
    title: "Composição pronta para o feed",
    copy: "Reenquadramento 9:16, tela dividida e safe zones ajustáveis em um workspace visual preciso.",
  },
  {
    number: "03",
    title: "Transformação com identidade",
    copy: "Zoom, velocidade, pitch e textura calibrados para criar uma linguagem própria em cada publicação.",
  },
];

export default function Home() {
  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="Navegação principal">
        <Link href="/" className="brand-lockup" aria-label="Hydra Creator — início">
          <span className="brand-mark" aria-hidden="true"><span>H</span></span>
          <span>
            <strong>Hydra</strong>
            <small>Creator OS</small>
          </span>
        </Link>

        <div className="marketing-links">
          <a href="#produto">Produto</a>
          <a href="#recursos">Recursos</a>
          <span className="nav-status"><i /> Sistema operacional</span>
        </div>

        <Link href="/editor" className="button button-secondary button-sm">
          Abrir workspace <span aria-hidden="true">↗</span>
        </Link>
      </nav>

      <section className="hero-section" id="produto">
        <div className="hero-copy">
          <div className="eyebrow"><span>✦</span> Inteligência criativa para vídeo</div>
          <h1>
            Conteúdo longo entra.<br />
            <span>Clipes memoráveis saem.</span>
          </h1>
          <p>
            Transforme podcasts, entrevistas e gameplays em vídeos verticais prontos para publicar — com análise inteligente e controle criativo de verdade.
          </p>
          <div className="hero-actions">
            <Link href="/editor" className="button button-primary">
              Criar meu primeiro clipe <span aria-hidden="true">→</span>
            </Link>
            <a href="#recursos" className="text-link"><span aria-hidden="true">◎</span> Explorar o produto</a>
          </div>
          <div className="proof-row" aria-label="Benefícios do produto">
            <span><i>✓</i> Setup em minutos</span>
            <span><i>✓</i> Preview em tempo real</span>
            <span><i>✓</i> Exportação 1080p</span>
          </div>
        </div>

        <div className="hero-product" aria-label="Preview do workspace Hydra Creator">
          <div className="product-glow" />
          <div className="product-window">
            <div className="window-bar">
              <div className="window-dots"><i /><i /><i /></div>
              <span>Podcast — Episódio 24</span>
              <div className="window-live"><i /> Análise concluída</div>
            </div>
            <div className="window-body">
              <aside className="mini-sidebar" aria-hidden="true">
                <div className="mini-logo">H</div>
                <i className="active" /><i /><i /><i />
              </aside>
              <div className="mini-workspace">
                <div className="mini-heading"><span>COMPOSIÇÃO</span><strong>Preview inteligente</strong></div>
                <div className="mini-stage">
                  <div className="source-video">
                    <div className="person person-one"><span /></div>
                    <div className="person person-two"><span /></div>
                    <div className="crop-window"><em>9:16</em></div>
                    <div className="source-caption">Seu conteúdo, reenquadrado automaticamente</div>
                  </div>
                  <div className="vertical-video">
                    <div className="vertical-top"><span /></div>
                    <div className="vertical-bottom"><span /></div>
                    <b>PREVIEW</b>
                  </div>
                </div>
                <div className="mini-timeline">
                  <div className="timeline-labels"><span>00:00</span><span>00:12</span><span>00:24</span><span>00:36</span></div>
                  <div className="timeline-tracks"><i /><i /><i /></div>
                  <div className="timeline-head" />
                </div>
              </div>
              <aside className="mini-inspector" aria-hidden="true">
                <span>LAYOUT</span>
                <div className="layout-options"><i /><i className="active" /><i /></div>
                <span>AJUSTE FINO</span>
                <label>Zoom <b>1.15×</b></label><div className="fake-range"><i style={{ width: "62%" }} /></div>
                <label>Velocidade <b>2.0%</b></label><div className="fake-range"><i style={{ width: "48%" }} /></div>
                <div className="quality-score"><span>QUALIDADE</span><strong>94</strong><small>/100</small></div>
              </aside>
            </div>
          </div>
          <div className="floating-card floating-card-top"><span>✦</span><div><b>12 cortes encontrados</b><small>3 com alto potencial</small></div></div>
          <div className="floating-card floating-card-bottom"><strong>9:16</strong><div><b>Pronto para o feed</b><small>1080 × 1920 · 30 fps</small></div></div>
        </div>
      </section>

      <section className="metrics-strip" aria-label="Métricas do Hydra Creator">
        <div><strong>10×</strong><span>mais rápido do que editar manualmente</span></div>
        <div><strong>3</strong><span>layouts inteligentes para cada narrativa</span></div>
        <div><strong>1080p</strong><span>qualidade final pronta para publicar</span></div>
        <div><strong>1 fluxo</strong><span>da análise à exportação do clipe</span></div>
      </section>

      <section className="features-section" id="recursos">
        <div className="section-heading">
          <div className="eyebrow"><span>02</span> Feito para quem cria</div>
          <h2>Menos operação.<br /><span>Mais direção criativa.</span></h2>
          <p>Um fluxo visual que combina automação onde ela acelera e controle onde ele realmente importa.</p>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.number}>
              <span className="feature-number">{feature.number}</span>
              <div className={`feature-visual feature-${feature.number}`} aria-hidden="true"><i /><i /><i /></div>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div>
          <span className="eyebrow"><span>✦</span> Seu próximo clipe começa aqui</span>
          <h2>Do vídeo bruto ao corte certo.</h2>
        </div>
        <Link href="/editor" className="button button-primary">Entrar no workspace <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="marketing-footer">
        <div className="brand-lockup"><span className="brand-mark"><span>H</span></span><span><strong>Hydra</strong><small>Creator OS</small></span></div>
        <p>Inteligência e precisão para o novo ritmo do conteúdo.</p>
        <span>© 2026 Hydra Labs</span>
      </footer>
    </main>
  );
}
