/**
 * Hák pro načítání modulů v testech mimo Next: `import "server-only"` je
 * v appce jen pojistka, že se serverový soubor nedostane do prohlížeče.
 * Samostatný balíček tohle jméno v projektu nemá (řeší to Next uvnitř),
 * takže by mimo Next import spadl. Tady se nahradí prázdným modulem.
 */
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  return next(specifier, context);
}
