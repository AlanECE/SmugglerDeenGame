// =============================================================
//  Liste d'items imposée : 4 légaux / 4 illégaux (8 au total)
//  Icône simple + couleur fixe par item.
// =============================================================

const ITEMS = {
  pasta: { id: 'pasta', name: 'Pâtes', emoji: '🍝', legal: true, value: 2, penalty: 1, color: '#e9d8a6' },
  eggs: { id: 'eggs', name: 'Œufs', emoji: '🥚', legal: true, value: 2, penalty: 1, color: '#f4f1de' },
  coffee: { id: 'coffee', name: 'Café', emoji: '☕', legal: true, value: 3, penalty: 1, color: '#a98467' },
  cheese: { id: 'cheese', name: 'Fromage', emoji: '🧀', legal: true, value: 3, penalty: 2, color: '#f2cc8f' },

  weed: { id: 'weed', name: 'Weed', emoji: '🌿', legal: false, value: 5, penalty: 4, color: '#588157' },
  cocaine: { id: 'cocaine', name: 'Cocaïne', emoji: '❄️', legal: false, value: 7, penalty: 6, color: '#dfe7ec' },
  fakepapers: { id: 'fakepapers', name: 'Faux papiers', emoji: '📄', legal: false, value: 6, penalty: 5, color: '#cdb4db' },
  watches: { id: 'watches', name: 'Montres volées', emoji: '⌚', legal: false, value: 5, penalty: 4, color: '#bc6c25' },
};

const LEGAL_ITEMS = Object.values(ITEMS).filter((i) => i.legal);
const ILLEGAL_ITEMS = Object.values(ITEMS).filter((i) => !i.legal);

module.exports = { ITEMS, LEGAL_ITEMS, ILLEGAL_ITEMS };
