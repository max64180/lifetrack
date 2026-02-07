export const getCat = (cats, id) => cats.find(c => c.id === id) || cats[0];
