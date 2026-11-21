// Links do site (https://tchilar.ao/...) e do esquema tchilar:// que abrem a app: traduz o endereço do site
// para o ecrã da app. Ex.: /groups/12 → /group/12, /desafios/3 → /challenges/3. O que a app não conhece abre o Início.
const RULES = [
  [/^\/u\/([^/]+)(\/(about|media))?$/, match => `/u/${match[1]}`],
  [/^\/groups\/(\d+)$/, match => `/group/${match[1]}`],
  [/^\/groups$/, () => "/groups"],
  [/^\/pages\/(\d+)$/, match => `/page/${match[1]}`],
  [/^\/pages$/, () => "/pages"],
  [/^\/messages\/(\d+)$/, match => `/chat/${match[1]}`],
  [/^\/messages$/, () => "/messages"],
  [/^\/posts\/(\d+)$/, match => `/post/${match[1]}`],
  [/^\/live\/(\d+)$/, match => `/live/${match[1]}`],
  [/^\/live$/, () => "/live"],
  [/^\/reels$/, () => "/reels"],
  [/^\/search$/, (_match, query) => `/search${query}`],
  [/^\/notifications$/, () => "/notifications"],
  [/^\/events$/, () => "/events"],
  [/^\/friends$/, () => "/friends"],
  [/^\/estrelas$/, () => "/stars"],
  [/^\/marcas$/, () => "/brands"],
  [/^\/desafios\/(\d+)$/, match => `/challenges/${match[1]}`],
  [/^\/desafios$/, () => "/challenges"],
  [/^\/convidar$/, () => "/invite"],
  [/^\/academia\/cursos\/(\d+)$/, match => `/academy/${match[1]}`],
  [/^\/academia(\/.*)?$/, () => "/academy"]
];

const SITE_HOSTS = ["tchilar.ao", "www.tchilar.ao"];

export function redirectSystemPath({ path }) {
  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(path);
    const url = new URL(path, "https://tchilar.ao");
    const fromSite = !isAbsolute || ((url.protocol === "https:" || url.protocol === "http:") && SITE_HOSTS.includes(url.host));
    const fromScheme = url.protocol === "tchilar:";
    // Expo Go (exp://), ecrãs internos e outros endereços passam sem mudança.
    if (!fromSite && !fromScheme) return path;
    const pathname = (fromScheme ? `/${url.host}${url.pathname}` : url.pathname).replace(/\/$/, "") || "/";
    for (const [pattern, to] of RULES) {
      const match = pathname.match(pattern);
      if (match) return to(match, url.search);
    }
    // Um link do site que a app não tem (ex.: confirmar email) abre o Início; caminhos da app passam.
    return isAbsolute && !fromScheme ? "/" : `${pathname}${url.search}`;
  } catch {
    return path;
  }
}
