// Memória partilhada entre ecrãs: passa uma publicação ou uma lista de stories ao ecrã seguinte
// sem a pedir outra vez à API (a API não tem rota para uma só publicação).
const items = new Map();
export const remember = (key, value) => { items.set(key, value); };
export const recall = key => items.get(key);
