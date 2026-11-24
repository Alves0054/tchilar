import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./core.jsx";
import { InfoLinks } from "./shared.jsx";

export function InfoPage({ kicker, title, intro, draft, children }) {
  useEffect(() => { window.scrollTo(0, 0); }, [title]);
  return <article className="page narrow info-page">
    <header className="info-header">
      <p className="feed-section-kicker">{kicker}</p>
      <h1>{title}</h1>
      {intro && <p className="info-intro">{intro}</p>}
      {draft && <p className="info-draft" role="note"><Icon name="info" size={15} /> Rascunho: este texto tem de ser revisto por um jurista antes de o Tchilar abrir ao público.</p>}
    </header>
    <div className="info-body card">{children}</div>
    <InfoLinks />
  </article>;
}
export function About() {
  return <InfoPage kicker="Sobre" title="Conecta. Partilha. Vive."
    intro="O Tchilar é o lugar para estares perto de quem importa: as tuas pessoas, as tuas ideias e a tua comunidade, num espaço seguro e teu.">
    <img className="about-logo" src="/tchilar-logo-full.png" alt="Tchilar — conecta, partilha, vive" />
    <h2>O que podes fazer no Tchilar</h2>
    <ul>
      <li><strong>Partilhar momentos</strong> com texto, fotografias, vídeos e stories que desaparecem em 24 horas.</li>
      <li><strong>Estar perto de quem importa</strong>: amigos, pessoas que segues, grupos, páginas e eventos.</li>
      <li><strong>Conversar</strong> em mensagens privadas.</li>
      <li><strong>Apoiar criadores</strong> com subscrições mensais que dão acesso a conteúdo exclusivo.</li>
    </ul>
    <h2>Como cuidamos do bairro</h2>
    <p>Qualquer pessoa pode bloquear contas e denunciar publicações, comentários ou perfis. A equipa de moderação analisa as denúncias e pode esconder conteúdo ou suspender contas que não respeitem os <Link to="/terms">Termos</Link>.</p>
    <p>Os teus dados são teus: podes descarregá-los ou apagar a conta a qualquer momento em <Link to="/settings/conta">Definições → Conta</Link>. Lê a <Link to="/privacy">Política de Privacidade</Link> para saber o que guardamos.</p>
  </InfoPage>;
}
export const HELP_TOPICS = [
  ["Conta", [
    ["Não recebi o email de confirmação.", "Procura na pasta de spam. No ecrã de entrada, depois de tentares iniciar sessão, aparece a opção «Reenviar confirmação de email». A ligação é válida durante 1 hora."],
    ["Esqueci-me da palavra-passe.", "Em «Entrar», escolhe «Esqueceste-te da palavra-passe?». Recebes uma ligação válida durante 1 hora. Ao mudar a palavra-passe, todas as sessões abertas noutros dispositivos terminam."],
    ["Como mudo a foto de perfil ou a capa?", "Em Definições → A tua conta, usa «Foto de perfil» e «Capa do perfil». Aceitamos JPG, PNG, WebP e GIF até 8 MB."],
    ["Como apago a minha conta?", "Em Definições → A tua conta → Apagar conta. Pedimos a palavra-passe para confirmar. Apagamos o perfil, publicações, comentários, mensagens e os grupos e páginas que criaste, e cancelamos as subscrições pagas. Antes disso, podes descarregar os teus dados."]
  ]],
  ["Publicações e feed", [
    ["Qual é a diferença entre «Para ti» e «Amigos e quem segues»?", "«Para ti» mostra publicações de toda a comunidade. «Amigos e quem segues» mostra só as tuas, as dos teus amigos, as de quem segues e as das páginas e grupos de que fazes parte."],
    ["Posso editar uma publicação?", "Sim: no menu (⋯) da tua publicação, escolhe «Editar». A publicação passa a mostrar «editado»."],
    ["Quem vê as publicações exclusivas?", "Só quem tem uma subscrição ativa do criador. Os criadores marcam «Só para subscritores» ao publicar."]
  ]],
  ["Segurança", [
    ["O que acontece quando bloqueio alguém?", "Deixam de ser amigos e de se seguir. Não veem as publicações, comentários e stories um do outro, e não podem trocar mensagens. A pessoa não é avisada. Podes desbloquear em Definições."],
    ["Como denuncio conteúdo?", "Usa o menu (⋯) de uma publicação, o ícone de bandeira num comentário ou o menu de um perfil. Quem é denunciado não sabe quem fez a denúncia."],
    ["Alguém está em perigo.", "Se houver perigo imediato, contacta as autoridades locais primeiro. Depois denuncia o conteúdo para a equipa de moderação o analisar."]
  ]],
  ["Subscrições", [
    ["Como cancelo uma subscrição?", "No perfil do criador, escolhe «Cancelar renovação». Manténs o acesso até ao fim do período que já pagaste."],
    ["Como defino o meu preço como criador?", "No teu perfil, toca em Editar perfil e indica o preço mensal em kwanzas (entre 500 Kz e 500 000 Kz)."]
  ]]
];
export function Help() {
  return <InfoPage kicker="Ajuda" title="Como podemos ajudar?" intro="Respostas rápidas às perguntas mais comuns.">
    {HELP_TOPICS.map(([topic, questions]) => <section key={topic} className="help-topic">
      <h2>{topic}</h2>
      {questions.map(([question, answer]) => <details key={question}>
        <summary>{question}</summary>
        <p>{answer}</p>
      </details>)}
    </section>)}
  </InfoPage>;
}
export function Terms() {
  return <InfoPage kicker="Termos" title="Termos de utilização" draft
    intro="As regras para vivermos bem no bairro. Ao criar uma conta, aceitas estes termos.">
    <h2>1. A tua conta</h2>
    <p>Precisas de um email válido, de dados verdadeiros e de ter pelo menos 13 anos. És responsável pela segurança da tua palavra-passe e pelo que é publicado com a tua conta. Não podes fazer-te passar por outra pessoa nem criar contas para obter vantagens (por exemplo, prémios de convites).</p>
    <h2>2. O teu conteúdo</h2>
    <p>O que publicas continua a ser teu. Ao publicar, dás ao Tchilar autorização para alojar e mostrar esse conteúdo às pessoas que o podem ver, enquanto ele estiver publicado — incluindo quando alguém o partilha. Só podes publicar conteúdo sobre o qual tens direitos.</p>
    <h2>3. O que não é permitido</h2>
    <ul>
      <li>Assédio, ameaças, discurso de ódio ou incitamento à violência.</li>
      <li>Conteúdo sexual envolvendo menores, em qualquer circunstância.</li>
      <li>Conteúdo sexual explícito fora de contextos permitidos, ou partilhado sem consentimento.</li>
      <li>Spam, burlas, publicidade enganosa ou contas falsas.</li>
      <li>Comprar ou trocar gostos, seguidores ou visualizações, ou manipular desafios.</li>
      <li>Partilhar dados pessoais de outras pessoas sem autorização.</li>
      <li>Tentar aceder a contas ou dados de terceiros, ou perturbar o funcionamento do serviço.</li>
    </ul>
    <h2>4. Moderação</h2>
    <p>Podemos esconder conteúdo, apagar comentários ou suspender contas que violem estes termos. As decisões são tomadas pela equipa de moderação a partir das denúncias da comunidade.</p>
    <h2>5. Pagamentos</h2>
    <p>Os pagamentos são processados por prestadores de pagamento externos; o Tchilar nunca vê os dados do teu cartão. Os preços são em kwanzas (Kz).</p>
    <ul>
      <li><strong>Subscrições:</strong> mensais, renovam-se automaticamente até serem canceladas. Ao cancelar, manténs o acesso até ao fim do período pago. O conteúdo exclusivo é da responsabilidade de cada criador.</li>
      <li><strong>Estrelas:</strong> compram-se em pacotes e servem para apoiar criadores. As estrelas compradas não são reembolsáveis nem convertíveis em dinheiro por quem as comprou.</li>
      <li><strong>Promoções e anúncios:</strong> pagas antes de serem revistas. Se a equipa recusar uma promoção, o valor é devolvido. O orçamento é gasto à medida que as pessoas veem a promoção; o que não for gasto até ao fim do prazo não é devolvido. Aplicam-se as <Link to="/publicidade">Regras de publicidade</Link>.</li>
      <li><strong>Campanhas com marcas:</strong> a marca paga através do Tchilar quando o criador aceita a proposta. O Tchilar fica com 15%.</li>
    </ul>
    <h2>6. Ganhos dos criadores</h2>
    <p>Os criadores podem ganhar dinheiro com o Programa de Parceiros (a partir de 10 000 seguidores e 10 000 visualizações em 28 dias), com as estrelas recebidas (80% do valor) e com campanhas de marcas (85% do valor). Os ganhos podem ser levantados por transferência bancária a partir de 5 000 Kz. Ganhos obtidos com fraude (visualizações, seguidores ou estrelas falsas) podem ser anulados, e a conta suspensa.</p>
    <h2>7. Fim da conta</h2>
    <p>Podes apagar a conta quando quiseres, em Definições. Podemos encerrar contas que violem estes termos de forma grave ou repetida. Os registos de pagamentos e levantamentos são guardados durante o prazo exigido pela lei, mesmo depois de a conta ser apagada.</p>
    <h2>8. Alterações</h2>
    <p>Se mudarmos estes termos, avisamos na aplicação antes de as alterações entrarem em vigor.</p>
  </InfoPage>;
}
export function Privacy() {
  return <InfoPage kicker="Privacidade" title="Política de privacidade" draft
    intro="O que guardamos, para quê e como podes controlar os teus dados.">
    <h2>Dados que recolhemos</h2>
    <ul>
      <li><strong>Conta:</strong> email, nome de utilizador, nome público e palavra-passe (guardada apenas como hash, nunca em texto).</li>
      <li><strong>Perfil:</strong> biografia, foto, capa, profissão, localidade e site, se os preencheres. São públicos.</li>
      <li><strong>Província e data de nascimento</strong> (opcionais): só servem para te mostrar promoções da tua zona e idade. Nunca são públicas. A província só é mostrada às marcas no marketplace se o autorizares, e a data de nascimento nunca é mostrada a ninguém — quem anuncia só escolhe uma faixa etária e nunca sabe quem viu a promoção.</li>
      <li><strong>Conteúdo e atividade:</strong> publicações, partilhas, comentários, gostos, stories, amizades, seguidores, grupos, páginas, eventos e mensagens privadas.</li>
      <li><strong>Visualizações:</strong> guardamos uma visita por dia quando vês um perfil ou uma publicação com sessão iniciada. Quem é visto só vê os números, nunca quem viu.</li>
      <li><strong>Denúncias e bloqueios</strong> que fazes ou de que és alvo.</li>
      <li><strong>Pagamentos:</strong> os dados do cartão são tratados pelo prestador de pagamentos e nunca passam pelos nossos servidores. Guardamos o estado de cada pagamento, as estrelas, as promoções e as campanhas.</li>
      <li><strong>Dados bancários dos criadores:</strong> o titular e o IBAN para receber levantamentos. O IBAN é guardado cifrado e só é visto, completo, pela equipa financeira no momento de fazer a transferência.</li>
    </ul>
    <h2>Para que os usamos</h2>
    <p>Para prestar o serviço (mostrar o teu perfil e conteúdo, entregar mensagens e notificações), para manter a comunidade segura (moderação e prevenção de fraude), para te mostrar as tuas estatísticas, para mostrar promoções e para pagar aos criadores. Não vendemos dados pessoais.</p>
    <h2>Promoções</h2>
    <p>As promoções que vês são escolhidas pelo orçamento de quem anuncia e, se o indicaste, pela tua província e idade. Quem anuncia vê apenas números agregados (alcance e cliques), nunca quem viu ou clicou.</p>
    <h2>Armazenamento no teu dispositivo</h2>
    <p>Guardamos no browser apenas a tua sessão e preferências (tema claro/escuro e o separador do feed). Não usamos cookies de publicidade nem de rastreio.</p>
    <h2>Quem vê o quê</h2>
    <p>O perfil e as publicações públicas são visíveis para a comunidade. As publicações de grupos só são visíveis para os membros, e as exclusivas só para subscritores. As mensagens privadas só são visíveis para quem participa na conversa.</p>
    <h2>Os teus direitos</h2>
    <ul>
      <li><strong>Acesso e portabilidade:</strong> Definições → Descarregar dados.</li>
      <li><strong>Retificação:</strong> Editar perfil (no teu perfil) e Definições → Privacidade → Província e idade.</li>
      <li><strong>Apagamento:</strong> Definições → Apagar conta. A conta e o conteúdo são apagados de imediato. Os registos de pagamentos e levantamentos são guardados durante o prazo legal. Podem ficar cópias de segurança durante um período limitado.</li>
    </ul>
    <h2>Contacto</h2>
    <p>Para questões de privacidade, contacta a equipa responsável pelo Tchilar. (Falta indicar aqui o contacto, o responsável pelo tratamento e o registo na Agência de Proteção de Dados.)</p>
  </InfoPage>;
}
export function AdRules() {
  return <InfoPage kicker="Publicidade" title="Regras de publicidade" draft
    intro="O que pode e não pode ser promovido no Tchilar. Todas as promoções são revistas pela equipa antes de aparecerem.">
    <h2>Como funciona a revisão</h2>
    <p>Depois de pagares, a promoção fica <strong>em revisão</strong> (normalmente menos de 24 horas). Se for aprovada, entra no ar e o prazo começa a contar. Se for recusada, explicamos o motivo e devolvemos o valor pago.</p>
    <h2>Não é permitido promover</h2>
    <ul>
      <li>Tudo o que os <Link to="/terms">Termos de utilização</Link> já proíbem.</li>
      <li>Produtos ou serviços ilegais em Angola, armas, drogas, medicamentos sujeitos a receita, tabaco e produtos de vaping.</li>
      <li>Jogos de fortuna e azar e apostas sem licença válida em Angola.</li>
      <li>Esquemas de dinheiro fácil, pirâmides, "investimentos" com retornos garantidos e empréstimos sem condições claras.</li>
      <li>Bebidas alcoólicas dirigidas a menores de 18 anos (usa a segmentação por idade).</li>
      <li>Promessas de saúde ou de resultados que não podes provar.</li>
      <li>Imitar outra marca ou pessoa, ou usar logótipos sem autorização.</li>
    </ul>
    <h2>Boas práticas</h2>
    <ul>
      <li>Diz claramente o que estás a vender e o preço, quando existir.</li>
      <li>A ligação tem de levar à página prometida no anúncio.</li>
      <li>Usa imagens tuas ou com autorização.</li>
    </ul>
    <h2>Preço</h2>
    <p>Pagas pelo alcance: 500 Kz por cada 1000 pessoas alcançadas (mais 20% se escolheres província ou idade). Cada pessoa conta uma vez por dia, e só quando a promoção aparece mesmo no ecrã.</p>
  </InfoPage>;
}
