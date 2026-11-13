// Build do frontend sempre em modo de produção.
// O .env tem NODE_ENV=development para o servidor local, e o Vite usaria esse valor se NODE_ENV
// não estivesse definido antes de arrancar: o resultado seria o React de desenvolvimento (o dobro
// do tamanho, mais lento) misturado com JSX de produção. Definir aqui, antes do Vite, resolve os dois.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
