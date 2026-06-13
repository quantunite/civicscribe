// wink-porter2-stemmer ships no types. It is a CommonJS module whose single
// export is the Porter2 (Snowball English) stemming function — the same
// algorithm Postgres' 'english' text-search config uses.
declare module "wink-porter2-stemmer" {
  const stem: (word: string) => string;
  export default stem;
}
