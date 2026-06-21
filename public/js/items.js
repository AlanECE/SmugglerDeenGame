// Miroir client des items (affichage uniquement — la vérité reste serveur).
const ITEMS = {
  pasta: { name: 'Pâtes', emoji: '🍝', legal: true, value: 2, penalty: 1, color: '#e9d8a6' },
  eggs: { name: 'Œufs', emoji: '🥚', legal: true, value: 2, penalty: 1, color: '#f4f1de' },
  coffee: { name: 'Café', emoji: '☕', legal: true, value: 3, penalty: 1, color: '#a98467' },
  cheese: { name: 'Fromage', emoji: '🧀', legal: true, value: 3, penalty: 2, color: '#f2cc8f' },
  weed: { name: 'Weed', emoji: '🌿', legal: false, value: 5, penalty: 4, color: '#588157' },
  cocaine: { name: 'Cocaïne', emoji: '❄️', legal: false, value: 7, penalty: 6, color: '#dfe7ec' },
  fakepapers: { name: 'Faux papiers', emoji: '📄', legal: false, value: 6, penalty: 5, color: '#cdb4db' },
  watches: { name: 'Montres volées', emoji: '⌚', legal: false, value: 5, penalty: 4, color: '#bc6c25' },
};
const LEGAL_IDS = Object.keys(ITEMS).filter((k) => ITEMS[k].legal);
