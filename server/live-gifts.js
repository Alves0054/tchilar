// Presentes dos diretos: 15 presentes de 100 Kz a 25 000 Kz. Pagam-se com estrelas (1 estrela = 10 Kz),
// como as estrelas soltas: quem transmite recebe 70% do valor no saldo (ver growth.js / finance-routes.js).
//
// sound: 0 = sem som; 1 a 8 = som de aviso, cada um mais vistoso do que o anterior (public/sounds/gift-N.wav no
// site e assets/sounds na app). Os presentes a partir de 2 000 Kz tocam som para toda a gente no direto.
const { STAR_PRICE_KZ } = require("./growth");

const GIFTS = [
  { key: "rosa", name: "Rosa", kz: 100, sound: 0 },
  { key: "cafe", name: "Café", kz: 200, sound: 0 },
  { key: "coracao", name: "Coração", kz: 300, sound: 0 },
  { key: "palmas", name: "Palmas", kz: 500, sound: 0 },
  { key: "gelado", name: "Gelado", kz: 700, sound: 0 },
  { key: "microfone", name: "Microfone", kz: 1000, sound: 0 },
  { key: "oculos", name: "Óculos de sol", kz: 1500, sound: 0 },
  { key: "trofeu", name: "Troféu", kz: 2000, sound: 1 },
  { key: "coroa", name: "Coroa", kz: 3000, sound: 2 },
  { key: "diamante", name: "Diamante", kz: 5000, sound: 3 },
  { key: "carro", name: "Carro", kz: 7500, sound: 4 },
  { key: "iate", name: "Iate", kz: 10000, sound: 5 },
  { key: "aviao", name: "Avião", kz: 15000, sound: 6 },
  { key: "palacio", name: "Palácio", kz: 20000, sound: 7 },
  { key: "foguetao", name: "Foguetão", kz: 25000, sound: 8 }
].map(gift => ({ ...gift, stars: Math.round(gift.kz / STAR_PRICE_KZ) }));

const giftByKey = key => GIFTS.find(gift => gift.key === key) || null;

module.exports = { GIFTS, giftByKey };
